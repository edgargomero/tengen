import { describe, expect, it } from 'vitest'
import type { GameConfig } from '../src/game/gameConfig'
import { networkForOpponent, validateConfig } from '../src/game/gameConfig'

// Config base válida reutilizable; cada test sobrescribe lo que le interesa.
function base(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    boardSize: 19,
    komi: 7.5,
    rules: 'chinese',
    handicap: 0,
    opponent: { kind: 'kata', visits: 100 },
    ...overrides,
  }
}

describe('validateConfig — M-4 (handicap >1 solo en 19×19)', () => {
  it('handicap 2 en 9×9 lanza', () => {
    expect(() => validateConfig(base({ boardSize: 9, handicap: 2 }))).toThrow()
  })

  it('handicap 2 en 13×13 lanza', () => {
    expect(() => validateConfig(base({ boardSize: 13, handicap: 2 }))).toThrow()
  })

  it('handicap 2 en 19×19 NO lanza', () => {
    expect(() => validateConfig(base({ boardSize: 19, handicap: 2 }))).not.toThrow()
  })

  it('handicap 0 es válido en cualquier tamaño', () => {
    expect(validateConfig(base({ boardSize: 9, handicap: 0 })).handicap).toBe(0)
    expect(validateConfig(base({ boardSize: 13, handicap: 0 })).handicap).toBe(0)
  })
})

describe('validateConfig — normalización de handicap', () => {
  it('handicap 1 se normaliza a 0 (solo komi, sin piedra) en cualquier tamaño', () => {
    expect(validateConfig(base({ boardSize: 9, handicap: 1 })).handicap).toBe(0)
    expect(validateConfig(base({ boardSize: 19, handicap: 1 })).handicap).toBe(0)
  })
})

describe('validateConfig — handicap fuera de rango', () => {
  it('handicap negativo lanza', () => {
    expect(() => validateConfig(base({ handicap: -1 }))).toThrow()
  })

  it('handicap no entero lanza', () => {
    expect(() => validateConfig(base({ handicap: 2.5 }))).toThrow()
  })

  it('handicap > 9 lanza', () => {
    expect(() => validateConfig(base({ boardSize: 19, handicap: 10 }))).toThrow()
  })
})

describe('validateConfig — clamp de visits (Task 13a: motor asume visits>=1)', () => {
  it('kata con visits 0 se clampa a 1', () => {
    const out = validateConfig(base({ opponent: { kind: 'kata', visits: 0 } }))
    expect(out.opponent).toEqual({ kind: 'kata', visits: 1 })
  })

  it('kata con visits negativo se clampa a 1', () => {
    const out = validateConfig(base({ opponent: { kind: 'kata', visits: -5 } }))
    expect(out.opponent).toEqual({ kind: 'kata', visits: 1 })
  })

  it('kata con visits >=1 se conserva', () => {
    const out = validateConfig(base({ opponent: { kind: 'kata', visits: 400 } }))
    expect(out.opponent).toEqual({ kind: 'kata', visits: 400 })
  })

  it('opponent human se conserva sin tocar', () => {
    const out = validateConfig(base({ opponent: { kind: 'human', rank: '5k' } }))
    expect(out.opponent).toEqual({ kind: 'human', rank: '5k' })
  })
})

describe('validateConfig — komi finito', () => {
  it('komi NaN lanza', () => {
    expect(() => validateConfig(base({ komi: Number.NaN }))).toThrow()
  })

  it('komi Infinity lanza', () => {
    expect(() => validateConfig(base({ komi: Number.POSITIVE_INFINITY }))).toThrow()
  })

  it('komi 0 (o reverse komi) es válido', () => {
    expect(validateConfig(base({ komi: 0 })).komi).toBe(0)
    expect(validateConfig(base({ komi: -5.5 })).komi).toBe(-5.5)
  })
})

describe('networkForOpponent', () => {
  it('human → humanv0', () => {
    expect(networkForOpponent({ kind: 'human', rank: '1d' })).toBe('humanv0')
  })

  it('kata → b18', () => {
    expect(networkForOpponent({ kind: 'kata', visits: 100 })).toBe('b18')
  })
})
