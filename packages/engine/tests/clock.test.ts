import { describe, expect, it } from 'vitest'
import { applyElapsed, initialClockState } from '../src/clock/clock'
import type { ClockConfig, ClockState } from '../src/types'

const CONFIG: ClockConfig = { mainTimeMs: 60_000, byoyomiPeriods: 3, byoyomiPeriodMs: 10_000 }

describe('initialClockState', () => {
  it('con tiempo principal > 0, arranca fuera de byoyomi', () => {
    expect(initialClockState(CONFIG)).toEqual({
      mainTimeRemainingMs: 60_000,
      byoyomiPeriodsRemaining: 3,
      inByoyomi: false,
    })
  })

  it('con mainTimeMs=0, arranca directo en byoyomi', () => {
    const config: ClockConfig = { mainTimeMs: 0, byoyomiPeriods: 3, byoyomiPeriodMs: 10_000 }
    expect(initialClockState(config)).toEqual({
      mainTimeRemainingMs: 0,
      byoyomiPeriodsRemaining: 3,
      inByoyomi: true,
    })
  })
})

describe('applyElapsed — tiempo principal', () => {
  it('descuenta del pozo principal si no se agota', () => {
    const state: ClockState = { mainTimeRemainingMs: 60_000, byoyomiPeriodsRemaining: 3, inByoyomi: false }
    const { state: next, timedOut } = applyElapsed(state, CONFIG, 20_000)
    expect(timedOut).toBe(false)
    expect(next).toEqual({ mainTimeRemainingMs: 40_000, byoyomiPeriodsRemaining: 3, inByoyomi: false })
  })

  it('al agotarse exactamente, entra en byoyomi sin consumir período', () => {
    const state: ClockState = { mainTimeRemainingMs: 10_000, byoyomiPeriodsRemaining: 3, inByoyomi: false }
    const { state: next, timedOut } = applyElapsed(state, CONFIG, 10_000)
    expect(timedOut).toBe(false)
    expect(next).toEqual({ mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true })
  })

  it('si el excedente ya excede un período completo de byoyomi, lo consume', () => {
    const state: ClockState = { mainTimeRemainingMs: 10_000, byoyomiPeriodsRemaining: 3, inByoyomi: false }
    // 10s de tiempo principal + 15s de más → 15s "usados" en byoyomi → 1 período de 10s consumido.
    const { state: next, timedOut } = applyElapsed(state, CONFIG, 25_000)
    expect(timedOut).toBe(false)
    expect(next).toEqual({ mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 2, inByoyomi: true })
  })
})

describe('applyElapsed — byoyomi', () => {
  const IN_BYOYOMI: ClockState = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true }

  it('jugar dentro del período lo recicla completo (no consume ninguno)', () => {
    const { state: next, timedOut } = applyElapsed(IN_BYOYOMI, CONFIG, 7_000)
    expect(timedOut).toBe(false)
    expect(next).toEqual({ mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true })
  })

  it('exceder el período consume exactamente uno', () => {
    const { state: next, timedOut } = applyElapsed(IN_BYOYOMI, CONFIG, 15_000)
    expect(timedOut).toBe(false)
    expect(next.byoyomiPeriodsRemaining).toBe(2)
  })

  it('exceder por más de un período consume varios (regla general, no un caso especial)', () => {
    const { state: next, timedOut } = applyElapsed(IN_BYOYOMI, CONFIG, 25_000) // 2 períodos de 10s
    expect(timedOut).toBe(false)
    expect(next.byoyomiPeriodsRemaining).toBe(1)
  })

  it('consumir más períodos de los que quedan → timedOut', () => {
    const { timedOut } = applyElapsed(IN_BYOYOMI, CONFIG, 999_000)
    expect(timedOut).toBe(true)
  })

  it('perder el último período → timedOut', () => {
    const lastPeriod: ClockState = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 1, inByoyomi: true }
    const { timedOut } = applyElapsed(lastPeriod, CONFIG, 15_000)
    expect(timedOut).toBe(true)
  })

  it('sin byoyomi configurado, cualquier tiempo en byoyomi es timeout', () => {
    const noByoyomi: ClockConfig = { mainTimeMs: 60_000, byoyomiPeriods: 0, byoyomiPeriodMs: 0 }
    const state: ClockState = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 0, inByoyomi: true }
    expect(applyElapsed(state, noByoyomi, 1).timedOut).toBe(true)
  })
})
