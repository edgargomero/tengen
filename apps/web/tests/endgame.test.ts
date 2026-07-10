import type { Move } from '@tengen/engine'
import { describe, expect, it } from 'vitest'
import { formatResult, isGameOverByTwoPasses } from '../src/game/endgame'

describe('formatResult — sin resign (scoreLead persp. Negro)', () => {
  it('scoreLead positivo → B+X.X', () => {
    expect(formatResult(7.5)).toBe('B+7.5')
  })

  it('scoreLead negativo → W+X.X (con el signo invertido)', () => {
    expect(formatResult(-3.5)).toBe('W+3.5')
  })

  it('scoreLead 0 exacto → Draw', () => {
    expect(formatResult(0)).toBe('Draw')
  })

  it('redondea a 1 decimal', () => {
    expect(formatResult(4.26)).toBe('B+4.3')
    expect(formatResult(-4.24)).toBe('W+4.2')
  })
})

describe('formatResult — con resign (resign = quien SE RINDE)', () => {
  it('Negro se rinde → gana Blanco (W+R)', () => {
    expect(formatResult(0, 'black')).toBe('W+R')
  })

  it('Blanco se rinde → gana Negro (B+R)', () => {
    expect(formatResult(0, 'white')).toBe('B+R')
  })

  it('resign ignora el scoreLead (aunque sea distinto de 0)', () => {
    expect(formatResult(99, 'black')).toBe('W+R')
    expect(formatResult(-99, 'white')).toBe('B+R')
  })
})

describe('isGameOverByTwoPasses', () => {
  function pass(color: 'black' | 'white'): Move {
    return { color, vertex: 'pass' }
  }
  function stone(color: 'black' | 'white'): Move {
    return { color, vertex: { x: 0, y: 0 } }
  }

  it('sin jugadas → false', () => {
    expect(isGameOverByTwoPasses([])).toBe(false)
  })

  it('una sola jugada (pase) → false', () => {
    expect(isGameOverByTwoPasses([pass('black')])).toBe(false)
  })

  it('dos pases consecutivos al final → true', () => {
    expect(isGameOverByTwoPasses([stone('black'), pass('white'), pass('black')])).toBe(true)
  })

  it('un pase no-final (seguido de una jugada real) → false', () => {
    expect(isGameOverByTwoPasses([pass('black'), stone('white'), pass('black')])).toBe(false)
  })

  it('la última jugada es pase pero la penúltima no → false', () => {
    expect(isGameOverByTwoPasses([stone('black'), stone('white'), pass('black')])).toBe(false)
  })
})
