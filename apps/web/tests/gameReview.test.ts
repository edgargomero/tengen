import { describe, expect, it } from 'vitest'
import type { Analysis, CancelFn, Engine, Move, MoveAnalysis, NetworkId, Position, Vertex } from '@tengen/engine'
import { EngineManager } from '../src/engine/engineManager'
import type { ManagedEngine, ManagedEngineFactory } from '../src/engine/engineManager'
import { ReviewScheduler } from '../src/analysis/reviewScheduler'
import { AnalysisStore } from '../src/analysis/analysisStore'
import { GameTree } from '../src/game/gameTree'
import { GameReview, getReportTurningPoints } from '../src/analysis/gameReview'

// ─────────────────────────────────────────────────────────────────────────────
// `GameReview` (Task 7) es el orquestador que UNE `AnalysisStore` (Task 2),
// `katrainAdapter.ts` (Task 5), `computeGameReport` (Task 4) y `ReviewScheduler`
// (Task 6): recorre la línea principal, encola análisis de fondo por nodo sin
// caché, y recomputa el reporte progresivamente. El foco de estos tests, en el
// orden que pide el brief de la tarea: (1) la raíz TAMBIÉN se analiza — si no,
// la jugada 1 se omite en silencio del reporte (contrato documentado en
// katrainAdapter.ts); (2) progreso incremental de verdad, sin esperar toda la
// línea; (3) turning points disponibles sobre un reporte parcial; (4)
// idempotencia (nodo ya cacheado no se re-encola); (5) reencolado tras
// cancelación benigna (preempt); (6) error real → `failed`, sin bloquear el
// resto; (7) `dispose()` durante una cancelación benigna en vuelo no reencola
// (la "trampa" documentada explícitamente en el brief).
// ─────────────────────────────────────────────────────────────────────────────

function tree9(): GameTree {
  return new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
}

const B = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const W = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })

const VISITS = 50

function mkMoveAnalysis(vertex: Vertex, overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return { vertex, visits: 10, winrate: 0.5, scoreLead: 0, prior: 0.1, pv: [], ...overrides }
}

function mkAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits: VISITS, moves: [], ...overrides }
}

/**
 * `Analysis` "lista para reporte": trae una candidata dummy para que
 * `hasReportCandidateMoves`/`isReportReadyAnalysis` (gameReport.ts, Task 4) den true sin necesidad
 * de que la candidata calce con la jugada realmente jugada — esos tests viven en
 * katrainAdapter.test.ts/gameReport.test.ts, no aquí.
 */
function mkReportReadyAnalysis(scoreLead: number): Analysis {
  return mkAnalysis({ scoreLead, moves: [mkMoveAnalysis({ x: 8, y: 8 })] })
}

type AnalyzeBehavior = { chunks: Analysis[]; error?: unknown }
type AnalyzeCall = { visits: number; cancelled: boolean }

/**
 * Mismo motor falso "scriptable" que `reviewScheduler.test.ts` (Task 6): soporta varias llamadas
 * consecutivas a `analyze`, cada una con su comportamiento programado vía `programNext`, consumido
 * en orden FIFO según cuándo cada llamada LLEGA DE VERDAD al motor (no según cuándo se programó).
 */
class ScriptableEngine implements Engine {
  calls: AnalyzeCall[] = []
  private behaviors: AnalyzeBehavior[] = []

  programNext(behavior: AnalyzeBehavior): void {
    this.behaviors.push(behavior)
  }

  async init(): Promise<void> {}

  genMove(): Promise<Move> {
    throw new Error('ScriptableEngine: genMove no usado en estos tests')
  }

  analyze(_pos: Position, opts: { visits: number }, onUpdate: (a: Analysis) => void, onError?: (e: unknown) => void): CancelFn {
    const behavior = this.behaviors.shift() ?? { chunks: [] }
    const call: AnalyzeCall = { visits: opts.visits, cancelled: false }
    this.calls.push(call)
    for (const chunk of behavior.chunks) onUpdate(chunk)
    if (behavior.error !== undefined) onError?.(behavior.error)
    return () => {
      call.cancelled = true
    }
  }

