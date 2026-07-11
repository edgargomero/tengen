import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineManager } from '../src/engine/engineManager'
import type { ManagedEngine, ManagedEngineFactory } from '../src/engine/engineManager'
import { AnalysisQueueCanceledError, isAnalysisQueueCanceledError, isAnalysisQueueStaleError } from '../src/analysis/vendor/web-katrain/analysisQueue'
import { REVIEW_PRIORITIES, ReviewScheduler } from '../src/analysis/reviewScheduler'
import type { Analysis, CancelFn, Engine, Move, NetworkId, Position } from '@tengen/engine'

// ─────────────────────────────────────────────────────────────────────────────
// El foco real de esta tarea (hallazgo 21): `ReviewScheduler` adapta el streaming
// puro de `EngineManager.analyze` (Task 2) a la forma `(ctx) => Promise<Analysis>`
// que exige un job de `AnalysisQueue`. Si `runAnalyzeJob` no se asienta en TODOS
// sus caminos (éxito/error/abort/timeout) llamando al `CancelFn` real, un job
// abortado se queda "zombie" en `active` para siempre y `pump()` deja de arrancar
// jobs nuevos — la cola ENTERA se congela, no solo la llamada abortada.
//
// Mismo patrón de mock que `engineManager.test.ts` (factory programable, sin
// Worker real), pero con un motor SCRIPTABLE: a diferencia de ese archivo (que
// solo necesita UNA llamada a `analyze` por test), aquí necesitamos varias
// llamadas consecutivas con comportamientos DISTINTOS (una que nunca completa,
// otra que sí) para probar preempt/cancelGroup sobre jobs realmente en curso.
// ─────────────────────────────────────────────────────────────────────────────

const POS: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }

function mkAnalysis(visits: number): Analysis {
  return { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits, moves: [] }
}

type AnalyzeBehavior = { chunks: Analysis[]; error?: unknown }
type AnalyzeCall = { visits: number; cancelled: boolean }

