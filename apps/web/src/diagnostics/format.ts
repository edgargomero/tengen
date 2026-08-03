// Presentación del diagnóstico: el VEREDICTO (una frase que dice si el motor puede correr acá y por qué
// no) y el VOLCADO en texto plano (lo que se pega en un reporte). Puro, con test.
//
// Son dos salidas del mismo dato porque son dos lectores. El veredicto lo lee Edgar en el teléfono, de
// un vistazo, para saber si hay algo que hacer. El volcado lo leo yo después, completo, y por eso incluye
// hasta lo que parece irrelevante: el campo que sobra no cuesta nada y el que falta obliga a otra vuelta
// de ida y vuelta con el dispositivo.
import type { Diagnostics, ModelReport, StorageReport } from './collect'
import { BYTE_LIMIT_KEYS } from './gpuProbe'
import type { GpuProbe } from './gpuProbe'

export interface Verdict {
  /** ¿Puede este dispositivo correr el motor tal como está hoy la app? */
  ok: boolean
  headline: string
  /** El dato concreto en el que se apoya el titular. Nunca vacío: un veredicto sin evidencia no sirve. */
  detail: string
}

/** Bytes a una unidad legible. Decimal (MB, no MiB) porque es la unidad en la que están escritos los
 * tamaños del manifest y los del informe de fase 0. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function yesNo(value: boolean): string {
  return value ? 'sí' : 'no'
}

/** `true` sii el sondeo llegó hasta un device usable y no lo perdió. */
function probeUsable(probe: GpuProbe): boolean {
  return probe.adapter === 'ok' && probe.device === 'ok' && probe.deviceLost === undefined
}

function isProbe(value: GpuProbe | { error: string }): value is GpuProbe {
  return 'scope' in value
}

/** Primer motivo por el que un sondeo no sirve, en una frase. */
function probeFailure(probe: GpuProbe): string {
  if (!probe.hasNavigatorGpu) return 'no existe navigator.gpu en este scope'
  if (probe.adapter !== 'ok') return probe.adapterError ?? `requestAdapter(): ${probe.adapter}`
  if (probe.device !== 'ok') return probe.deviceError ?? `requestDevice(): ${probe.device}`
  if (probe.deviceLost !== undefined) return `el device se perdió solo — ${probe.deviceLost}`
  return 'sin fallo'
}

/**
 * Veredicto en una frase. El orden de las preguntas es el orden en que las cosas se rompen de verdad:
 *
 *  1. ¿Hay WebGPU en el hilo principal? Es lo que decide el gate, y hoy es lo único que la app mira.
 *  2. ¿Se llega hasta un `device`? Un adapter que se entrega y un device que falla es el modo de fallo
 *     que el gate deja pasar: la app arrancaría y moriría DESPUÉS de bajar 115,8 MB.
 *  3. ¿Vale lo mismo dentro del worker? Ahí corre la sesión ONNX. Si el hilo principal dice sí y el
 *     worker dice no, el gate pasa y el motor no arranca — sin ningún mensaje que lo explique.
 */
export function diagnose(d: Diagnostics): Verdict {
  if (!probeUsable(d.main)) {
    return {
      ok: false,
      headline: 'Este dispositivo no puede correr el motor',
      detail: `Hilo principal: ${probeFailure(d.main)}.`,
    }
  }
  if (!isProbe(d.worker)) {
    return {
      ok: false,
      headline: 'El motor no puede arrancar: falla el worker',
      detail: `El sondeo dentro del Worker no se pudo hacer — ${d.worker.error}. El motor corre ahí, no en el hilo principal.`,
    }
  }
  if (!probeUsable(d.worker)) {
    return {
      ok: false,
      headline: 'WebGPU funciona en la página, pero no en el worker',
      detail: `El motor corre dentro de un Worker y ahí ${probeFailure(d.worker)}. El gate de la app sólo mira el hilo principal, así que la app arrancaría igual.`,
    }
  }
  const info = d.main.adapterInfo
  const gpu = [info?.vendor, info?.architecture, info?.device].filter(Boolean).join(' · ')
  return {
    ok: true,
    headline: 'WebGPU funciona en este dispositivo',
    detail: `Adapter y device disponibles en la página y en el worker${gpu ? ` (${gpu})` : ''}.`,
  }
}

