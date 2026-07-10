import { describe, expect, it } from 'vitest'
import {
  colorToSign,
  engineToSabakiVertex,
  sabakiToEngineVertex,
  signToColor,
} from '../src/game/coords'

describe('engineToSabakiVertex / sabakiToEngineVertex', () => {
  it('round-trip motor→sabaki→motor conserva el vértice', () => {
    const v = { x: 7, y: 2 }
    expect(sabakiToEngineVertex(engineToSabakiVertex(v))).toEqual(v)
  })

  it('un vértice asimétrico {x:3,y:15} mapea a [3,15] (no [15,3])', () => {
    expect(engineToSabakiVertex({ x: 3, y: 15 })).toEqual([3, 15])
  })

  it('sabaki→motor de una tupla asimétrica [3,15] es {x:3,y:15}', () => {
    expect(sabakiToEngineVertex([3, 15])).toEqual({ x: 3, y: 15 })
  })
})

describe('colorToSign / signToColor', () => {
  it('black → 1, white → -1 (convención Sabaki)', () => {
    expect(colorToSign('black')).toBe(1)
    expect(colorToSign('white')).toBe(-1)
  })

  it('1 → black, -1 → white', () => {
    expect(signToColor(1)).toBe('black')
    expect(signToColor(-1)).toBe('white')
  })

  it('color→sign→color es biyectivo', () => {
    expect(signToColor(colorToSign('black'))).toBe('black')
    expect(signToColor(colorToSign('white'))).toBe('white')
  })
})
