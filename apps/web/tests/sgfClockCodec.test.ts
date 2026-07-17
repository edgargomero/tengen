import { describe, expect, it } from 'vitest'
import type { ClockConfig, ClockState } from '@tengen/engine'
import {
  decodeClockConfig,
  decodeClockState,
  encodeClockConfig,
  encodeClockState,
} from '../src/game/sgfClockCodec'

const CONFIG: ClockConfig = { mainTimeMs: 600_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
const STATE: { black: ClockState; white: ClockState } = {
  black: { mainTimeRemainingMs: 123_400, byoyomiPeriodsRemaining: 5, inByoyomi: false },
  white: { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true },
}

describe('sgfClockCodec — round-trip', () => {
  it('config: encode→decode reconstruye exactamente', () => {
    expect(decodeClockConfig(encodeClockConfig(CONFIG))).toEqual(CONFIG)
  })

  it('estado: encode→decode reconstruye (inByoyomi derivado correctamente)', () => {
    expect(decodeClockState(encodeClockState(STATE))).toEqual(STATE)
  })
})

describe('sgfClockCodec — datos corruptos o incompletos → null, nunca lanza', () => {
  it('config sin TGBT → null', () => {
    expect(decodeClockConfig({ TM: ['600'], TGBP: ['5'] })).toBeNull()
  })

  it('estado sin OW → null', () => {
    expect(decodeClockState({ BL: ['10.0'], WL: ['5.0'], OB: ['3'] })).toBeNull()
  })

  it('config con valores negativos → null', () => {
    expect(decodeClockConfig({ TM: ['-5'], TGBP: ['5'], TGBT: ['30'] })).toBeNull()
  })

  it('estado con texto no numérico → null', () => {
    expect(decodeClockState({ BL: ['x'], WL: ['5.0'], OB: ['3'], OW: ['3'] })).toBeNull()
  })

  it('objeto vacío → null en ambos', () => {
    expect(decodeClockConfig({})).toBeNull()
    expect(decodeClockState({})).toBeNull()
  })
})
