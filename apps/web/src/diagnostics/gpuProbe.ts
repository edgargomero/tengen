// Sondeo de WebGPU, con el MOTIVO del fallo. Corre igual en el hilo principal y dentro de un Worker:
// una sola implementación, dos scopes.
//
// ── Por qué existe ──────────────────────────────────────────────────────────────────────────────
// El gate de la app (`webgpu.ts`) contesta una sola pregunta —¿arranco o muestro el cartel?— y para eso
// un booleano alcanza. Este archivo contesta la otra: *por qué* dio ese booleano. Son dos necesidades
// distintas y por eso son dos funciones distintas; meter todo esto en el gate haría que cada usuario de
// escritorio pagara una creación de device antes de ver el menú.
//
// ── Las dos cosas que el gate no puede ver ──────────────────────────────────────────────────────
//  1. `requestDevice()`, no sólo `requestAdapter()`. Un adapter que se entrega y un device que falla por
//     límites es un modo de fallo típicamente móvil, y el gate lo dejaría pasar: la app arrancaría, y
//     moriría DESPUÉS de bajar 115,8 MB de pesos.
//  2. `device.lost`. Un device que se crea y se pierde a los milisegundos no se distingue de uno sano si
//     sólo se mira el valor de retorno.
//
// ── Por qué también dentro del Worker ──────────────────────────────────────────────────────────
// La detección corre en el hilo principal, pero la sesión ONNX se crea en el worker, que pide su PROPIO
// adapter (`packages/engine/src/nn/session.ts`). Son dos scopes distintos y pueden discrepar —
// `crossOriginIsolated` y la disponibilidad de GPU se resuelven por contexto. Preguntar en uno solo es
// justamente cómo se llega a "el gate pasó y el motor no arranca".
//
// Todo entra por `ProbeEnv` (inyección explícita) para que el test corra en Node sin navegador.

/** Lo que `adapter.info` (o el viejo `requestAdapterInfo()`) puede traer. Todo opcional: los
 * navegadores enmascaran parte de estos campos por privacidad. */
export interface AdapterInfoReport {
  vendor?: string
  architecture?: string
  device?: string
  description?: string
}

interface MinimalGpuDevice {
  /** Resuelve cuando el device se pierde. Nunca rechaza (por spec). */
  lost?: Promise<{ reason?: string; message?: string } | undefined>
  destroy?(): void
}

interface MinimalGpuAdapter {
  /** Opcional a propósito: la API anterior exponía esto vía `requestAdapterInfo()` (asíncrono, ya
   * retirado de Chrome), así que un navegador viejo puede no tener el campo. Su ausencia es un dato,
   * no un fallo. */
  info?: AdapterInfoReport
  features?: Iterable<string>
  limits?: Record<string, unknown>
  requestDevice?(): Promise<MinimalGpuDevice>
}