/**
 * Motor falso que soporta VARIAS llamadas a `analyze` en secuencia, cada una con
 * su propio comportamiento programado vía `programNext`. Cada llamada consume el
 * comportamiento programado más reciente en orden FIFO (o `{chunks: []}` si no
 * se programó nada) y registra su propio `cancelled` independiente — así un test
 * puede verificar que el `CancelFn` REAL de una llamada específica se invocó, no
 * solo el wrapper no-op de `EngineManager.analyze`.
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

afterEach(() => {
  vi.useRealTimers()
})

describe('ReviewScheduler.analyzePosition — los 4 caminos de asentamiento', () => {
  it('éxito: visits alcanzadas → resuelve con el Analysis y cancela el motor real igual', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    engine.programNext({ chunks: [mkAnalysis(50), mkAnalysis(100)] })
    const result = await scheduler.analyzePosition({ pos: POS, visits: 100, priority: 'review', group: 'g' })

    expect(result.visits).toBe(100)
    expect(engine.calls).toHaveLength(1)
    expect(engine.calls[0]!.cancelled).toBe(true) // streaming no para solo al alcanzar el target
  })

  it('error del motor: onError dispara → rechaza con ese error y cancela', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    const boom = new Error('motor: crash determinista')
    engine.programNext({ chunks: [mkAnalysis(30)], error: boom })

    await expect(scheduler.analyzePosition({ pos: POS, visits: 100, priority: 'review', group: 'g' })).rejects.toBe(boom)
    expect(engine.calls[0]!.cancelled).toBe(true)
  })

  it('abort de la cola: cancelGroup sobre un job activo → rechaza AnalysisQueueCanceledError y cancela', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    engine.programNext({ chunks: [] }) // nunca alcanza el target por sí solo → queda "activo"
    const p = scheduler.analyzePosition({ pos: POS, visits: 100, priority: 'review', group: 'g' })
    await flush() // deja que el análisis real arranque en el motor mock

    const count = scheduler.cancelGroup('g')

    expect(count).toBe(1)
    await expect(p).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    expect(engine.calls[0]!.cancelled).toBe(true)
  })

  it('timeout con parcial: sin alcanzar el target, resuelve best-effort con el último Analysis recibido', async () => {
    vi.useFakeTimers()
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    engine.programNext({ chunks: [mkAnalysis(40)] }) // nunca alcanza 100
    const p = scheduler.analyzePosition({ pos: POS, visits: 100, priority: 'review', group: 'g', timeoutMs: 5_000 })
    await vi.advanceTimersByTimeAsync(5_000)

    const result = await p
    expect(result.visits).toBe(40)
    expect(engine.calls[0]!.cancelled).toBe(true)
  })

  it('timeout sin ningún parcial: rechaza, y el rechazo NO matchea los type guards de cancel/stale', async () => {
    vi.useFakeTimers()
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    engine.programNext({ chunks: [] }) // no emite nada
    const p = scheduler.analyzePosition({ pos: POS, visits: 100, priority: 'review', group: 'g', timeoutMs: 5_000 })
    const expectation = expect(p).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(5_000)
    await expectation

    await p.catch((e) => {
      expect(isAnalysisQueueCanceledError(e)).toBe(false)
      expect(isAnalysisQueueStaleError(e)).toBe(false)
    })
    expect(engine.calls[0]!.cancelled).toBe(true)
  })
})

describe('ReviewScheduler — settle-on-abort (hallazgo 21, aserción central de la tarea)', () => {
  it('preemptar un job de review EN CURSO no atasca pump(): un 3er job encolado después sí llega a correr', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    // 1) review arranca de verdad en el motor (mock que nunca completa por sí solo).
    engine.programNext({ chunks: [] })
    const pReview = scheduler.analyzePosition({ pos: POS, visits: 100, priority: 'review', group: 'review-group' })
    await flush()
    expect(engine.calls).toHaveLength(1) // confirma que de verdad llegó a "activo" en el motor, no solo pendiente

    // 2) interactive preempta al review activo.
    engine.programNext({ chunks: [mkAnalysis(100)] })
    const pInteractive = scheduler.analyzePosition({ pos: POS, visits: 100, priority: 'interactive', group: 'nav' })

    await expect(pReview).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    // El CancelFn REAL del motor (no solo un wrapper no-op) se invocó para el job preemptado —
    // sin esto, el "motor" seguiría calculando y su cola FIFO interna quedaría ocupada.
    expect(engine.calls[0]!.cancelled).toBe(true)

    await expect(pInteractive).resolves.toMatchObject({ visits: 100 })

    // 3) LA PRUEBA CENTRAL: un job encolado DESPUÉS de todo esto debe llegar a correr — si
    // `runAnalyzeJob` hubiera dejado el job de review sin asentar tras el abort, seguiría en
    // `active` para siempre y `pump()` jamás arrancaría este tercer job (el test colgaría/fallaría
    // por timeout en vez de resolver).
    engine.programNext({ chunks: [mkAnalysis(64)] })
    const pThird = scheduler.analyzePosition({ pos: POS, visits: 64, priority: 'review', group: 'review-group' })
    await expect(pThird).resolves.toMatchObject({ visits: 64 })
    expect(engine.calls).toHaveLength(3)
  })

  it('preempt de interactive sobre review usa los valores reales de prioridad (100 vs 20), no inventados', async () => {
    expect(REVIEW_PRIORITIES.interactive).toBe(100)
    expect(REVIEW_PRIORITIES.review).toBe(20)

    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    engine.programNext({ chunks: [] })
    const pReview = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'review', group: 'r' })
    await flush()

    engine.programNext({ chunks: [mkAnalysis(10)] })
    const pInteractive = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'interactive', group: 'nav' })

    await expect(pReview).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    await expect(pInteractive).resolves.toMatchObject({ visits: 10 })
  })

  it('sin deadlock tras una sucesión de cancelaciones mezclando cancelGroup (activo+pendiente) y preempt', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    // Job 1: review, activo, colgado.
    engine.programNext({ chunks: [] })
    const p1 = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'review', group: 'cancel-me' })
    await flush()

    // Job 2: review, pendiente, mismo grupo que 1 — cancelado mientras pendiente, nunca llega al motor.
    const p2 = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'review', group: 'cancel-me' })
    // Job 3: review, pendiente, OTRO grupo — sobrevive al cancelGroup de abajo. Su comportamiento se
    // programa YA (antes de cualquier `await`), en el mismo turno síncrono que su `enqueue` — el
    // mock consume comportamientos en orden FIFO según cuándo cada job LLEGA de verdad al motor, así
    // que programar después de un `await` arriesga una carrera con el comportamiento del job
    // siguiente (exactamente el bug que este archivo tenía antes de este fix).
    engine.programNext({ chunks: [] })
    const p3 = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'review', group: 'survivor' })

    const canceled = scheduler.cancelGroup('cancel-me')
    expect(canceled).toBe(2) // 1 activo (Job 1) + 1 pendiente (Job 2)

    await expect(p1).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    await expect(p2).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    await flush() // deja que Job 3 arranque DE VERDAD en el motor (consume su comportamiento programado)

    // Job 4: interactive — preempta a Job 3 EN CURSO. Se programa antes de encolarlo (mismo patrón).
    engine.programNext({ chunks: [mkAnalysis(10)] })
    const p4 = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'interactive', group: 'nav' })
    await expect(p3).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    await expect(p4).resolves.toMatchObject({ visits: 10 })

    // Job 5: la prueba de que la cola sigue viva tras toda la secuencia de cancelaciones.
    engine.programNext({ chunks: [mkAnalysis(3)] })
    const p5 = scheduler.analyzePosition({ pos: POS, visits: 3, priority: 'review', group: 'final' })
    await expect(p5).resolves.toMatchObject({ visits: 3 })
  })
})

describe('ReviewScheduler.cancelGroup', () => {
  it('cancela solo el grupo pedido; el resto de la cola sigue procesándose', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    engine.programNext({ chunks: [] })
    const pA = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'review', group: 'A' })
    await flush()

    // Comportamiento de pB programado YA, junto a su enqueue (antes de cualquier `await`) — mismo
    // motivo que el comentario del test de "sin deadlock": evita una carrera de FIFO compartido.
    engine.programNext({ chunks: [mkAnalysis(10)] })
    const pB = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'review', group: 'B' }) // pendiente

    const count = scheduler.cancelGroup('A')
    expect(count).toBe(1)
    await expect(pA).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    await expect(pB).resolves.toMatchObject({ visits: 10 })
  })
})

describe('ReviewScheduler.dispose', () => {
  it('cancela pending+active; ninguna promesa queda sin asentar', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)

    engine.programNext({ chunks: [] })
    const pActive = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'review', group: 'a' })
    await flush()

    const pPending = scheduler.analyzePosition({ pos: POS, visits: 10, priority: 'review', group: 'b' })

    scheduler.dispose()

    await expect(pActive).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    await expect(pPending).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    expect(engine.calls[0]!.cancelled).toBe(true)
  })
})
