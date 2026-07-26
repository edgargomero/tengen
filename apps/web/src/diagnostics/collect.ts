// Recolector del diagnóstico: junta en un objeto todo lo que hace falta para contestar "por qué este
// dispositivo no arranca el motor". Toca globals del navegador de punta a punta (por eso no tiene unit
// test: se verifica abriendo `/diagnostico`, el mismo criterio que `models/modelStore.ts`); lo que SÍ
// está testeado es todo lo decidible que delega — `gpuProbe.ts`, `userAgent.ts` y `format.ts`.
//
// Regla que gobierna el archivo: **nunca lanzar.** Cada dato se recolecta en su propio try/catch y un
// fallo se convierte en un campo `error` del reporte. Un diagnóstico que se cae a mitad de camino es
// peor que no tener diagnóstico: deja al usuario sin la parte que sí se pudo medir, que es justo la que
// contiene la respuesta.
import { BUILD_ID } from '../buildInfo'
import { netManifest } from '../models/netManifest'
import { createOpfsModelStore } from '../models/modelStore'
import { currentProbeEnv, errorText, probeGpu } from './gpuProbe'
import type { GpuProbe, ProbeWorkerMessage } from './gpuProbe'
import { summarizeUserAgent } from './userAgent'
import type { UserAgentSummary } from './userAgent'

/** Cuánto se espera al worker de sondeo. Mayor que el tope interno del propio sondeo (8 s por paso):
 * así, ante un `requestAdapter()` colgado, gana el timeout de ADENTRO —que sabe en qué paso se colgó— y
 * no este, que sólo podría decir "el worker no contestó". */
const WORKER_PROBE_TIMEOUT_MS = 12_000

export interface ServiceWorkerReport {
  supported: boolean
  /** ¿Esta página la está sirviendo un service worker? `false` en la primerísima visita. */
  controlled: boolean
  scope?: string
  activeScriptUrl?: string
  activeState?: string
  /** Hay una versión nueva esperando activación (el usuario todavía no apretó "Actualizar"). */
  waiting?: boolean
  error?: string
}

export interface StorageReport {
  persisted?: boolean
  usageBytes?: number
  quotaBytes?: number
  error?: string
}

export interface ModelReport {
  net: string
  opfsName: string
  bytes: number
  /** `true` = cacheado y completo en OPFS; `null` = no se pudo determinar (ver `error`). */
  cached: boolean | null
  error?: string
}

export interface Diagnostics {
  buildId: string
  collectedAt: string
  url: string
  /** `standalone` = corriendo como app instalada. Cambia el ciclo de vida del service worker (una app
   * instalada no se recarga: se vuelve a ella), así que importa para interpretar todo lo demás. */
  displayMode: string
  language: string
  userAgentRaw: string
  userAgent: UserAgentSummary
  serviceWorker: ServiceWorkerReport
  storage: StorageReport
  models: ModelReport[]
  /** Sondeo en el hilo principal — el scope donde corre el gate de la app. */
  main: GpuProbe
  /** Sondeo dentro de un Worker — el scope donde corre la sesión ONNX de verdad. Pueden discrepar. */
  worker: GpuProbe | { error: string }
}

function readDisplayMode(): string {
  if (typeof matchMedia !== 'function') return 'desconocido'
  // El orden va de más específico a menos: `browser` matchea siempre que no haya ninguno de los otros.
  for (const mode of ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay', 'browser']) {
    try {
      if (matchMedia(`(display-mode: ${mode})`).matches) return mode
    } catch {
      // Un navegador que no entiende la consulta: seguir probando las demás.
    }
  }
  return 'desconocido'
}

async function readServiceWorker(): Promise<ServiceWorkerReport> {
  if (!('serviceWorker' in navigator)) return { supported: false, controlled: false }
  const report: ServiceWorkerReport = {
    supported: true,
    controlled: navigator.serviceWorker.controller !== null,
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (registration) {
      report.scope = registration.scope
      report.waiting = registration.waiting !== null
      if (registration.active) {
        report.activeScriptUrl = registration.active.scriptURL
        report.activeState = registration.active.state
      }
    }
  } catch (err) {
    report.error = errorText(err)
  }
  return report
}

async function readStorage(): Promise<StorageReport> {
  const storage = navigator.storage as StorageManager | undefined
  if (!storage) return { error: 'navigator.storage no existe' }
  const report: StorageReport = {}
  try {
    // La cuota es el dato caro de este bloque: los dos modelos del producto suman 223,8 MB y iOS es
    // notablemente más tacaño que un escritorio. Una cuota por debajo de eso explicaría un fallo que
    // no tiene nada que ver con WebGPU.
    const estimate = await storage.estimate()
    if (typeof estimate.usage === 'number') report.usageBytes = estimate.usage
    if (typeof estimate.quota === 'number') report.quotaBytes = estimate.quota
  } catch (err) {
    report.error = errorText(err)
  }
  try {
    report.persisted = await storage.persisted?.()
  } catch {
    // `persisted()` puede no existir o rechazar; la cuota ya se registró y es el dato principal.
  }
  return report
}

async function readModels(): Promise<ModelReport[]> {
  const store = createOpfsModelStore()
  const entries = Object.entries(netManifest)
  return Promise.all(
    entries.map(async ([net, entry]): Promise<ModelReport> => {
      const base = { net, opfsName: entry.opfsName, bytes: entry.bytes }
      try {
        return { ...base, cached: await store.isComplete(entry.opfsName, entry.bytes) }
      } catch (err) {
        return { ...base, cached: null, error: errorText(err) }
      }
    }),
  )
}

/**
 * Sondea WebGPU dentro de un Worker. Devuelve `{ error }` en vez de lanzar: "el worker no arrancó" o
 * "no contestó" son diagnósticos válidos, y de hecho serían LOS diagnósticos si el problema estuviera
 * en el aislamiento cross-origin.
 */
function probeInWorker(): Promise<GpuProbe | { error: string }> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./probeWorker.ts', import.meta.url), { type: 'module' })
  } catch (err) {
    return Promise.resolve({ error: `no se pudo crear el worker: ${errorText(err)}` })
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: GpuProbe | { error: string }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(
      () => finish({ error: `el worker no respondió en ${WORKER_PROBE_TIMEOUT_MS} ms` }),
      WORKER_PROBE_TIMEOUT_MS,
    )
    worker.addEventListener('message', (ev: MessageEvent<ProbeWorkerMessage>) => {
      const data = ev.data
      finish(data.ok ? data.probe : { error: data.error })
    })
    // Un `error` acá suele ser el script del worker que no cargó (COEP, MIME, red): eso es información.
    worker.addEventListener('error', (ev) => finish({ error: `error en el worker: ${ev.message}` }))
  })
}

/** Recolecta el diagnóstico completo. Los dos sondeos de GPU corren en paralelo (son independientes y
 * cada uno puede tardar segundos en un aparato con problemas). */
export async function collectDiagnostics(): Promise<Diagnostics> {
  const [main, worker, serviceWorker, storage, models] = await Promise.all([
    probeGpu(currentProbeEnv('main')),
    probeInWorker(),
    readServiceWorker(),
    readStorage(),
    readModels(),
  ])

  return {
    buildId: BUILD_ID,
    collectedAt: new Date().toISOString(),
    url: window.location.href,
    displayMode: readDisplayMode(),
    language: navigator.language,
    userAgentRaw: navigator.userAgent,
    userAgent: summarizeUserAgent({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
    }),
    serviceWorker,
    storage,
    models,
    main,
    worker,
  }
}