  stop(): void {}
}

function makeHarness(): { mgr: EngineManager; engine: ScriptableEngine } {
  const engine = new ScriptableEngine()
  const factory: ManagedEngineFactory = (): ManagedEngine => ({
    engine,
    terminate: () => {},
    onError: () => {},
  })
  return { mgr: new EngineManager(factory), engine }
}

async function makeReadyHarness(): Promise<{ mgr: EngineManager; engine: ScriptableEngine }> {
  const h = makeHarness()
  await h.mgr.ensureReady('b18' as NetworkId, 9)
  return h
}

/** Vacía la cola de microtareas (deja avanzar `reconcile()` + el enganche de `EngineManager.analyze`). */
async function flush(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

// ── 1. La raíz también se analiza ────────────────────────────────────────────────────────────

describe('GameReview — la raíz también se analiza', () => {
  it('root + jugada 1 analizadas (y solo esas dos) → moveEntries incluye la jugada 1 con pointsLost numérico', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2)) // única jugada → targets = [raíz, jugada1]

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })

    // Orden de encolado documentado por el brief: [raíz, ...mainLine()] — la raíz se consume PRIMERO.
    engine.programNext({ chunks: [mkReportReadyAnalysis(5)] }) // raíz
    engine.programNext({ chunks: [mkReportReadyAnalysis(3)] }) // jugada 1

    await review.start(() => {})

    expect(engine.calls).toHaveLength(2)
    expect(store.has(tree.root.id)).toBe(true)
    const m1 = tree.mainLine()[0]!
    expect(store.has(m1.id)).toBe(true)
    // Prueba directa del orden de encolado: la raíz consumió el 1er behavior (scoreLead=5), la
    // jugada 1 el 2º (scoreLead=3) — si el orden estuviera invertido, estos valores se cruzarían.
    expect(store.get(tree.root.id)!.scoreLead).toBe(5)
    expect(store.get(m1.id)!.scoreLead).toBe(3)

    const finalReport = review.getLatestReport()!
    expect(finalReport.moveEntries).toHaveLength(1)
    expect(finalReport.moveEntries[0]!.moveNumber).toBe(1)
    expect(typeof finalReport.moveEntries[0]!.pointsLost).toBe('number')
    expect(Number.isFinite(finalReport.moveEntries[0]!.pointsLost)).toBe(true)
  })
})

// ── 2. Progreso incremental ──────────────────────────────────────────────────────────────────

describe('GameReview — progreso incremental (progresivo de verdad, sin esperar toda la línea)', () => {
  it('tras resolver root + jugada 1 de una partida de 3 jugadas, onReport ya trae 1 entrada; progress() refleja el done parcial', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2))
    tree.addMove(W(6, 6))
    tree.addMove(B(4, 4))

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })
    const reports: ReturnType<typeof review.getLatestReport>[] = []

    engine.programNext({ chunks: [mkReportReadyAnalysis(0)] }) // raíz
    engine.programNext({ chunks: [mkReportReadyAnalysis(2)] }) // jugada 1
    // jugada 2 y jugada 3: sin behavior programado → sus jobs quedan colgados (pendiente/activo).

    const startPromise = review.start((report) => reports.push(report), 0)
    await flush(24)

    expect(reports.length).toBeGreaterThanOrEqual(2) // al menos: tras la raíz, tras la jugada 1
    const lastReport = reports[reports.length - 1]!
    expect(lastReport.moveEntries).toHaveLength(1) // solo jugada 1 — ni vacío ni completo (había 3)

    const p = review.progress(1000)!
    expect(p).not.toBeNull()
    expect(p.countLabel).toBe('2/4') // raíz + jugada1 done, de un total de 4 (raíz + 3 jugadas)

    review.dispose() // limpieza: asienta los jobs colgados (jugada 2/3) sin reencolarlos.
    await startPromise // no debe colgar tras dispose().
  })
})

