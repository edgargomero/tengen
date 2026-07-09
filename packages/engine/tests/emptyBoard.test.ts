import { describe, expect, it } from 'vitest'
import { emptyBoardInputs } from '../src/bench/emptyBoard'

describe('emptyBoardInputs', () => {
  it('dimensiones correctas para 19x19 batch 1', () => {
    const { bin, global } = emptyBoardInputs(19, 7.5, 1)
    expect(bin.length).toBe(22 * 19 * 19)
    expect(global.length).toBe(19)
  })
  it('plano 0 todo unos, planos 1-21 todo ceros', () => {
    const { bin } = emptyBoardInputs(9, 7.5, 1)
    const plane = 9 * 9
    expect(bin.slice(0, plane).every((v) => v === 1)).toBe(true)
    expect(bin.slice(plane).every((v) => v === 0)).toBe(true)
  })
  it('global[5] = -komi/20 (Negro al turno), resto ceros', () => {
    const { global } = emptyBoardInputs(19, 7.5, 1)
    expect(global[5]).toBeCloseTo(-0.375, 6)
    global.forEach((v, i) => {
      if (i !== 5) expect(v).toBe(0)
    })
  })
  it('batch N replica la posición', () => {
    const one = emptyBoardInputs(19, 7.5, 1)
    const eight = emptyBoardInputs(19, 7.5, 8)
    expect(eight.bin.length).toBe(8 * one.bin.length)
    expect(eight.global.length).toBe(8 * 19)
    expect(Array.from(eight.bin.slice(7 * one.bin.length))).toEqual(Array.from(one.bin))
    expect(eight.global[7 * 19 + 5]).toBeCloseTo(-0.375, 6)
  })
})
