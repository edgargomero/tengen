import { describe, expect, it } from 'vitest'
import { setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { buildGameState } from '../src/encoding/gameState'
import { fillFeaturesV7NCHW } from '../src/encoding/featuresV7'
import { createSearch } from '../src/search/mcts'
import type { NNEvaluator, RawEval } from '../src/nn/evaluator'
import type { Move } from '../src/types' // Move público de tengen = { color, vertex }; NO el Move local del vendor

// Mock: policy uniforme salvo un punto favorito; value fijo; determinista.
function mockEvaluator(N: number, favorite: number): NNEvaluator {
  const area = N * N
  return {
    boardSize: N,
    hasMeta: false,
    async evaluate({ batch }): Promise<RawEval> {
      const policy = new Float32Array(batch * area)
      const policyPass = new Float32Array(batch)
      const value = new Float32Array(batch * 3)
      const scoreValue = new Float32Array(batch * 4)
      for (let b = 0; b < batch; b++) {
        for (let i = 0; i < area; i++) policy[b * area + i] = i === favorite ? 3 : 0
        policyPass[b] = -5
        value[b * 3 + 0] = 0.2
        value[b * 3 + 1] = -0.2
        value[b * 3 + 2] = -50 // win ligera
      }
      return { policy, policyPass, value, scoreValue }
    },
  }
}

describe('MCTS', () => {
  // NOTA: los tests 1 y 2 verifican SOLO la mecánica del árbol + el plumbing del evaluador.
  // El mock IGNORA `bin`/`global`/`meta`, así que NO prueban el rewire NCHW. Esa cobertura la
  // aporta el test 3 (bridge de encoding). No leer "mock verde" como "encoding correcto".
  it('con policy que favorece un punto, la jugada más visitada es ese punto', async () => {
    const N = 9,
      favorite = 4 * N + 4 // tengen (centro)
    setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const search = await createSearch({ evaluator: mockEvaluator(N, favorite), state })
    await search.run({ visits: 200, maxTimeMs: 5000, batchSize: 8 })
    const a = search.getAnalysis({ topK: 5, analysisPvLen: 3 })
    const best = a.moves.find((m) => m.order === 0)!
    expect(best.x + best.y * N).toBe(favorite)
    expect(best.visits).toBeGreaterThan(50)
  })

  it('es determinista con el mismo mock y sin ruido', async () => {
    const N = 9
    setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const run = async () => {
      // createSearch debe fijar internamente nnRandomize=false, rootSymmetrySamples=1;
      // wideRootNoise=0 aquí. Cualquier default aleatorio/≠0 hace flaky esta aserción.
      const s = await createSearch({ evaluator: mockEvaluator(N, 40), state, wideRootNoise: 0 })
      await s.run({ visits: 120, maxTimeMs: 5000, batchSize: 4 })
      return s.getAnalysis({ topK: 3, analysisPvLen: 1 }).moves.map((m) => m.visits)
    }
    expect(await run()).toEqual(await run())
  })

  // TEST 3 — GATE DE ENCODING (lo único que verifica el rewire NCHW del cambio (c)).
  // Captura el `bin` del PRIMER evaluate (= root eval en create()) y lo compara contra el
  // oráculo independiente fillFeaturesV7NCHW(buildGameState(pos)) en una posición NO trivial
  // (piedras + ko activo + historial). Si el puente scratch→GameState→fillFeaturesV7NCHW está
  // mal, ESTE test falla (los tests 1/2 no). También cubre la doble fuente de verdad de ko:
  // GameState.koPoint (Task 5) vs la recomputación interna de create() a partir de board/prev/moves.
  it('la costura evaluateBatch produce el bin NCHW exacto (bridge vs fillFeaturesV7NCHW)', async () => {
    const N = 9
    setBoardSize(N)
    // Secuencia que deja un ko simple en el tablero: Negro (2,1) captura la piedra blanca solitaria
    // en (1,1), dejando ko en (1,1). Verificado: buildGameState devuelve koPoint=10 (=(1,1)).
    const moves: Move[] = [
      { color: 'white', vertex: { x: 2, y: 0 } },
      { color: 'black', vertex: { x: 1, y: 0 } },
      { color: 'white', vertex: { x: 1, y: 1 } },
      { color: 'black', vertex: { x: 0, y: 1 } },
      { color: 'white', vertex: { x: 3, y: 1 } },
      { color: 'black', vertex: { x: 1, y: 2 } },
      { color: 'white', vertex: { x: 2, y: 2 } },
      { color: 'black', vertex: { x: 2, y: 1 } }, // captura blanca (1,1) → ko en (1,1)
    ]
    const pos = { boardSize: 9 as const, komi: 7, rules: 'chinese' as const, handicap: 0, moves }
    const state = buildGameState(pos)
    expect(state.koPoint).toBeGreaterThanOrEqual(0) // precondición: hay ko real (plano 6 activo)
    expect(state.recentMoves.length).toBeGreaterThanOrEqual(2) // hay historial (planos 15/16)

    const oracleSpatial = new Float32Array(N * N * 22)
    const oracleGlobal = new Float32Array(19)
    fillFeaturesV7NCHW({ state, outSpatial: oracleSpatial, outGlobal: oracleGlobal })

    let capturedBin: Float32Array | null = null
    let capturedGlobal: Float32Array | null = null
    const capturing: NNEvaluator = {
      boardSize: N,
      hasMeta: false,
      async evaluate({ bin, global, batch }): Promise<RawEval> {
        if (capturedBin === null) {
          capturedBin = bin.slice(0, N * N * 22)
          capturedGlobal = global.slice(0, 19)
        }
        const area = N * N
        const value = new Float32Array(batch * 3)
        for (let b = 0; b < batch; b++) value[b * 3 + 2] = -50 // noResult≈0
        return {
          policy: new Float32Array(batch * area),
          policyPass: new Float32Array(batch),
          value,
          scoreValue: new Float32Array(batch * 4),
        }
      },
    }
    // conservativePass=false → sin supresión de historial extra en el root; el oráculo usa el default.
    await createSearch({ evaluator: capturing, state, conservativePass: false, wideRootNoise: 0 })
    expect(capturedBin).not.toBeNull()
    for (let i = 0; i < N * N * 22; i++) expect(capturedBin![i]).toBeCloseTo(oracleSpatial[i]!, 5)
    for (let i = 0; i < 19; i++) expect(capturedGlobal![i]).toBeCloseTo(oracleGlobal[i]!, 5)
  })
})