// ── 3. Turning points antes de terminar ──────────────────────────────────────────────────────

describe('GameReview — turning points disponibles antes de terminar toda la línea', () => {
  it('con solo raíz+jugada1+jugada2 analizadas de una partida de 4 jugadas, getReportTurningPoints ya devuelve el salto grande fabricado', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2))
    tree.addMove(W(6, 6))
    tree.addMove(B(4, 4))
    tree.addMove(W(0, 8))

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })

    engine.programNext({ chunks: [mkReportReadyAnalysis(0)] }) // raíz
    engine.programNext({ chunks: [mkReportReadyAnalysis(0)] }) // jugada 1: sin pérdida
    engine.programNext({ chunks: [mkReportReadyAnalysis(8)] }) // jugada 2: salto grande fabricado (0→8)
    // jugadas 3 y 4: sin behavior → quedan colgadas.

    const startPromise = review.start(() => {})
    await flush(32)

    const report = review.getLatestReport()!
    expect(report.moveEntries.length).toBeGreaterThanOrEqual(2)
    expect(report.moveEntries.length).toBeLessThan(4) // no llegó a analizar toda la línea (4 jugadas)

    const turningPoints = getReportTurningPoints(report.moveEntries)
    expect(turningPoints).toHaveLength(1)
    expect(turningPoints[0]!.moveNumber).toBe(2) // la jugada 2 es el salto grande fabricado

    review.dispose()
    await startPromise
  })
})

// ── 4. Idempotencia ──────────────────────────────────────────────────────────────────────────

describe('GameReview — idempotencia: nodo ya en analysisStore no se re-encola', () => {
  it('con TODOS los nodos objetivo ya en el store, start() no llama al motor y resuelve con el reporte completo derivado del cache', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2))
    tree.addMove(W(6, 6))

    // Prepobla el store ANTES de construir/arrancar GameReview — raíz + ambas jugadas.
    store.set(tree.root.id, mkReportReadyAnalysis(0))
    const [m1, m2] = tree.mainLine()
    store.set(m1!.id, mkReportReadyAnalysis(1))
    store.set(m2!.id, mkReportReadyAnalysis(2))

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })
    const reports: ReturnType<typeof review.getLatestReport>[] = []

    await review.start((report) => reports.push(report))

    expect(engine.calls).toHaveLength(0) // cero jobs encolados: el mock del motor nunca se invocó
    expect(reports).toHaveLength(1)
    expect(reports[0]!.moveEntries).toHaveLength(2) // reporte completo, derivado 100% del cache
    expect(review.getLatestReport()).toBe(reports[0])

    const p = review.progress(1000)!
    expect(p.countLabel).toBe('3/3')
  })
})

// ── 5. Reencolado tras cancelación benigna ───────────────────────────────────────────────────

describe('GameReview — reencolado tras cancelación benigna (preempt de un análisis interactivo)', () => {
  it('el nodo preemptado termina analizado igual tras el reintento, sin bloquear el resto de la partida ni quedar en failed', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2)) // única jugada → targets = [raíz, jugada1]

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })

    // 1) la raíz se resuelve normal; jugada1 arranca de verdad en el motor y queda colgada (activa).
    engine.programNext({ chunks: [mkReportReadyAnalysis(0)] })
    const startPromise = review.start(() => {})
    await flush(16)

    expect(store.has(tree.root.id)).toBe(true)
    expect(engine.calls).toHaveLength(2) // raíz + jugada1 (jugada1 colgada, sin behavior programado)

    // 2) un análisis interactivo (MISMO scheduler) preempta el job de jugada1 EN CURSO.
    engine.programNext({ chunks: [mkReportReadyAnalysis(99)] }) // consumido por el interactivo
    engine.programNext({ chunks: [mkReportReadyAnalysis(3)] }) // consumido por el REINTENTO de jugada1
    const pInteractive = scheduler.analyzePosition({
      pos: tree.positionAt(tree.root),
      visits: VISITS,
      priority: 'interactive',
      group: 'nav',
    })
    await expect(pInteractive).resolves.toMatchObject({ visits: VISITS })

    await flush(24) // deja que el reintento de jugada1 llegue de verdad al motor y se resuelva
    await startPromise // no cuelga: raíz y jugada1 (tras el reintento) terminaron en el store.

    const m1 = tree.mainLine()[0]!
    expect(store.has(m1.id)).toBe(true)
    expect(store.get(m1.id)!.scoreLead).toBe(3) // ganó el análisis del REINTENTO, no el preemptado

    const finalReport = review.getLatestReport()!
    expect(finalReport.moveEntries).toHaveLength(1)
    expect(finalReport.moveEntries[0]!.moveNumber).toBe(1)

    const p = review.progress(1000)!
    expect(p.countLabel).toBe('2/2') // completo — el nodo preemptado NO quedó en `failed`
    expect(engine.calls).toHaveLength(4) // raíz + jugada1(preemptada) + interactivo + jugada1(reintento)
    expect(engine.calls[1]!.cancelled).toBe(true) // el CancelFn real de jugada1 original se invocó
  })
})

