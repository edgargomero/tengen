import { describe, expect, it } from 'vitest'
import { LocalEngine } from '../src/index'
import { gtpToVertex } from '../src/engine'
import type { NNEvaluator, RawEval } from '../src/nn/evaluator'

// Mock kata: policy con un logit alto en el centro (tengen) + pase bajo; hasMeta=false.
// Mismo patrón que el mock probado en mcts.test.ts (produce una mejor jugada NO-pase con ≥100 visitas).
function makeMock(N: number): NNEvaluator {
  const area = N * N
  const favorite = ((N / 2) | 0) * N + ((N / 2) | 0) // centro
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
        value[b * 3 + 2] = -50 // noResult ≈ 0
      }
      return { policy, policyPass, value, scoreValue }
    },
  }
}

// Mock Human SL: hasMeta=true; policy sintética NO degenerada (pico marcado en el centro sobre un
// fondo bajo pero no uniforme) para que el muestreo con temperatura tenga una distribución real.
function humanMock(N: number): NNEvaluator {
  const area = N * N
  const favorite = ((N / 2) | 0) * N + ((N / 2) | 0) // centro
  return {
    boardSize: N,
    hasMeta: true,
    async evaluate({ batch }): Promise<RawEval> {
      const policy = new Float32Array(batch * area)
      const policyPass = new Float32Array(batch)
      const value = new Float32Array(batch * 3)
      const scoreValue = new Float32Array(batch * 4)
      for (let b = 0; b < batch; b++) {
        for (let i = 0; i < area; i++) policy[b * area + i] = i === favorite ? 4 : (i % 3) - 1
        policyPass[b] = -8
      }
      return { policy, policyPass, value, scoreValue }
    },
  }
}

const EMPTY_9 = { boardSize: 9 as const, komi: 7, rules: 'chinese' as const, handicap: 0, moves: [] }

describe('LocalEngine', () => {
  it('genMove kata devuelve una jugada legal en perspectiva de Negro', async () => {
    const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N) })
    await eng.init({ network: 'b18', boardSize: 9 })
    const move = await eng.genMove(
      { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] },
      { level: { kind: 'kata', visits: 100 } },
    )
    expect(move.color).toBe('black')
    expect(move.vertex).not.toBe('pass')
  })
  it('analyze emite al menos un update y stop lo cancela', async () => {
    const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N) })
    await eng.init({ network: 'b18', boardSize: 9 })
    const updates: number[] = []
    const cancel = eng.analyze(
      { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] },
      { visits: 500 },
      (a) => updates.push(a.visits),
    )
    await new Promise((r) => setTimeout(r, 50))
    cancel()
    expect(updates.length).toBeGreaterThan(0)
  })

  it('genMove human muestrea una jugada legal en persp. Negro y es determinista por seed', async () => {
    const play = async () => {
      const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => humanMock(N), seed: 1 })
      await eng.init({ network: 'humanv0', boardSize: 9 })
      return eng.genMove(EMPTY_9, { level: { kind: 'human', rank: '5k' } })
    }
    const move = await play()
    expect(move.color).toBe('black')
    expect(move.vertex).not.toBe('pass')
    // Determinismo: mismo seed → mismo vértice (rng sembrado idéntico + policy idéntica).
    const move2 = await play()
    expect(move2.vertex).toEqual(move.vertex)
  })

  it('genMove human con un evaluador sin meta lanza un error claro', async () => {
    const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N) }) // hasMeta=false
    await eng.init({ network: 'humanv0', boardSize: 9 })
    await expect(
      eng.genMove(EMPTY_9, { level: { kind: 'human', rank: '5k' } }),
    ).rejects.toThrow(/hasMeta/)
  })

  it('stop() también cancela analyze', async () => {
    const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N) })
    await eng.init({ network: 'b18', boardSize: 9 })
    const updates: number[] = []
    eng.analyze(EMPTY_9, { visits: 500 }, (a) => updates.push(a.visits))
    await new Promise((r) => setTimeout(r, 50))
    eng.stop()
    expect(updates.length).toBeGreaterThan(0)
  })
})

describe('gtpToVertex (frontera del salto de I)', () => {
  it("decodifica la columna saltando 'I': 'H'→x=7, 'J'→x=8", () => {
    // El brief testea SOLO la columna con estos strings sin número (la frontera del salto de 'I').
    expect((gtpToVertex('H', 9) as { x: number }).x).toBe(7)
    expect((gtpToVertex('J', 9) as { x: number }).x).toBe(8) // 'J' (col 9) salta 'I' → x = 9-1 = 8
  })
  it('mapea una coordenada real completa (columna + fila) y el pase', () => {
    expect(gtpToVertex('A1', 9)).toEqual({ x: 0, y: 8 }) // fila 1 → y = 9-1 = 8
    expect(gtpToVertex('J9', 9)).toEqual({ x: 8, y: 0 }) // 'J' salta 'I' → x=8; fila 9 → y=0
    expect(gtpToVertex('pass', 9)).toBe('pass')
  })
})
