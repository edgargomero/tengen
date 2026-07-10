import { describe, expect, it } from 'vitest'
import { setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { buildGameState } from '../src/encoding/gameState'
import { sampleHumanMove, rankTemperature } from '../src/humansl'
import { mulberry32 } from '../src/testutil/rng'

describe('Human SL', () => {
  it('temperatura decrece de kyu a dan', () => {
    expect(rankTemperature('20k')).toBeGreaterThan(rankTemperature('9d'))
  })
  it('muestrea una jugada legal; con temp baja elige el máximo de policy', () => {
    const N = 9; setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const policy = new Float32Array(N * N); policy[40] = 10 // centro dominante
    const m = sampleHumanMove({ policy, policyPass: -20, state, rank: '9d', rng: mulberry32(1) })
    expect(m.vertex).toEqual({ x: 4, y: 4 })
  })
  it('no pasa cuando hay jugadas normales (ignora policyPass)', () => {
    const N = 9; setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const policy = new Float32Array(N * N).fill(1)
    const m = sampleHumanMove({ policy, policyPass: -50, state, rank: '5k', rng: mulberry32(2) })
    expect(m.vertex).not.toBe('pass')
  })
  it('muestreo determinista: misma seed produce la misma jugada', () => {
    const N = 9; setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const policy = new Float32Array(N * N)
    for (let i = 0; i < policy.length; i++) policy[i] = (i * 37) % 11 // no trivial, sin dominante único
    const m1 = sampleHumanMove({ policy, policyPass: -10, state, rank: '3k', rng: mulberry32(7) })
    const m2 = sampleHumanMove({ policy, policyPass: -10, state, rank: '3k', rng: mulberry32(7) })
    expect(m1).toEqual(m2)
  })
  it('tablero lleno (sin candidatas) → pasa, ignorando policyPass', () => {
    const N = 9; setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    state.stones.fill(1) // todas ocupadas (BLACK); ninguna EMPTY, así que no hay candidatas
    const policy = new Float32Array(N * N)
    const m = sampleHumanMove({ policy, policyPass: 10, state, rank: '1d', rng: mulberry32(3) })
    expect(m.vertex).toBe('pass')
  })
})
