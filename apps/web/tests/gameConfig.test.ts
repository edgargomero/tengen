import { describe, expect, it } from 'vitest'
import type { GameConfig } from '../src/game/gameConfig'
import { networkForOpponent, oppositeColor, resolveHumanColor, validateConfig } from '../src/game/gameConfig'

// Config base válida reutilizable; cada test sobrescribe lo que le interesa.
function base(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    boardSize: 19,
    komi: 7.5,
    rules: 'chinese',
    handicap: 0,
    opponent: { kind: 'kata', visits: 100 },
    humanColor: 'black',
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

describe('resolveHumanColor — sorteo del nigiri (rng inyectable)', () => {
  it('negro/blanco fijos son identidad (no sortean)', () => {
    // rng que lanzaría si se lo llamara: prueba que el camino fijo NUNCA sortea.
    const boom = (): number => {
      throw new Error('no debe sortear en color fijo')
    }
    expect(resolveHumanColor('black', boom)).toBe('black')
    expect(resolveHumanColor('white', boom)).toBe('white')
  })

  it('nigiri: rng < 0.5 → negro', () => {
    expect(resolveHumanColor('nigiri', () => 0.2)).toBe('black')
  })

  it('nigiri: rng >= 0.5 → blanco', () => {
    expect(resolveHumanColor('nigiri', () => 0.7)).toBe('white')
  })

  it('nigiri: frontera exacta 0.5 → blanco (el corte es `< 0.5`)', () => {
    expect(resolveHumanColor('nigiri', () => 0.5)).toBe('white')
  })
})

describe('oppositeColor', () => {
  it('negro↔blanco, ida y vuelta', () => {
    expect(oppositeColor('black')).toBe('white')
    expect(oppositeColor('white')).toBe('black')
    expect(oppositeColor(oppositeColor('black'))).toBe('black')
  })
})

describe('validateConfig — humanColor', () => {
  it('humanColor=white con handicap 0 se conserva', () => {
    expect(validateConfig(base({ boardSize: 9, handicap: 0, humanColor: 'white' })).humanColor).toBe('white')
  })

  it('humanColor=white con handicap 1 (normalizado a 0) se conserva', () => {
    expect(validateConfig(base({ boardSize: 19, handicap: 1, humanColor: 'white' })).humanColor).toBe('white')
  })

  it('handicap≥2 fuerza humanColor a negro (el humano toma el handicap)', () => {
    expect(validateConfig(base({ boardSize: 19, handicap: 2, humanColor: 'white' })).humanColor).toBe('black')
  })

  it('humanColor siempre presente en la salida (default negro)', () => {
    expect(validateConfig(base()).humanColor).toBe('black')
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

describe('validateConfig — reloj (opcional)', () => {
  it('sin clock, el resultado no incluye la clave', () => {
    const out = validateConfig(base())
    expect(out.clock).toBeUndefined()
  })

  it('clock válido se conserva tal cual', () => {
    const clock = { mainTimeMs: 600_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    const out = validateConfig(base({ clock }))
    expect(out.clock).toEqual(clock)
  })

  it('mainTimeMs negativo lanza', () => {
    expect(() =>
      validateConfig(base({ clock: { mainTimeMs: -1, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 } })),
    ).toThrow(/mainTimeMs/)
  })

  it('byoyomiPeriods no entero lanza', () => {
    expect(() =>
      validateConfig(base({ clock: { mainTimeMs: 600_000, byoyomiPeriods: 2.5, byoyomiPeriodMs: 30_000 } })),
    ).toThrow(/byoyomiPeriods/)
  })

  it('mainTimeMs=0 y byoyomiPeriods=0 juntos lanza (perdería al instante)', () => {
    expect(() =>
      validateConfig(base({ clock: { mainTimeMs: 0, byoyomiPeriods: 0, byoyomiPeriodMs: 0 } })),
    ).toThrow()
  })

  it('mainTimeMs=0 con byoyomi configurado es válido (byoyomi desde el arranque)', () => {
    const clock = { mainTimeMs: 0, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    expect(validateConfig(base({ clock })).clock).toEqual(clock)
  })

  it('byoyomiPeriods=0 con mainTimeMs>0 es válido (solo tiempo principal, sin red de seguridad)', () => {
    const clock = { mainTimeMs: 600_000, byoyomiPeriods: 0, byoyomiPeriodMs: 0 }
    expect(validateConfig(base({ clock })).clock).toEqual(clock)
  })
})
