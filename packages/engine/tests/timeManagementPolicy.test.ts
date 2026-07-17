import { describe, expect, it } from 'vitest'
import { computeBaseBudgetMs, timeManagementPolicy } from '../src/search/timeManagementPolicy'
import type { ClockConfig, ClockState } from '../src/types'

const CONFIG: ClockConfig = { mainTimeMs: 40_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }

describe('computeBaseBudgetMs', () => {
  it('en tiempo principal: remaining / 40', () => {
    const state: ClockState = { mainTimeRemainingMs: 40_000, byoyomiPeriodsRemaining: 5, inByoyomi: false }
    expect(computeBaseBudgetMs(CONFIG, state)).toBe(1000) // 40000/40
  })

  it('respeta el piso mínimo de 1000ms', () => {
    const state: ClockState = { mainTimeRemainingMs: 4_000, byoyomiPeriodsRemaining: 5, inByoyomi: false }
    expect(computeBaseBudgetMs(CONFIG, state)).toBe(1000) // 4000/40=100, pero el piso es 1000
  })

  it('en byoyomi: período × 0.85', () => {
    const state: ClockState = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 5, inByoyomi: true }
    expect(computeBaseBudgetMs(CONFIG, state)).toBe(25_500) // 30000*0.85
  })
})

describe('timeManagementPolicy — dentro del presupuesto', () => {
  it('continúa si aún no llegó al presupuesto y no hay suficiente historial', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 500,
      budgetMs: 1000,
      visitShareHistory: [0.9],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('continue')
  })

  it('corta por convergencia: participación estable ±2% tras usar ≥25% del presupuesto', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 300,
      budgetMs: 1000,
      visitShareHistory: [0.8, 0.81],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('stop')
  })

  it('NO corta por convergencia si el presupuesto usado es menor al 25%', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 100,
      budgetMs: 1000,
      visitShareHistory: [0.8, 0.81],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('continue')
  })

  it('NO corta por convergencia si la participación varió más de ±2%', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 300,
      budgetMs: 1000,
      visitShareHistory: [0.7, 0.85],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('continue')
  })
})

describe('timeManagementPolicy — al agotar el presupuesto', () => {
  it('extiende ×1.5 si las 2 mejores jugadas están muy cerca en value', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 1000,
      budgetMs: 1000,
      visitShareHistory: [0.6, 0.6],
      valueGap: 0.01,
      alreadyExtended: false,
    })
    expect(decision).toEqual({ extendTo: 1500 })
  })

  it('corta si el gap ya es grande (posición no reñida)', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 1000,
      budgetMs: 1000,
      visitShareHistory: [0.9, 0.9],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('stop')
  })

  it('nunca concede una segunda extensión', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 1500,
      budgetMs: 1500,
      visitShareHistory: [0.6, 0.6],
      valueGap: 0.01,
      alreadyExtended: true,
    })
    expect(decision).toBe('stop')
  })
})
