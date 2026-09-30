import { describe, expect, it } from 'vitest'
import { displayClock, formatClockMs } from '../src/game/clockFormat'

const cfg = { mainTimeMs: 60_000, byoyomiPeriods: 3, byoyomiPeriodMs: 30_000 }

describe('clockFormat', () => {
  it('formatClockMs rellena a 2 dígitos y no baja de cero', () => {
    expect(formatClockMs(307_000)).toBe('05:07')
    expect(formatClockMs(-5)).toBe('00:00')
  })
  it('displayClock descuenta tiempo principal, cruza a byoyomi y consume períodos', () => {
    const s = { mainTimeRemainingMs: 60_000, byoyomiPeriodsRemaining: 3, inByoyomi: false }
    expect(displayClock(s, cfg, 10_000)).toEqual({ ms: 50_000, periodsRemaining: 3, inByoyomi: false })
    expect(displayClock(s, cfg, 70_000)).toEqual({ ms: 20_000, periodsRemaining: 3, inByoyomi: true })
    expect(displayClock(s, cfg, 100_000)).toEqual({ ms: 20_000, periodsRemaining: 2, inByoyomi: true })
  })
})