/** Avisos que no cambian el veredicto pero explican lentitud o fallos posteriores. */
export function warnings(d: Diagnostics): string[] {
  const out: string[] = []
  if (!d.main.crossOriginIsolated) {
    out.push(
      'Sin aislamiento cross-origin (COOP/COEP) en la página: onnxruntime-web queda en 1 hilo en vez de varios.',
    )
  }
  if (isProbe(d.worker) && !d.worker.crossOriginIsolated) {
    out.push('El worker no está cross-origin isolated: ahí se decide numThreads del motor.')
  }
  if (!d.main.hasSharedArrayBuffer) {
    out.push('No hay SharedArrayBuffer: el WASM multihilo de onnxruntime-web no está disponible.')
  }
  const quota = d.storage.quotaBytes
  const needed = d.models.reduce((sum, model) => sum + model.bytes, 0)
  if (typeof quota === 'number' && needed > 0 && quota < needed) {
    out.push(
      `La cuota de almacenamiento (${formatBytes(quota)}) es menor que los pesos que la app guarda (${formatBytes(needed)}).`,
    )
  }
  if (d.storage.persisted === false) {
    out.push('El almacenamiento no es persistente: el sistema puede borrar los pesos ya descargados.')
  }
  return out
}

function probeLines(probe: GpuProbe): string[] {
  const lines = [
    `navigator.gpu: ${yesNo(probe.hasNavigatorGpu)}`,
    `adapter: ${probe.adapter}${probe.adapterError ? ` — ${probe.adapterError}` : ''}`,
  ]
  const info = probe.adapterInfo
  if (info) {
    const parts = [
      info.vendor && `vendor=${info.vendor}`,
      info.architecture && `arch=${info.architecture}`,
      info.device && `device=${info.device}`,
      info.description && `desc=${info.description}`,
    ].filter(Boolean)
    lines.push(`adapter.info: ${parts.length > 0 ? parts.join(' · ') : '(todo vacío)'}`)
  }
  if (probe.features) lines.push(`features: ${probe.features.join(', ') || '(ninguna)'}`)
  if (probe.limits) {
    for (const [key, value] of Object.entries(probe.limits)) {
      // La unidad legible SÓLO donde el límite es un tamaño (ver `BYTE_LIMIT_KEYS`): un conteo de grupos
      // de trabajo con "(65.5 kB)" al lado es un dato inventado con cara de dato real.
      lines.push(BYTE_LIMIT_KEYS.has(key) ? `${key}: ${value} (${formatBytes(value)})` : `${key}: ${value}`)
    }
  }
  lines.push(`device: ${probe.device}${probe.deviceError ? ` — ${probe.deviceError}` : ''}`)
  if (probe.deviceLost) lines.push(`device.lost: ${probe.deviceLost}`)
  lines.push(
    `crossOriginIsolated: ${yesNo(probe.crossOriginIsolated)}`,
    `SharedArrayBuffer: ${yesNo(probe.hasSharedArrayBuffer)}`,
    `hardwareConcurrency: ${probe.hardwareConcurrency}`,
    `duración del sondeo: ${probe.elapsedMs} ms`,
  )
  return lines
}

function storageLines(storage: StorageReport): string[] {
  const lines: string[] = []
  if (storage.persisted !== undefined) lines.push(`persistente: ${yesNo(storage.persisted)}`)
  if (storage.usageBytes !== undefined) lines.push(`uso: ${formatBytes(storage.usageBytes)}`)
  if (storage.quotaBytes !== undefined) lines.push(`cuota: ${formatBytes(storage.quotaBytes)}`)
  if (storage.error) lines.push(`error: ${storage.error}`)
  return lines.length > 0 ? lines : ['(sin datos)']
}

