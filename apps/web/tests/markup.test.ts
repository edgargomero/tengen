import { describe, expect, it } from 'vitest'
import type { Markup } from '../src/game/gameTree'
import { applyMarkToggle, nextLabelLetter } from '../src/game/markup'

const M = (type: Markup['type'], x: number, y: number, label?: string): Markup =>
  label !== undefined ? { type, vertex: { x, y }, label } : { type, vertex: { x, y } }

describe('applyMarkToggle — colocar/quitar/reemplazar (≤1 marca por vértice)', () => {
  it('agrega una marca nueva en una casilla vacía', () => {
    const next = applyMarkToggle([], { x: 2, y: 3 }, 'triangle')
    expect(next).toEqual([{ type: 'triangle', vertex: { x: 2, y: 3 } }])
  })

  it('toggle-off: la MISMA herramienta sobre la misma casilla quita la marca', () => {
    const start = [M('triangle', 2, 3)]
    const next = applyMarkToggle(start, { x: 2, y: 3 }, 'triangle')
    expect(next).toEqual([])
  })

  it('reemplaza: OTRA herramienta sobre la misma casilla cambia el tipo (nunca dos en un vértice)', () => {
    const start = [M('triangle', 2, 3)]
    const next = applyMarkToggle(start, { x: 2, y: 3 }, 'square')
    expect(next).toEqual([{ type: 'square', vertex: { x: 2, y: 3 } }])
  })

  it('marcas en casillas distintas conviven', () => {
    let m: Markup[] = []
    m = applyMarkToggle(m, { x: 0, y: 0 }, 'circle')
    m = applyMarkToggle(m, { x: 8, y: 8 }, 'cross')
    expect(m).toHaveLength(2)
    expect(m).toEqual(
      expect.arrayContaining([
        { type: 'circle', vertex: { x: 0, y: 0 } },
        { type: 'cross', vertex: { x: 8, y: 8 } },
      ]),
    )
  })

  it('NO muta el array de entrada (función pura)', () => {
    const start = [M('triangle', 1, 1)]
    const copy = [...start]
    applyMarkToggle(start, { x: 2, y: 2 }, 'square')
    expect(start).toEqual(copy)
  })
})

describe('applyMarkToggle — etiquetas auto-incrementales', () => {
  it('la primera etiqueta es A', () => {
    const next = applyMarkToggle([], { x: 4, y: 4 }, 'label')
    expect(next).toEqual([{ type: 'label', vertex: { x: 4, y: 4 }, label: 'A' }])
  })

  it('la segunda etiqueta en otra casilla es B', () => {
    let m = applyMarkToggle([], { x: 4, y: 4 }, 'label')
    m = applyMarkToggle(m, { x: 5, y: 5 }, 'label')
    expect(m.find((x) => x.vertex.x === 5)!.label).toBe('B')
  })

  it('tras quitar A, la próxima etiqueta REUSA A (toma el hueco libre)', () => {
    let m = applyMarkToggle([], { x: 4, y: 4 }, 'label') // A
    m = applyMarkToggle(m, { x: 5, y: 5 }, 'label') // B
    m = applyMarkToggle(m, { x: 4, y: 4 }, 'label') // toggle-off A
    m = applyMarkToggle(m, { x: 6, y: 6 }, 'label') // debería reusar A (libre)
    expect(m.find((x) => x.vertex.x === 6)!.label).toBe('A')
  })

  it('reemplazar un triángulo por etiqueta toma la próxima letra libre del nodo', () => {
    let m: Markup[] = [M('label', 0, 0, 'A'), M('triangle', 5, 5)]
    m = applyMarkToggle(m, { x: 5, y: 5 }, 'label') // reemplaza el triángulo por una etiqueta
    expect(m.find((x) => x.vertex.x === 5)!).toEqual({ type: 'label', vertex: { x: 5, y: 5 }, label: 'B' })
  })
})

describe('nextLabelLetter', () => {
  it('sin etiquetas → A', () => {
    expect(nextLabelLetter([], -1)).toBe('A')
  })

  it('con A y B usadas → C', () => {
    expect(nextLabelLetter([M('label', 0, 0, 'A'), M('label', 1, 1, 'B')], -1)).toBe('C')
  })

  it('excluye la etiqueta del índice que se está reemplazando', () => {
    // Reemplazando el índice 0 (que tiene 'A'): 'A' vuelve a estar libre.
    expect(nextLabelLetter([M('label', 0, 0, 'A'), M('label', 1, 1, 'B')], 0)).toBe('A')
  })

  it('las 26 letras usadas → fallback a A (irreal en una posición real)', () => {
    const all = Array.from({ length: 26 }, (_, i) => M('label', i, 0, String.fromCharCode(65 + i)))
    expect(nextLabelLetter(all, -1)).toBe('A')
  })
})
