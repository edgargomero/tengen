import { describe, expect, it } from 'vitest'
import type { Analysis, CancelFn, Engine, Move, MoveAnalysis, NetworkId, Position, Vertex } from '@tengen/engine'
import { EngineManager } from '../src/engine/engineManager'
import type { ManagedEngine, ManagedEngineFactory } from '../src/engine/engineManager'
import { ReviewScheduler } from '../src/analysis/reviewScheduler'
import { guessAgainstEngine, guessVerdict, scoreGuess } from '../src/analysis/guessAgainstEngine'

// ─────────────────────────────────────────────────────────────────────────────
// `scoreGuess`/`guessVerdict` son puertos verbatim de web-katrain (solo comparan
// vértices, ver cabecera de guessAgainstEngine.ts). `guessAgainstEngine` es la
// función nativa que reemplaza el insumo del vendor (kifu → `ReviewScheduler`):
// desviación deliberada del texto literal del plan (que dice "EngineManager.analyze"),
// documentada en la cabecera del archivo — el foco de estos tests de integración es
// que la candidata MÁS VISITADA se identifique correctamente incluso con visits
// desordenadas en `analysis.moves` (mismo tipo de test que Task 5 usó para `order`).
// ─────────────────────────────────────────────────────────────────────────────

const POS: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }

function mkMoveAnalysis(vertex: Vertex, overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return { vertex, visits: 10, winrate: 0.5, scoreLead: 0, prior: 0.1, pv: [], ...overrides }
}

function mkAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits: 50, moves: [], ...overrides }
}

type AnalyzeBehavior = { chunks: Analysis[]; error?: unknown }
type AnalyzeCall = { visits: number; cancelled: boolean }

/** Mismo motor falso "scriptable" que `reviewScheduler.test.ts`/`gameReview.test.ts`. */
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

async function makeReadyScheduler(): Promise<{ scheduler: ReviewScheduler; engine: ScriptableEngine }> {
  const engine = new ScriptableEngine()
  const factory: ManagedEngineFactory = (): ManagedEngine => ({ engine, terminate: () => {}, onError: () => {} })
  const mgr = new EngineManager(factory)
  await mgr.ensureReady('b18' as NetworkId, 9)
  return { scheduler: new ReviewScheduler(mgr), engine }
}

describe('scoreGuess', () => {
  it('distancia 0 → correct=true', () => {
    expect(scoreGuess({ x: 3, y: 3 }, 3, 3)).toEqual({ correct: true, distance: 0 })
  })

  it('distancia Manhattan > 0 → correct=false', () => {
    expect(scoreGuess({ x: 3, y: 3 }, 4, 5)).toEqual({ correct: false, distance: 3 })
  })
})

describe('guessVerdict — umbrales exactos del código fuente portado', () => {
  it('correct=true → Exact match!/success (sin importar distance)', () => {
    expect(guessVerdict({ correct: true, distance: 0 })).toEqual({ label: 'Exact match!', tone: 'success' })
  })

  it('distance<=2 (no correcto) → Very close/warning', () => {
    expect(guessVerdict({ correct: false, distance: 1 })).toEqual({ label: 'Very close', tone: 'warning' })
    expect(guessVerdict({ correct: false, distance: 2 })).toEqual({ label: 'Very close', tone: 'warning' })
  })

  it('2 < distance <= 5 → In the area/warning', () => {
    expect(guessVerdict({ correct: false, distance: 3 })).toEqual({ label: 'In the area', tone: 'warning' })
    expect(guessVerdict({ correct: false, distance: 5 })).toEqual({ label: 'In the area', tone: 'warning' })
  })

  it('distance > 5 → Off the mark/danger', () => {
    expect(guessVerdict({ correct: false, distance: 6 })).toEqual({ label: 'Off the mark', tone: 'danger' })
  })
})

describe('guessAgainstEngine', () => {
  it('identifica la candidata MÁS VISITADA aunque analysis.moves llegue desordenado por visits', async () => {
    const { scheduler, engine } = await makeReadyScheduler()
    engine.programNext({
      chunks: [
        mkAnalysis({
          visits: 100,
          moves: [
            mkMoveAnalysis({ x: 5, y: 5 }, { visits: 10 }),
            mkMoveAnalysis({ x: 1, y: 1 }, { visits: 100 }), // la más visitada, NO es la primera del array.
            mkMoveAnalysis({ x: 2, y: 2 }, { visits: 50 }),
          ],
        }),
      ],
    })

    const result = await guessAgainstEngine({ pos: POS, guess: { x: 8, y: 8 }, visits: 100, scheduler })

    expect(result.expected).toEqual({ x: 1, y: 1 })
  })

  it('guess exacto sobre la candidata esperada → outcome.correct===true', async () => {
    const { scheduler, engine } = await makeReadyScheduler()
    engine.programNext({
      chunks: [mkAnalysis({ visits: 100, moves: [mkMoveAnalysis({ x: 4, y: 4 }, { visits: 100 })] })],
    })

    const result = await guessAgainstEngine({ pos: POS, guess: { x: 4, y: 4 }, visits: 100, scheduler })

    expect(result.outcome).toEqual({ correct: true, distance: 0 })
    expect(result.verdict).toEqual({ label: 'Exact match!', tone: 'success' })
  })

  it("candidata esperada de PASE → un click de tablero nunca puede coincidir: correct=false, distance=Infinity, tone danger", async () => {
    const { scheduler, engine } = await makeReadyScheduler()
    engine.programNext({
      chunks: [
        mkAnalysis({
          visits: 100,
          moves: [mkMoveAnalysis('pass', { visits: 50 }), mkMoveAnalysis({ x: 0, y: 0 }, { visits: 10 })],
        }),
      ],
    })

    const result = await guessAgainstEngine({ pos: POS, guess: { x: 0, y: 0 }, visits: 100, scheduler })

    expect(result.expected).toBe('pass')
    expect(result.outcome).toEqual({ correct: false, distance: Infinity })
    expect(result.verdict).toEqual({ label: 'Off the mark', tone: 'danger' })
  })

  it('analysis.moves vacío → rechaza con un error explícito, no un resultado inventado', async () => {
    const { scheduler, engine } = await makeReadyScheduler()
    engine.programNext({ chunks: [mkAnalysis({ visits: 100, moves: [] })] })

    await expect(guessAgainstEngine({ pos: POS, guess: { x: 0, y: 0 }, visits: 100, scheduler })).rejects.toThrow()
  })
})