// ── 6. Error real → failed, sin bloquear el resto ────────────────────────────────────────────

describe('GameReview — error real del motor → failed, sin bloquear el resto de la partida', () => {
  it('el nodo que falla queda excluido del reporte final; progress() igual llega a total/total; el resto sí se analiza y aparece en el reporte', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2))
    tree.addMove(W(6, 6))

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })

    engine.programNext({ chunks: [mkReportReadyAnalysis(0)] }) // raíz: éxito
    engine.programNext({ chunks: [mkReportReadyAnalysis(2)] }) // jugada 1: éxito
    engine.programNext({ chunks: [], error: new Error('motor: crash determinista en jugada 2') }) // jugada 2: error real

    await review.start(() => {})

    const [m1, m2] = tree.mainLine()
    expect(store.has(tree.root.id)).toBe(true)
    expect(store.has(m1!.id)).toBe(true)
    expect(store.has(m2!.id)).toBe(false) // el nodo que falló nunca gana .analysis

    const p = review.progress(1000)!
    expect(p.countLabel).toBe('3/3') // done cuenta la renuncia definitiva como "terminado"

    const finalReport = review.getLatestReport()!
    // Jugada 1 SÍ aparece (el resto de la partida siguió progresando pese al error en jugada 2).
    expect(finalReport.moveEntries).toHaveLength(1)
    expect(finalReport.moveEntries[0]!.moveNumber).toBe(1)
    expect(typeof finalReport.moveEntries[0]!.pointsLost).toBe('number')
  })
})

// ── 7. dispose() durante una cancelación benigna en vuelo no reencola ───────────────────────

describe('GameReview — dispose() durante una cancelación benigna en vuelo no reencola', () => {
  it('si dispose() corre en el mismo turno síncrono que el preempt, no hay una nueva llamada al motor para el nodo afectado', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2)) // targets = [raíz, jugada1]

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })

    engine.programNext({ chunks: [mkReportReadyAnalysis(0)] }) // raíz
    void review.start(() => {})
    await flush(16) // raíz resuelve; jugada1 llega de verdad al motor y queda activa (colgada)

    expect(engine.calls).toHaveLength(2)

    // Preempta jugada1 (interactive, MISMO scheduler) y, EN EL MISMO TURNO SÍNCRONO (sin ningún
    // `await` entre medio), dispose() la instancia — la "trampa" documentada por el brief: si el
    // guard de `disposed` no estuviera DENTRO del handler de reencolado (solo al principio de
    // `start()`), la cancelación benigna de jugada1 reencolaría de todos modos.
    //
    // Deliberado: el interactivo SÍ resuelve (a diferencia de dejarlo colgado) — si se dejara
    // colgado, la cola quedaría bloqueada para SIEMPRE (nunca libera el slot "activo"), y un
    // eventual reencolado indebido de jugada1 JAMÁS llegaría a tocar el motor sea cual sea el
    // comportamiento de la implementación — el test pasaría igual con o sin el guard, sin probar
    // nada. Dejando que el interactivo resuelva y la cola drene de verdad, un reencolado indebido
    // SÍ tendría oportunidad real de generar una 4ª llamada al motor — lo que hace este test
    // diagnóstico de verdad.
    engine.programNext({ chunks: [mkReportReadyAnalysis(99)] })
    const pInteractive = scheduler.analyzePosition({
      pos: tree.positionAt(tree.root),
      visits: VISITS,
      priority: 'interactive',
      group: 'nav',
    })
    review.dispose()

    await expect(pInteractive).resolves.toMatchObject({ visits: VISITS })
    await flush(32) // deja drenar la cola por completo — si hubiera un reencolado indebido, llegaría al motor aquí

    expect(engine.calls).toHaveLength(3) // raíz + jugada1(preemptada) + interactivo — NINGUNA 4ª llamada
    expect(engine.calls[1]!.cancelled).toBe(true) // jugada1 sí fue preemptada de verdad (no un no-op)
  })
})

