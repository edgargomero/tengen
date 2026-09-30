import { describe, expect, it } from 'vitest'
import type { RoomState } from '@tengen/go-rules'
import { roomToSgf } from '../src/online/roomSgf'

const base = (rules?: 'japanese' | 'chinese'): RoomState =>
  ({
    config: { boardSize: 9, komi: 6.5, handicap: 0, creatorColor: 'black', ...(rules ? { rules } : {}) },
    moves: [],
  }) as unknown as RoomState

describe('roomToSgf', () => {
  it('japonesas → RU[Japanese]', () => expect(roomToSgf(base('japanese'))).toContain('RU[Japanese]'))
  it('sin rules → RU[Chinese]', () => expect(roomToSgf(base())).toContain('RU[Chinese]'))
})
