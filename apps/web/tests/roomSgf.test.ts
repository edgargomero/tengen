import { describe, expect, it } from 'vitest'
import type { RoomState } from '@tengen/go-rules'
import { roomToSgf } from '../src/online/roomSgf'
import { importSgf } from '../src/game/sgf'
import { decodeClockState } from '../src/game/sgfClockCodec'

const base = (rules?: 'japanese' | 'chinese'): RoomState =>
  ({
    config: { boardSize: 9, komi: 6.5, handicap: 0, creatorColor: 'black', ...(rules ? { rules } : {}) },
    moves: [],
  }) as unknown as RoomState

describe('roomToSgf', () => {
  it('japonesas → RU[Japanese]', () => expect(roomToSgf(base('japanese'))).toContain('RU[Japanese]'))
  it('sin rules → RU[Chinese]', () => expect(roomToSgf(base())).toContain('RU[Chinese]'))
})

describe('roomToSgf: perder por tiempo', () => {
  const timed = (result: string): RoomState =>
    ({
      config: {
        boardSize: 9, komi: 6.5, handicap: 0, creatorColor: 'black',
        clock: { mainTimeMs: 60_000, byoyomiPeriods: 3, byoyomiPeriodMs: 30_000 },
      },
      moves: [],
      phase: 'ended',
      result,
      clocks: {
        black: { mainTimeRemainingMs: 42_000, byoyomiPeriodsRemaining: 3, inByoyomi: false },
        white: { mainTimeRemainingMs: 17_000, byoyomiPeriodsRemaining: 3, inByoyomi: false },
      },
    }) as unknown as RoomState

  it('ida y vuelta: el reloj del que cayó (negro, W+T) queda en 0 y el otro se conserva', () => {
    let captured: Record<string, string[]> | undefined
    importSgf(roomToSgf(timed('W+T')), (_n, data) => {
      if (data.BL) captured = data
    })
    const st = decodeClockState(captured!)!
    expect(st.black.mainTimeRemainingMs).toBe(0)
    expect(st.black.byoyomiPeriodsRemaining).toBe(0)
    expect(st.white.mainTimeRemainingMs).toBe(17_000)
  })

  it('sin +T los relojes no se tocan', () => {
    let captured: Record<string, string[]> | undefined
    importSgf(roomToSgf(timed('B+R')), (_n, data) => {
      if (data.BL) captured = data
    })
    expect(decodeClockState(captured!)!.black.mainTimeRemainingMs).toBe(42_000)
  })
})