// ── 8. Finding 1 (fix-wave del review final): el review no pisa un análisis interactivo que
// llegó mientras su propio job para ese nodo seguía en vuelo ─────────────────────────────────
//
// Escenario del bug real (`start()` encola TODO al montar, con el store vacío): el usuario analiza
// a mano una posición (`AnalyzeView.tsx` `handleAnalyzeClick`, 200 visitas) ANTES de que le toque el
// turno a su job de review ya encolado (100 visitas) — cuando ese job de review finalmente se
// asienta con éxito, NO debe sobrescribir el resultado interactivo, de mayor calidad, que ya está en
// el store. A diferencia del test de idempotencia (#4, arriba), que prepobla el store ANTES de
// `start()` — ahí el guard de ENCOLADO (`!store.has(node.id)` en `start()`) ya evita que se encole
// nada, así que nunca llega a ejercitar el guard de ESCRITURA del handler de éxito. Aquí la escritura
// interactiva llega DESPUÉS de que el job de review ya está encolado/activo, así que solo el guard en
// el sitio de escritura (`analyzeTarget`) puede salvar el resultado interactivo.
describe('GameReview — Finding 1: no pisa un análisis interactivo que llegó mientras su job de review estaba en vuelo', () => {
  it('jugada1 recibe un análisis interactivo mientras su job de review sigue activo; cuando el job de review (tras reintento) se asienta con éxito, el store conserva el valor interactivo', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2)) // única jugada → targets = [raíz, jugada1]

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })

    // 1) la raíz se resuelve normal; jugada1 arranca de verdad en el motor y queda colgada (activa,
    // sin behavior programado todavía) — mismo arranque que el test de "reencolado tras cancelación
    // benigna" (#5).
    engine.programNext({ chunks: [mkReportReadyAnalysis(0)] })
    const startPromise = review.start(() => {})
    await flush(16)

    expect(store.has(tree.root.id)).toBe(true)
    const m1 = tree.mainLine()[0]!
    expect(store.has(m1.id)).toBe(false) // jugada1 aún NO tiene análisis — su job de review sigue en vuelo

    // 2) simula el resultado de una interacción del usuario ("Analizar esta posición", 200 visitas en
    // producción) que aterriza en el store MIENTRAS el job de review de jugada1 (100 visitas en
    // producción) sigue activo, sin haberse asentado todavía.
    const interactiveAnalysis = mkReportReadyAnalysis(999)
    store.set(m1.id, interactiveAnalysis)

    // 3) preempta el job de review de jugada1 EN CURSO con un análisis interactivo real del scheduler
    // (mismo mecanismo que el test #5) — esto es solo el vehículo para controlar CUÁNDO el REINTENTO
    // del job de review de jugada1 llega al motor y se asienta con éxito (con SU PROPIO resultado,
    // distinto del interactivo simulado en el paso 2).
    engine.programNext({ chunks: [mkReportReadyAnalysis(50)] }) // consumido por el interactivo (irrelevante al assert)
    engine.programNext({ chunks: [mkReportReadyAnalysis(3)] }) // consumido por el REINTENTO del job de review de jugada1
    const pInteractive = scheduler.analyzePosition({
      pos: tree.positionAt(tree.root),
      visits: VISITS,
      priority: 'interactive',
      group: 'nav',
    })
    await expect(pInteractive).resolves.toMatchObject({ visits: VISITS })

    await flush(24) // deja que el REINTENTO del job de review de jugada1 llegue al motor y se asiente con éxito
    await startPromise // no cuelga: raíz y jugada1 (vía el reintento) terminaron asentados

    // 4) el job de review de jugada1 SÍ se asentó con éxito (scoreLead=3, ver programNext arriba) —
    // pero el store debe conservar el valor interactivo (999), no el del review (3): la escritura del
    // handler de éxito debe haber sido un no-op porque el store YA tenía algo para ese nodo.
    expect(store.get(m1.id)).toBe(interactiveAnalysis) // MISMA referencia: cero escritura, no solo "mismo valor"
    expect(store.get(m1.id)!.scoreLead).toBe(999)

    review.dispose()
  })
})

