import { describe, expect, it } from 'vitest'
import type { Move } from '@tengen/engine/types'
import { chainAt, ownershipMap, scoreGame } from '../src/scoring'

// Partida real de producción (sala guafwC_XKSW9pC3vhod6Sw), sin muertas.
const REAL = 'gc cg gg cc de ef fe dd ee ce ec df eh ff gf dh db cb da ca ed dc eb fg fh ei fi ci di eg gh ei - di - -'
function sgfMoves(s: string): Move[] {
  return s.split(' ').map((c, i) => ({
    color: i % 2 === 0 ? 'black' : 'white',
    vertex: c === '-' ? 'pass' : { x: c.charCodeAt(0) - 97, y: c.charCodeAt(1) - 97 },
  }))
}

// Muro negro en x=4, muro blanco en x=5, piedra blanca muerta en (1,1) dentro del lado negro.
function wallGame(): Move[] {
  const moves: Move[] = [
    { color: 'black', vertex: { x: 4, y: 0 } },
    { color: 'white', vertex: { x: 1, y: 1 } },
  ]
  for (let y = 1; y < 9; y++) {
    moves.push({ color: 'black', vertex: { x: 4, y } })
    moves.push({ color: 'white', vertex: { x: 5, y: y - 1 } })
  }
  moves.push({ color: 'black', vertex: 'pass' }, { color: 'white', vertex: { x: 5, y: 8 } })
  return moves
}
const base = { boardSize: 9 as const, handicap: 0 }

describe('scoreGame', () => {
  it('partida real, chinas: 43 vs 38 + 6,5 → W+1.5', () => {
    const s = scoreGame({ boardSize: 9, handicap: 0, moves: sgfMoves(REAL), dead: [], rules: 'chinese', komi: 6.5 })
    expect(s.black).toEqual({ stones: 15, territory: 28, prisoners: 0, komi: 0, total: 43 })
    expect(s.white).toEqual({ stones: 16, territory: 22, prisoners: 0, komi: 6.5, total: 44.5 })
    expect(s.result).toBe('W+1.5')
  })
  it('partida real, japonesas: 28+1 vs 22+1+6,5 → W+0.5', () => {
    const s = scoreGame({ boardSize: 9, handicap: 0, moves: sgfMoves(REAL), dead: [], rules: 'japanese', komi: 6.5 })
    expect(s.black.total).toBe(29)
    expect(s.white.total).toBe(29.5)
    expect(s.result).toBe('W+0.5')
  })
  it('con muerta, chinas: la muerta pasa a territorio', () => {
    const s = scoreGame({ ...base, moves: wallGame(), dead: [{ x: 1, y: 1 }], rules: 'chinese', komi: 0 })
    expect(s.black.total).toBe(45)
    expect(s.white.total).toBe(36)
  })
  it('con muerta, japonesas: territorio + prisionero', () => {
    const s = scoreGame({ ...base, moves: wallGame(), dead: [{ x: 1, y: 1 }], rules: 'japanese', komi: 0 })
    expect(s.black.total).toBe(37)
    expect(s.white.total).toBe(27)
  })
  it('sin marcar la muerta: la región es dame', () => {
    const s = scoreGame({ ...base, moves: wallGame(), dead: [], rules: 'chinese', komi: 0 })
    expect(s.black.stones).toBe(9)
    expect(s.black.territory).toBe(0)
  })
})

describe('chainAt / ownershipMap', () => {
  it('chainAt: piedra sola y punto vacío', () => {
    expect(chainAt(9, 0, wallGame(), { x: 1, y: 1 })).toEqual([{ x: 1, y: 1 }])
    expect(chainAt(9, 0, wallGame(), { x: 0, y: 0 })).toEqual([])
  })
  it('ownershipMap con la muerta marcada', () => {
    const m = ownershipMap({ ...base, moves: wallGame(), dead: [{ x: 1, y: 1 }] })
    expect(m[1]?.[1]).toBe(1)
    expect(m[0]?.[8]).toBe(-1)
  })
})