export interface MinimalGpu {
  requestAdapter(opts?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<MinimalGpuAdapter | null>
}

/** Resultado de cada paso: se distingue "no hay", "dijo no", "explotó" y "se colgó" — cuatro causas
 * que hoy el `catch` vacío de `webgpu.ts` colapsa en un solo `false`. */
export type ProbeStep = 'ok' | 'null' | 'error' | 'timeout' | 'skipped' | 'unsupported'

export interface GpuProbe {
  scope: 'main' | 'worker'
  /** ¿Existe `navigator.gpu` en ESTE scope? */
  hasNavigatorGpu: boolean
  adapter: ProbeStep
  adapterError?: string
  adapterInfo?: AdapterInfoReport
  /** Features declaradas por el adapter (`shader-f16` es la que más nos interesa). */
  features?: string[]
  /** Los límites que deciden si un modelo de 115,8 MB entra. No son todos los de la spec a propósito:
   * `GPUSupportedLimits` expone sus valores en getters del prototipo, así que no se puede enumerar. */
  limits?: Record<string, number>
  device: ProbeStep
  deviceError?: string
  /** Presente sólo si el device se perdió por su cuenta durante el sondeo (no por nuestro `destroy()`). */
  deviceLost?: string
  crossOriginIsolated: boolean
  hasSharedArrayBuffer: boolean
  hardwareConcurrency: number
  elapsedMs: number
}

/** Lo único que `probeWorker.ts` postea de vuelta. `ok: false` sólo si `probeGpu` llegara a lanzar
 * (no debería): un worker mudo es indistinguible de un cuelgue, y esa ambigüedad es la que se evita. */
export type ProbeWorkerMessage = { ok: true; probe: GpuProbe } | { ok: false; error: string }

export interface ProbeEnv {
  scope: 'main' | 'worker'
  gpu: MinimalGpu | undefined
  crossOriginIsolated: boolean
  hasSharedArrayBuffer: boolean
  hardwareConcurrency: number
  /** Tope por paso. Un `requestAdapter()` que no resuelve NUNCA es un resultado en sí mismo, y sin este
   * tope la pantalla de diagnóstico se quedaría colgada exactamente en el aparato que hay que
   * diagnosticar. */
  timeoutMs?: number
  /** Cuánto se espera a ver si el device se pierde solo antes de darlo por sano. */
  lostGraceMs?: number
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_LOST_GRACE_MS = 300

/** Límites relevantes para correr una red de ~116 MB por ORT. Leídos por nombre porque
 * `GPUSupportedLimits` expone sus valores en getters del prototipo y no se puede enumerar.
 *
 * `bytes` distingue los que son TAMAÑOS de los que son CONTEOS. No es un detalle cosmético: sin esa
 * marca, el volcado imprimía "maxComputeWorkgroupsPerDimension: 65535 (65.5 kB)" — un límite de cantidad
 * de grupos de trabajo disfrazado de memoria. Un dato inventado con formato de dato real invita a
 * razonar sobre memoria donde no hay memoria. */
const LIMIT_KEYS: ReadonlyArray<{ key: string; bytes: boolean }> = [
  { key: 'maxBufferSize', bytes: true },
  { key: 'maxStorageBufferBindingSize', bytes: true },
  { key: 'maxComputeWorkgroupStorageSize', bytes: true },
  { key: 'maxComputeInvocationsPerWorkgroup', bytes: false },
  { key: 'maxComputeWorkgroupsPerDimension', bytes: false },
]

/** Los nombres de límite cuyo valor se mide en bytes. Lo consume `format.ts` para decidir si le agrega
 * la unidad legible. */
export const BYTE_LIMIT_KEYS: ReadonlySet<string> = new Set(
  LIMIT_KEYS.filter((limit) => limit.bytes).map((limit) => limit.key),
)

export function errorText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

/** Marca sentinel de expiración. Un objeto propio, no un throw: distingue "tardó demasiado" de "falló",
 * que son diagnósticos distintos. */
const TIMED_OUT = Symbol('timeout')

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Copia plana: `GPUAdapterInfo` no sobrevive a un `postMessage` (no es estructuralmente clonable), y
 * este reporte cruza de worker a hilo principal. */
function readAdapterInfo(adapter: MinimalGpuAdapter): AdapterInfoReport | undefined {
  const info = adapter.info
  if (!info) return undefined
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  }
}

function readFeatures(adapter: MinimalGpuAdapter): string[] | undefined {
  if (!adapter.features) return undefined
  try {
    return [...adapter.features].sort()
  } catch {
    // `features` existe pero no es iterable en este navegador: no es motivo para perder el resto.
    return undefined
  }
}

function readLimits(adapter: MinimalGpuAdapter): Record<string, number> | undefined {
  const limits = adapter.limits
  if (!limits) return undefined
  const out: Record<string, number> = {}
  for (const { key } of LIMIT_KEYS) {
    const value = limits[key]
    if (typeof value === 'number') out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Sondea WebGPU de punta a punta: `navigator.gpu` → `requestAdapter()` → info/features/limits →
 * `requestDevice()` → `device.lost`. Nunca lanza: todo fallo se convierte en un campo del reporte,
 * porque un diagnóstico que se cae no diagnostica nada.
 */
export async function probeGpu(env: ProbeEnv): Promise<GpuProbe> {
  const now = env.now ?? (() => performance.now())
  const timeoutMs = env.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const lostGraceMs = env.lostGraceMs ?? DEFAULT_LOST_GRACE_MS
  const startedAt = now()

  const probe: GpuProbe = {
    scope: env.scope,
    hasNavigatorGpu: env.gpu !== undefined,
    adapter: 'skipped',
    device: 'skipped',
    crossOriginIsolated: env.crossOriginIsolated,
    hasSharedArrayBuffer: env.hasSharedArrayBuffer,
    hardwareConcurrency: env.hardwareConcurrency,
    elapsedMs: 0,
  }

  const finish = (): GpuProbe => {
    probe.elapsedMs = Math.round(now() - startedAt)
    return probe
  }

  if (!env.gpu) {
    probe.adapter = 'unsupported'
    probe.device = 'unsupported'
    return finish()
  }

  // ── Paso 1: adapter ───────────────────────────────────────────────────────────────────────────
  let adapter: MinimalGpuAdapter | null = null
  try {
    // `high-performance`, igual que `session.ts`: se sondea la misma GPU que usaría el motor, no otra.
    const settled = await withTimeout(env.gpu.requestAdapter({ powerPreference: 'high-performance' }), timeoutMs)
    if (settled === TIMED_OUT) {
      probe.adapter = 'timeout'
      probe.adapterError = `requestAdapter() no resolvió en ${timeoutMs} ms`
      return finish()
    }
    adapter = settled
  } catch (err) {
    probe.adapter = 'error'
    probe.adapterError = errorText(err)
    return finish()
  }

  if (adapter === null) {
    // El caso que el `catch` vacío del gate viejo confundía con una excepción: la GPU existe pero el
    // navegador se niega a entregar un adapter (driver en lista negra, GPU bloqueada, sin memoria).
    probe.adapter = 'null'
    probe.adapterError = 'requestAdapter() devolvió null (no hay adapter disponible)'
    return finish()
  }

  probe.adapter = 'ok'
  probe.adapterInfo = readAdapterInfo(adapter)
  probe.features = readFeatures(adapter)
  probe.limits = readLimits(adapter)

  // ── Paso 2: device ────────────────────────────────────────────────────────────────────────────
  if (typeof adapter.requestDevice !== 'function') {
    probe.device = 'unsupported'
    probe.deviceError = 'el adapter no expone requestDevice()'
    return finish()
  }

  let device: MinimalGpuDevice
  try {
    const settled = await withTimeout(adapter.requestDevice(), timeoutMs)
    if (settled === TIMED_OUT) {
      probe.device = 'timeout'
      probe.deviceError = `requestDevice() no resolvió en ${timeoutMs} ms`
      return finish()
    }
    device = settled
  } catch (err) {
    // El modo de fallo que el gate actual no ve: adapter sí, device no.
    probe.device = 'error'
    probe.deviceError = errorText(err)
    return finish()
  }

  probe.device = 'ok'

  // ── Paso 3: ¿se pierde solo? ──────────────────────────────────────────────────────────────────
  // El orden importa: primero se espera la gracia (una pérdida espontánea es el síntoma que buscamos) y
  // SÓLO DESPUÉS se destruye. Al revés, nuestro propio `destroy()` resolvería `lost` y nos reportaríamos
  // el fallo a nosotros mismos.
  if (device.lost) {
    const lost = await withTimeout(device.lost, lostGraceMs)
    if (lost !== TIMED_OUT && lost !== undefined) {
      probe.deviceLost = `${lost.reason ?? 'desconocido'}: ${lost.message ?? '(sin mensaje)'}`
    } else if (lost !== TIMED_OUT) {
      probe.deviceLost = 'el device se perdió (sin detalle)'
    }
  }

  // Liberar la GPU: este sondeo no debe dejar un device vivo compitiendo con el del motor.
  try {
    device.destroy?.()
  } catch {
    // `destroy()` no debería lanzar; si lo hace, no cambia nada de lo ya medido.
  }

  return finish()
}

/** Lee el scope real (hilo principal o worker). Lo único de este archivo que toca globals. */
export function currentProbeEnv(scope: 'main' | 'worker'): ProbeEnv {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { gpu?: MinimalGpu })
  return {
    scope,
    gpu: nav?.gpu,
    // `self.crossOriginIsolated` se resuelve por contexto: el worker puede diferir del documento, y de
    // eso depende `numThreads` en `session.ts`.
    crossOriginIsolated: typeof self !== 'undefined' && self.crossOriginIsolated === true,
    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hardwareConcurrency: nav?.hardwareConcurrency ?? 0,
  }
}