function modelLines(models: ModelReport[]): string[] {
  if (models.length === 0) return ['(el manifest no tiene redes)']
  return models.map((model) => {
    const state = model.cached === null ? `indeterminado (${model.error ?? 'sin detalle'})` : model.cached ? 'en caché' : 'falta'
    return `${model.net}: ${state} — ${formatBytes(model.bytes)} (${model.opfsName})`
  })
}

function section(title: string, lines: string[]): string {
  return [`[${title}]`, ...lines].join('\n')
}

/** Una sección extra para el volcado, aportada por quien la produce (hoy: las tandas de la prueba del
 * motor, que no se recolectan solas — hay que pedirlas). */
export interface ExtraSection {
  title: string
  lines: string[]
}

/** El volcado completo, en texto plano y en un solo bloque: es lo que se copia y se pega. Las secciones
 * extra van al final, después de los avisos, porque son opcionales y llegan más tarde. */
export function formatDiagnostics(d: Diagnostics, extras: ExtraSection[] = []): string {
  const verdict = diagnose(d)
  const notes = warnings(d)
  const ua = d.userAgent

  const blocks = [
    section('tengen — diagnóstico', [
      `veredicto: ${verdict.headline}`,
      `detalle: ${verdict.detail}`,
      `build: ${d.buildId}`,
      `fecha: ${d.collectedAt}`,
      `url: ${d.url}`,
      `modo de display: ${d.displayMode}`,
      `idioma: ${d.language}`,
    ]),
    section('navegador', [
      `navegador: ${ua.browser ?? '(no declarado)'}`,
      // El número crudo NO se muestra solo cuando está congelado: desde iOS 26 Safari lo fija en "18.7"
      // para siempre, así que leerlo al pie de la letra reporta un sistema viejo en un dispositivo
      // moderno — y ese dato es del que dependen las decisiones sobre este aparato.
      `iOS: ${
        ua.iosVersionFrozen
          ? `26 o superior (Safari congela el UA en ${ua.iosVersion}; la versión real no se publica)`
          : (ua.iosVersion ?? (ua.iPadOsSuspected ? '(iPadOS sospechado: UA de Mac con táctil)' : 'no'))
      }`,
      `WebKit: ${ua.webkitVersion ?? '(no declarado)'}`,
      `user agent: ${d.userAgentRaw}`,
    ]),
    section('webgpu · hilo principal (el scope del gate)', probeLines(d.main)),
    section(
      'webgpu · worker (el scope donde corre el motor)',
      isProbe(d.worker) ? probeLines(d.worker) : [`error: ${d.worker.error}`],
    ),
    section('service worker', [
      `soportado: ${yesNo(d.serviceWorker.supported)}`,
      `controla esta página: ${yesNo(d.serviceWorker.controlled)}`,
      `scope: ${d.serviceWorker.scope ?? '(sin registro)'}`,
      `script activo: ${d.serviceWorker.activeScriptUrl ?? '(ninguno)'}`,
      `estado: ${d.serviceWorker.activeState ?? '(ninguno)'}`,
      `versión esperando: ${d.serviceWorker.waiting === undefined ? '(sin registro)' : yesNo(d.serviceWorker.waiting)}`,
      ...(d.serviceWorker.error ? [`error: ${d.serviceWorker.error}`] : []),
    ]),
    section('almacenamiento', storageLines(d.storage)),
    section('modelos en OPFS', modelLines(d.models)),
  ]

  if (notes.length > 0) blocks.push(section('avisos', notes.map((note) => `· ${note}`)))
  for (const extra of extras) blocks.push(section(extra.title, extra.lines))

  return blocks.join('\n\n')
}
