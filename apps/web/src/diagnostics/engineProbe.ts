// Prueba del motor EN el dispositivo: corre tandas de análisis reales y mide cada una.
//
// ── Por qué hace falta ────────────────────────────────────────────────────────────────────────
// Hasta acá, cada número de rendimiento del proyecto viene del M1 de fase 0 (2,79 inf/s batch 1, 4,64
// batch 8) y todo lo dicho sobre un teléfono es una extrapolación con un factor inventado. Eso alcanzaba
// mientras el motor sólo corría en escritorio; no alcanza para decidir si un iPhone necesita una red más
// chica, que es el trabajo más incierto de este plan.
//
// ── Qué distingue, y por qué son TANDAS y no una sola medición ────────────────────────────────
// El síntoma a explicar es "funciona, se calienta y muere tras varias jugadas" con el preset MÁS BAJO
// (50 visitas), o sea sin un presupuesto que lo justifique. Una sola medición no separa las causas
// posibles; varias tandas iguales sí:
//
//   · Tandas de duración ESTABLE → nada se degrada. El dispositivo es lento y punto, y la respuesta es
//     ajustar presupuesto (o una red más chica), no cazar un bug.
//   · Tandas que se van ALARGANDO → algo crece: presión de memoria, GC, thrashing. Es la firma del bug
//     conocido de onnxruntime en modo JSEP sobre Safari (microsoft/onnxruntime#26827, memoria creciendo
//     hasta matar el proceso), y también la que dejaría una fuga propia.
//   · Muere a mitad → cuántas tandas aguantó es el dato, y compararlo entre repartos distintos separa
//     ACUMULACIÓN de TECHO (ver `PROBE_PRESETS`). Que muera NO alcanza para saber por qué muere:
//     medido en un iPhone 12 Pro Max real (6 GB, Safari 26), murió tras la primera tanda de 20 visitas
//     — dato que encaja igual de bien con las dos causas, y por eso el reparto es configurable.
//
// Corre el motor DE VERDAD (el mismo Worker, la misma sesión ONNX, el mismo MCTS) en vez de sintetizar
// inferencias sueltas: lo que hay que medir es el camino que falla, no una aproximación suya.
import { GameTree } from '../game/gameTree'
import { EngineManager } from '../engine/engineManager'
import { createWorkerManagedEngine } from '../engine/workerManagedEngine'
import { requireManifestEntry } from '../models/netManifest'
import { createOpfsModelStore } from '../models/modelStore'
import { ensureModel } from '../models/modelCache'
import { errorText } from './gpuProbe'
import type { BoardSize, NetworkId } from '@tengen/engine'

const PROBE_BOARD_SIZE: BoardSize = 19

/**
 * Qué red probar. Son las DOS del producto, y hay que poder elegir porque son dos experiencias
 * distintas: contra KataGo se juega con `b18`, contra el oponente estilo humano con `humanv0`. Medir
 * sólo una deja sin respuesta "¿y el modo que yo uso?".
 *
 * Pesan casi lo mismo (115,8 y 108,0 MB) y comparten arquitectura, así que cambiar de red **no** mide el
 * efecto del TAMAÑO — para eso haría falta una red chica, que hoy no está convertida. Lo que sí mide es
 * si el fallo es del pipeline (ambas mueren) o de una red en particular.
 */
export const PROBE_NETWORKS = [
  { id: 'b18' as NetworkId, label: 'KataGo' },
  { id: 'humanv0' as NetworkId, label: 'Human SL' },
] as const

/** Visitas por tanda del reparto por defecto. */
export const PROBE_VISITS_PER_ROUND = 20
export const PROBE_ROUNDS = 6

