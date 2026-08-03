// Núcleo testeable de la caché de modelos (Fase 1). `store` y `fetchFn` se INYECTAN para
// que toda la orquestación —incluida la RUTA DE FALLO— sea testeable en Node sin OPFS ni DOM.
// Requisito de primera clase (anti-corrupción silenciosa): un stream roto o un byte-mismatch
// NUNCA debe dejar una entrada aceptada en caché → se aborta el sink y NO se llama markComplete;
// el marcador se setea SOLO tras commit (`close()`) + validación de bytes. Un ONNX truncado
// leído como "cacheado" es basura silenciosa (la misma clase de falla que el fp16 NaN).
//
// No importa nada de OPFS ni del DOM: `Response`/`ReadableStream`/`Headers` son globales de
// Node 18+, así que este módulo compila y corre en el entorno node de vitest.
import type { NetworkId } from '@tengen/engine'
import type { ModelStore } from './modelStore'
import { manifestVariantsOf, type ModelVariant, resolveManifestEntry } from './netManifest'
import { type DownloadProgress, getContentLength, getProgressPercent } from './progress'

/**
 * Borra de OPFS las variantes de `net` que este dispositivo NO va a usar.
 *
 * ── Por qué NO vive dentro de `ensureModel` ───────────────────────────────────────────────────
 * La limpieza es política de PRODUCCIÓN, no parte de "garantizá que este archivo esté". Meterla
 * dentro de `ensureModel` la aplicaba también a la prueba del motor de `/diagnostico`, que llama a
 * `ensureModel` con una variante ELEGIDA: medir el fp32 en un móvil habría borrado el mixto que ese
 * aparato usa de verdad, obligando a re-descargarlo — y en un dispositivo al límite de cuota, la
 * sonda podría no entrar y dejarlo sin ninguna de las dos. Un diagnóstico no debe romper lo que
 * viene a diagnosticar. Por eso la llama `ModelGate` (el camino de producción) y sólo él.
 *
 * `preferred` es la variante que el dispositivo PIDE; acá se resuelve la EFECTIVA con la misma
 * función que usa `ensureModel`. Sin eso, pedir una variante no publicada borraría el fp32 que
 * `ensureModel` está justo por descargar.
 *
 * Best-effort a propósito: un fallo al borrar no debe impedir jugar. Lo peor que pasa es que sobre
 * un archivo viejo ocupando espacio, y eso es estrictamente mejor que negarle el motor a alguien
 * porque no se pudo limpiar.
 */
export async function pruneOtherModelVariants(
  net: NetworkId,
  preferred: ModelVariant,
  store: ModelStore,
): Promise<void> {
  let keep: ModelVariant
  try {
    keep = resolveManifestEntry(net, preferred).variant
  } catch {
    return // red no disponible (p.ej. b10): no hay nada que conservar ni que borrar.
  }
  for (const { variant, entry } of manifestVariantsOf(net)) {
    if (variant === keep) continue
    try {
      await store.delete(entry.opfsName)
    } catch {
      // Ver arriba: se sigue igual.
    }
  }
}

/**
 * Garantiza que el modelo `net` en la variante servible para este dispositivo está cacheado y
 * completo en `store`. Si ya está completo (marcador + tamaño), retorna sin tocar la red. Si no, lo
 * descarga por streaming desde `entry.sourceUrl`, escribiendo incrementalmente al sink, valida el
 * byte-size contra el manifest, y solo entonces commitea + marca completo. Cualquier fallo aborta el
 * sink y re-lanza sin dejar entrada aceptada (la siguiente llamada re-descarga).
 *
 * Devuelve la variante EFECTIVAMENTE cacheada, que puede no ser la pedida: `resolveManifestEntry`
 * cae a fp32 si la variante preferida no está publicada para esa red. El caller la necesita para
 * poder decir la verdad sobre qué tiene (diagnóstico).
 */
export async function ensureModel(
  net: NetworkId,
  variant: ModelVariant,
  store: ModelStore,
  fetchFn: (url: string) => Promise<Response>,
  onProgress?: (p: DownloadProgress) => void,
): Promise<ModelVariant> {
  // 1. Entrada del manifest (lanza para redes no disponibles, p.ej. b10). `effective` puede diferir
  // de `variant` si la preferida no está publicada para esta red.
  const { variant: effective, entry } = resolveManifestEntry(net, variant)

  // NOTA: esta función NO borra nada. La limpieza de variantes viejas es `pruneOtherModelVariants`,
  // que llama `ModelGate` antes de esta llamada (ver el doc de esa función: aplicarla acá rompería
  // la prueba del motor, que mide una variante elegida y no debe tocar la del dispositivo).

  // 2. Ruta de caché: 0 red si ya está completo (marcador presente Y tamaño coincide).
  if (await store.isComplete(entry.opfsName, entry.bytes)) return effective

  // 3. Descarga.
  const res = await fetchFn(entry.sourceUrl)
  if (!res.ok) throw new Error(`descarga de ${net} falló: HTTP ${res.status}`)
  if (res.body === null) throw new Error(`descarga de ${net} sin body (res.body es null)`)

  // 4. Total para el progreso (puede ser null; la validación usa entry.bytes, no total).
  const total = getContentLength(res.headers)

  // 5. Abrir el sink de escritura incremental.
  const sink = await store.openWritable(entry.opfsName)

  // 6. Loop de streaming: escribe cada chunk y reporta progreso. Si revienta → abort + re-throw.
  // `getReader()` vive DENTRO del try: si lanzara, el sink ya abierto se aborta en vez de
  // quedar huérfano (en vez de abrirlo dos veces, el `try` simplemente lo engloba).
  let received = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      received += result.value.byteLength
      await sink.write(result.value)
      onProgress?.({
        receivedBytes: received,
        totalBytes: total,
        percent: getProgressPercent(received, total),
      })
    }
  } catch (err) {
    try {
      await sink.abort() // NO markComplete: nada se acepta en caché.
    } catch {
      // un fallo de abort no debe enmascarar el error primario
    }
    throw err
  }

  // 7. Validación de completitud ANTES de commitear. Mismatch → abort + throw.
  if (received !== entry.bytes) {
    const mismatchErr = new Error(
      `descarga de ${net} incompleta: ${received} bytes recibidos vs ${entry.bytes} esperados`,
    )
    try {
      await sink.abort() // NO markComplete.
    } catch {
      // un fallo de abort no debe enmascarar el error primario
    }
    throw mismatchErr
  }

  // 8. Commit y SOLO entonces marcar completo (marcador = éxito + validación).
  await sink.close()
  await store.markComplete(entry.opfsName, entry.bytes)
  return effective
}