// ── 9. Fase 6: un nodo sembrado con MENOS visitas que las pedidas se re-analiza y se actualiza ──

describe('GameReview — Fase 6: nodo sembrado con menos visitas se re-analiza y el resultado nuevo reemplaza al sembrado', () => {
  it('re-encola y sobreescribe un análisis sembrado con menos visitas que `deps.visits`', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2)) // única jugada → targets = [raíz, jugada1]

    // Sembrado (p.ej. desde un SGF reabierto) con 10 visitas — MENOS que lo que este review pide (VISITS=50).
    store.set(tree.root.id, mkAnalysis({ visits: 10, scoreLead: 0, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))
    const m1 = tree.mainLine()[0]!
    store.set(m1.id, mkAnalysis({ visits: 10, scoreLead: 1, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })

    engine.programNext({ chunks: [mkAnalysis({ visits: VISITS, scoreLead: 9, moves: [mkMoveAnalysis({ x: 8, y: 8 })] })] }) // raíz, mejora
    engine.programNext({ chunks: [mkAnalysis({ visits: VISITS, scoreLead: 7, moves: [mkMoveAnalysis({ x: 8, y: 8 })] })] }) // jugada1, mejora

    await review.start(() => {})

    expect(engine.calls).toHaveLength(2) // SÍ se re-analizaron (no se saltaron)
    expect(store.get(tree.root.id)!.visits).toBe(VISITS)
    expect(store.get(tree.root.id)!.scoreLead).toBe(9) // el sembrado (scoreLead=0) fue reemplazado
    expect(store.get(m1.id)!.visits).toBe(VISITS)
    expect(store.get(m1.id)!.scoreLead).toBe(7)
  })
})

// ── 10. Fase 6: un nodo sembrado con visitas SUFICIENTES no se re-encola ─────────────────────

describe('GameReview — Fase 6: nodo sembrado con visitas suficientes NO se re-encola (objetivo central de esta fase)', () => {
  it('con todo el store sembrado a MÁS visitas de las pedidas, start() no llama al motor ni una vez', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2))
    tree.addMove(W(6, 6))

    const [m1, m2] = tree.mainLine()
    store.set(tree.root.id, mkAnalysis({ visits: VISITS + 50, scoreLead: 0, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))
    store.set(m1!.id, mkAnalysis({ visits: VISITS + 50, scoreLead: 1, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))
    store.set(m2!.id, mkAnalysis({ visits: VISITS + 50, scoreLead: 2, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })
    const reports: ReturnType<typeof review.getLatestReport>[] = []

    await review.start((report) => reports.push(report))

    expect(engine.calls).toHaveLength(0) // cero re-análisis: el objetivo central de esta fase
    expect(reports[0]!.moveEntries).toHaveLength(2)
    const p = review.progress(1000)!
    expect(p.countLabel).toBe('3/3')
  })
})