/**
 * Formas de repartir el trabajo. Los dos primeros existen para separar dos mecanismos que un solo tamaño
 * de tanda NO distingue, y que llevan a arreglos opuestos:
 *
 * · **Acumulación** — algo crece con cada inferencia hasta cruzar el límite. Entonces el aparato muere
 *   cerca de la misma cuenta ACUMULADA sin importar cómo se agrupen: ~30 inferencias son ~30 tanto en
 *   tandas de 20 como en tandas de 5.
 * · **Techo** — nada crece, pero el conjunto de trabajo de una tanda no entra bajo el límite por pestaña.
 *   Entonces las tandas chicas sobreviven indefinidamente y sólo mueren las grandes.
 *
 * Con una fuga, achicar el modelo sólo corre el crash más adelante; con un techo, achicarlo ES el
 * arreglo. La decisión más cara del plan depende de cuál sea, así que se mide en vez de suponerse.
 *
 * `jugada` no mide mecanismos: mide PRODUCTO. 50 visitas es exactamente una jugada del preset "Fuerza
 * baja", así que tres tandas son tres jugadas de la IA. Si eso no sobrevive, no hay partida posible en
 * este dispositivo — y esa respuesta no necesita ninguna otra medición.
 */
export const PROBE_PRESETS = [
  { id: 'fina', label: 'Fina', visitsPerRound: 5, rounds: 12 },
  { id: 'normal', label: 'Normal', visitsPerRound: PROBE_VISITS_PER_ROUND, rounds: PROBE_ROUNDS },
  { id: 'jugada', label: 'Jugada real', visitsPerRound: 50, rounds: 3 },
] as const

export type ProbePresetId = (typeof PROBE_PRESETS)[number]['id']

/** Tope por tanda. Muy por encima de los 30 s de producción a propósito: acá el objetivo es MEDIR
 * cuánto tarda, y cortar a los 30 s escondería justamente el dato que se busca. */
const PROBE_TIMEOUT_MS = 120_000

export interface EngineRound {
  /** 1-based, como se muestra. */
  round: number
  visits: number
  ms: number
  visitsPerSecond: number
}

export interface EngineProbeResult {
  /** `false` = el modelo no está descargado en este dispositivo; no hay nada que medir todavía. */
  modelInOpfs: boolean
  /** Cuánto tardó en levantar el Worker + la sesión ONNX (los 115,8 MB a la GPU). */
  initMs?: number
  rounds: EngineRound[]
  /** Presente si algo falló; las tandas ya completadas siguen siendo válidas y se devuelven igual. */
  error?: string
}

// ── Persistencia de las tandas: convertir el crash en dato ─────────────────────────────────────
//
// El fallo que se investiga mata el proceso ("a veces se recarga sola"). Cuando eso pasa, el DOM se va
// con él y las tandas medidas hasta ese momento —la única evidencia de CUÁNTO aguantó— desaparecen.
// Guardarlas tras cada tanda invierte eso: el crash deja de borrar la prueba y pasa a ser parte de ella.
// Si al abrir la pantalla hay una corrida guardada que nunca reportó su final, ESE es el resultado.

const PROBE_STORAGE_KEY = 'tengen:engine-probe:v1'

export interface StoredProbe {
  /** ISO de cuándo se guardó, para poder decir "esto es de antes" y no confundirlo con la corrida actual. */
  at: string
  initMs?: number
  rounds: EngineRound[]
  /** `true` si la corrida llegó a su fin (con éxito o con error reportado). `false` = quedó a mitad, que
   * en este contexto significa casi siempre que el proceso murió. */
  finished: boolean
  /** Cuántas tandas se habían pedido. Se guarda porque el reparto es configurable: sin esto, un "alcanzó
   * 3 tandas" no se puede leer (¿de 6 o de 12?), y comparar dos corridas es justamente el experimento. */
  totalRounds?: number
  error?: string
}

function isEngineRound(value: unknown): value is EngineRound {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.round === 'number' &&
    typeof r.visits === 'number' &&
    typeof r.ms === 'number' &&
    typeof r.visitsPerSecond === 'number'
  )
}

