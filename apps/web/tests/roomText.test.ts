import { describe, expect, it } from 'vitest'
import type { Move } from '@tengen/engine/types'
import { scoreGame } from '@tengen/go-rules'
import { rejectMessage, resultText, scoreLines } from '../src/online/roomText'

// Partida real de producción (sala guafwC_XKSW9pC3vhod6Sw), sin muertas.
const REAL = 'gc cg gg cc de ef fe dd ee ce ec df eh ff gf dh db cb da ca ed dc eb fg fh ei fi ci di eg gh ei - di - -'
const moves: Move[] = REAL.split(' ').map((c, i) => ({
  color: i % 2 === 0 ? 'black' : 'white',
  vertex: c === '-' ? 'pass' : { x: c.charCodeAt(0) - 97, y: c.charCodeAt(1) - 97 },
}))
const score = (rules: 'chinese' | 'japanese') =>
  scoreGame({ boardSize: 9, handicap: 0, moves, dead: [], rules, komi: 6.5 })

describe('textos de la sala', () => {
  it('resultText de abandono', () => {
    expect(resultText('B+F')).toBe('Negro gana por abandono')
    expect(resultText('W+F')).toBe('Blanco gana por abandono')
  })
  it('rejectMessage de conteo', () => {
    expect(rejectMessage('scoring')).toBe('Estamos contando: marcá las muertas, aceptá o seguí jugando')
    expect(rejectMessage('not-scoring')).toBe('Eso solo se puede durante el conteo')
  })
  it('scoreLines japonesas', () => {
    expect(scoreLines(score('japanese'))).toEqual({
      black: 'Negro: 28 territorio + 1 prisionero = 29',
      white: 'Blanco: 22 territorio + 1 prisionero + 6,5 komi = 29,5',
    })
  })
  it('scoreLines chinas', () => {
    expect(scoreLines(score('chinese'))).toEqual({
      black: 'Negro: 15 piedras + 28 territorio = 43',
      white: 'Blanco: 16 piedras + 22 territorio + 6,5 komi = 44,5',
    })
  })
  it('pluraliza prisioneros y omite komi 0', () => {
    const s = score('japanese')
    const out = scoreLines({ ...s, black: { ...s.black, prisoners: 2, komi: 0, total: 30 } })
    expect(out.black).toBe('Negro: 28 territorio + 2 prisioneros = 30')
  })
})
