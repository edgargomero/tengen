import type { Move } from '@tengen/engine'
import sgf from '@sabaki/sgf'
import { describe, expect, it } from 'vitest'
import { GameTree } from '../src/game/gameTree'
import { exportSgf, importSgf, sgfToVertex, vertexToSgf } from '../src/game/sgf'

const B = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const W = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })

describe('coordenadas SGF (0-based, columna=x primero)', () => {
  it('esquina y punto asimétrico', () => {
    expect(vertexToSgf({ x: 0, y: 0 })).toBe('aa')
    expect(vertexToSgf({ x: 2, y: 3 })).toBe('cd') // x=2→c, y=3→d
    expect(vertexToSgf({ x: 18, y: 18 })).toBe('ss')
  })

  it('sgfToVertex es el inverso', () => {
    expect(sgfToVertex('aa')).toEqual({ x: 0, y: 0 })
    expect(sgfToVertex('cd')).toEqual({ x: 2, y: 3 })
    expect(sgfToVertex('ss')).toEqual({ x: 18, y: 18 })
  })
})

describe('exportSgf — propiedades de la raíz', () => {
  it('escribe GM/FF/SZ/KM/RU y arranca en (;...)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    const out = exportSgf(t)
    expect(out.startsWith('(')).toBe(true)
    expect(out).toContain('GM[1]')
    expect(out).toContain('FF[4]')
    expect(out).toContain('SZ[9]')
    expect(out).toContain('KM[6.5]')
    expect(out).toContain('RU[Chinese]')
  })

  it('un pase se serializa como B[] / W[] (valor vacío, NO tt)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(2, 2))
    t.addMove({ color: 'white', vertex: 'pass' })
    const out = exportSgf(t)
    expect(out).toContain('W[]')
    expect(out).not.toContain('W[tt]')
  })

  it('handicap≥2 emite HA[n]+AB[..] y la primera jugada es de Blanco (AB no es move)', () => {
    const t = new GameTree({ boardSize: 19, komi: 0.5, rules: 'chinese', handicap: 2 })
    t.addMove(W(15, 15))
    const out = exportSgf(t)
    expect(out).toContain('HA[2]')
    expect(out).toContain('AB[') // piedras de handicap presentes como AB
    // la primera jugada del árbol es Blanca
    expect(out).toContain('W[pp]') // (15,15) → 'pp'
    // el nodo raíz no lleva ninguna jugada B[..]; la raíz solo tiene game-info + AB
    const root = sgf.parse(out)[0]!
    expect('B' in root.data).toBe(false)
    expect('W' in root.data).toBe(false)
    expect('AB' in root.data).toBe(true)
    expect('HA' in root.data).toBe(true)
  })
})

// Propiedad robusta del plan: export∘import∘export es byte-idéntico a export.
function assertIdempotent(t: GameTree): string {
  const once = exportSgf(t)
  const twice = exportSgf(importSgf(once))
  expect(twice).toBe(once)
  return once
}

describe('importSgf — reconstrucción de metadata y jugadas', () => {
  it('mapea SZ/KM/RU y las jugadas del camino', () => {
    const t = new GameTree({ boardSize: 13, komi: 7.5, rules: 'japanese', handicap: 0 })
    t.addMove(B(3, 3))
    t.addMove(W(9, 9))
    const t2 = importSgf(exportSgf(t))
    expect(t2.meta).toEqual({ boardSize: 13, komi: 7.5, rules: 'japanese', handicap: 0 })
    expect(t2.mainLine().map((n) => n.move)).toEqual([B(3, 3), W(9, 9)])
  })

  it('handicap: HA→meta.handicap; los AB NO se convierten en moves', () => {
    const t = new GameTree({ boardSize: 19, komi: 0.5, rules: 'chinese', handicap: 2 })
    t.addMove(W(15, 15))
    t.addMove(B(3, 3))
    const t2 = importSgf(exportSgf(t))
    expect(t2.meta.handicap).toBe(2)
    const moves = t2.mainLine().map((n) => n.move)
    expect(moves).toEqual([W(15, 15), B(3, 3)])
    expect(moves[0]?.color).toBe('white') // arranca en Blanco
  })
})

describe('round-trip idempotente (export∘import∘export byte-idéntico)', () => {
  it('partida simple 9×9', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(2, 2))
    t.addMove(W(6, 6))
    t.addMove(B(4, 4))
    assertIdempotent(t)
  })

  it('con un pase', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(2, 2))
    t.addMove({ color: 'white', vertex: 'pass' })
    t.addMove(B(4, 4))
    assertIdempotent(t)
  })

  it('con una variación (retroceder y jugar distinto → dos hijos)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(2, 2))
    t.addMove(W(6, 6))
    t.toRoot()
    t.addMove(B(4, 4)) // variación en la primera jugada
    t.addMove(W(5, 5))
    assertIdempotent(t)
  })

  it('con handicap 2 en 19×19', () => {
    const t = new GameTree({ boardSize: 19, komi: 0.5, rules: 'japanese', handicap: 2 })
    t.addMove(W(15, 15))
    t.addMove(B(3, 3))
    t.addMove(W(9, 9))
    assertIdempotent(t)
  })

  it('con resultado (RE)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0, result: 'B+Resign' })
    t.addMove(B(2, 2))
    const out = assertIdempotent(t)
    expect(out).toContain('RE[B+Resign]')
    expect(importSgf(out).meta.result).toBe('B+Resign')
  })

  it('partida vacía (estado de arranque de la app)', () => {
    const t = new GameTree({ boardSize: 19, komi: 6.5, rules: 'chinese', handicap: 0 })
    assertIdempotent(t)
  })
})
