import { describe, expect, it } from 'vitest'
import type { Engine, Position, RankLevel } from '../src/index'
import { HUMAN_RANKS } from '../src/index'

describe('API pública', () => {
  it('exporta los 29 rangos humanos 20k..9d en orden', () => {
    expect(HUMAN_RANKS.length).toBe(29)
    expect(HUMAN_RANKS[0]).toBe('20k')
    expect(HUMAN_RANKS[28]).toBe('9d')
  })
  it('la interfaz Engine y Position son usables', () => {
    const pos: Position = { boardSize: 19, komi: 7.5, rules: 'chinese', handicap: 0, moves: [] }
    const level: RankLevel = { kind: 'kata', visits: 100 }
    expect(pos.moves.length).toBe(0)
    expect(level.kind).toBe('kata')
  })
})