/** Lee la corrida guardada. Nunca lanza: ante dato ausente, corrupto o de otra versión devuelve `null`
 * — mismo criterio que `loadGame`/`loadAnalyzeSpeed`. */
export function loadStoredProbe(storage: Pick<Storage, 'getItem'>): StoredProbe | null {
  try {
    const raw = storage.getItem(PROBE_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    if (typeof p.at !== 'string' || !Array.isArray(p.rounds) || !p.rounds.every(isEngineRound)) return null
    const stored: StoredProbe = { at: p.at, rounds: p.rounds, finished: p.finished === true }
    if (typeof p.initMs === 'number') stored.initMs = p.initMs
    if (typeof p.totalRounds === 'number') stored.totalRounds = p.totalRounds
    if (typeof p.error === 'string') stored.error = p.error
    return stored
  } catch {
    return null
  }
}

/** Guarda el estado parcial. Best-effort: un storage lleno o bloqueado no debe interrumpir la medición,
 * que es lo que de verdad importa. */
export function saveStoredProbe(storage: Pick<Storage, 'setItem'>, probe: StoredProbe): void {
  try {
    storage.setItem(PROBE_STORAGE_KEY, JSON.stringify(probe))
  } catch {
    // Sin persistencia se pierde sólo la evidencia post-crash, no la corrida en curso.
  }
}

/**
 * Compara la primera mitad de las tandas contra la segunda. Es la señal que separa "lento" de "con
 * fuga", y se calcula acá (no en la UI) para que el número que se muestra y el que se razona sean el
 * mismo. `null` si no hay tandas suficientes para comparar.
 */
export function slowdownRatio(rounds: EngineRound[]): number | null {
  if (rounds.length < 4) return null
  const half = Math.floor(rounds.length / 2)
  const mean = (rs: EngineRound[]): number => rs.reduce((sum, r) => sum + r.ms, 0) / rs.length
  const first = mean(rounds.slice(0, half))
  const last = mean(rounds.slice(rounds.length - half))
  if (first <= 0) return null
  return last / first
}

/**
 * Corre la prueba. Nunca lanza: un fallo se devuelve en `error` junto con las tandas que sí se
 * completaron — en una prueba cuyo objetivo es capturar un fallo, perder los datos previos al fallo
 * sería perder el resultado.
 *
 * `onRound` se llama al terminar cada tanda para que la UI muestre el progreso: si el proceso muere a
 * mitad (el caso que se está investigando), lo ya reportado es lo único que va a sobrevivir.
 */
export async function probeEngine(opts?: {
  /** Qué red medir. Default `b18` (la de KataGo, que es la que Analizar ya deja en OPFS). */
  network?: NetworkId
  /** Si la red no está descargada, bajarla en vez de rendirse. Lo decide el caller porque son ~110 MB
   * y esta pantalla no debe iniciar una descarga así sin que alguien la haya pedido. */
  download?: boolean
  onDownloadProgress?: (receivedBytes: number, totalBytes: number) => void
  rounds?: number
  visitsPerRound?: number
  onRound?: (round: EngineRound, all: EngineRound[]) => void
  /** Dónde persistir el parcial tras cada tanda. Inyectable para poder testear la lógica sin navegador;
   * la UI pasa `window.localStorage`. Omitirlo = no persistir. */
  storage?: Pick<Storage, 'setItem'>
  /** Reloj inyectable para la marca de tiempo del registro guardado (los tests necesitan determinismo,
   * mismo criterio que el resto del proyecto: nunca `Date.now()` escondido adentro). */
  nowIso?: () => string
}): Promise<EngineProbeResult> {
  const network = opts?.network ?? 'b18'
  const totalRounds = opts?.rounds ?? PROBE_ROUNDS
  const visits = opts?.visitsPerRound ?? PROBE_VISITS_PER_ROUND
  const rounds: EngineRound[] = []
  const nowIso = opts?.nowIso ?? ((): string => new Date().toISOString())
  const persist = (partial: Omit<StoredProbe, 'at' | 'totalRounds'>): void => {
    if (opts?.storage) saveStoredProbe(opts.storage, { at: nowIso(), totalRounds, ...partial })
  }

  // El modelo tiene que estar YA en OPFS: bajar 115,8 MB desde una pantalla de diagnóstico sin avisar
  // sería hostil, y en el dispositivo que interesa ya está (jugó una partida).
  const entry = requireManifestEntry(network)
  const store = createOpfsModelStore()
  let modelInOpfs = false
  try {
    modelInOpfs = await store.isComplete(entry.opfsName, entry.bytes)
  } catch (err) {
    return { modelInOpfs: false, rounds, error: `no se pudo consultar OPFS: ${errorText(err)}` }
  }
  if (!modelInOpfs) {
    if (!opts?.download) {
      return {
        modelInOpfs: false,
        rounds,
        error: `el modelo ${network} todavía no está en este dispositivo (${entry.opfsName}, ${Math.round(entry.bytes / 1e6)} MB).`,
      }
    }
    try {
      await ensureModel(network, store, (url) => fetch(url), (p) => opts.onDownloadProgress?.(p.receivedBytes, p.totalBytes ?? entry.bytes))
      modelInOpfs = true
    } catch (err) {
      return { modelInOpfs: false, rounds, error: `no se pudo descargar ${network}: ${errorText(err)}` }
    }
  }

  const manager = new EngineManager(createWorkerManagedEngine)
  // Posición vacía de 19×19: la misma para todas las tandas, así el trabajo pedido es idéntico y la
  // única variable que queda es el estado del dispositivo. Ese es el punto de la medición.
  const tree = new GameTree({
    boardSize: PROBE_BOARD_SIZE,
    komi: 6.5,
    rules: 'chinese',
    handicap: 0,
    humanColor: 'black',
  })
  const position = tree.positionAt(tree.root)

  // Marca la corrida como EMPEZADA y sin terminar antes de tocar el motor: si el proceso muere durante
  // el arranque (bajar 115,8 MB a la GPU es el pico de memoria más grande de la app), al recargar se sabrá
  // que murió ahí y no que nunca se intentó.
  persist({ rounds: [], finished: false })

  try {
    const initStart = performance.now()
    await manager.ensureReady(network, PROBE_BOARD_SIZE)
    const initMs = Math.round(performance.now() - initStart)
    persist({ initMs, rounds: [], finished: false })

    for (let round = 1; round <= totalRounds; round++) {
      const start = performance.now()
      const analysis = await manager.analyzeToScore(position, visits, PROBE_TIMEOUT_MS)
      const ms = Math.round(performance.now() - start)
      // `analysis.visits` es lo que el motor REALMENTE alcanzó, que puede quedar por debajo de lo pedido
      // si se agotó el tope de tiempo interno. Medir sobre lo pedido inflaría el resultado.
      const done = analysis.visits > 0 ? analysis.visits : visits
      const entryRound: EngineRound = {
        round,
        visits: done,
        ms,
        visitsPerSecond: ms > 0 ? Math.round((done / ms) * 1000 * 10) / 10 : 0,
      }
      rounds.push(entryRound)
      // Persistir ANTES de avisar a la UI: si el aparato muere en este instante, lo que queda escrito es
      // lo que va a poder leerse después.
      persist({ initMs, rounds: [...rounds], finished: false })
      opts?.onRound?.(entryRound, [...rounds])
    }
    persist({ initMs, rounds: [...rounds], finished: true })
    return { modelInOpfs, initMs, rounds }
  } catch (err) {
    const error = errorText(err)
    persist({ rounds: [...rounds], finished: true, error })
    return { modelInOpfs, rounds, error }
  } finally {
    // Siempre: sin esto queda un Worker con 115,8 MB en la GPU vivo mientras la pantalla siga abierta —
    // justo lo que no hay que hacer en el dispositivo que se está investigando por memoria.
    manager.dispose()
  }
}
