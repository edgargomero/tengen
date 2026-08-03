// Factory de evaluador de apps/web (contexto WORKER). Lee el ONNX YA CACHEADO en OPFS por el hilo
// principal (ModelGate → ensureModel) y construye un OnnxEvaluator WebGPU desde el ArrayBuffer.
//
// HARD CONSTRAINT (Fase 1): en el worker NO existe `localStorage` → PROHIBIDO tocar `isComplete`/
// `markComplete`/`localStorage`. Este factory usa SOLO `readArrayBuffer` (OPFS puro) + el size-check
// contra el manifest. La completitud (marcador) es responsabilidad del hilo principal antes de init.
//
// ── Cómo sabe QUÉ variante leer, sin poder discrepar con quien la descargó ─────────────────────
// Sin override llama a `currentModelVariant()`, exactamente igual que `ModelGate`. Esa función lee
// `navigator.userAgent` —el mismo string en el worker y en el hilo principal— y es lo único que
// decide; no hay ningún parámetro que se pueda pasar distinto en cada scope. Ver el comentario
// largo de `models/modelVariant.ts`: la divergencia acá significa "el worker busca un archivo que
// nadie descargó", que es un motor que no arranca.
import { OnnxEvaluator } from '@tengen/engine'
import type { BoardSize, NetworkId, NNEvaluator } from '@tengen/engine'
import { type ModelVariant, requireManifestEntry, resolveManifestEntry } from './models/netManifest'
import { currentModelVariant } from './models/modelVariant'
import { createOpfsModelStore } from './models/modelStore'

export async function appEvaluatorFactory(
  net: NetworkId,
  boardSize: BoardSize,
  /**
   * Fuerza una variante en vez de la del dispositivo. SÓLO lo usa la prueba del motor de
   * `/diagnostico`, donde la variante es el eje del experimento.
   *
   * Presente ⇒ resolución ESTRICTA: si esa variante no está publicada para esta red, lanza en vez de
   * caer a fp32. La asimetría con el camino de producción es deliberada — un fallback silencioso acá
   * reportaría "el mixto aguantó las 6 tandas" habiendo medido el fp32, y esa medición es la
   * evidencia que decide si hay que convertir una red más chica.
   */
  variantOverride?: ModelVariant,
): Promise<NNEvaluator> {
  // Lanza para redes no disponibles (p.ej. b10) por cualquiera de los dos caminos.
  const entry =
    variantOverride === undefined
      ? resolveManifestEntry(net, currentModelVariant()).entry
      : requireManifestEntry(net, variantOverride)
  const store = createOpfsModelStore()

  let buf: ArrayBuffer
  try {
    buf = await store.readArrayBuffer(entry.opfsName)
  } catch (err) {
    // El archivo no está en OPFS (NotFoundError) u otro fallo de lectura: mensaje accionable.
    throw new Error(
      `modelo ${net} no está en OPFS (${entry.opfsName}); el hilo principal debe cachearlo con ` +
        `ensureModel (ModelGate) antes de init — ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (buf.byteLength !== entry.bytes) {
    throw new Error(`modelo ${net}: tamaño ${buf.byteLength} ≠ esperado ${entry.bytes} en OPFS`)
  }

  return OnnxEvaluator.create(buf, { boardSize, ep: 'webgpu' })
}
