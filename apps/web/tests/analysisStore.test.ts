import type { Analysis } from '@tengen/engine'
import { describe, expect, it } from 'vitest'
import { AnalysisStore } from '../src/analysis/analysisStore'

function mkAnalysis(visits: number): Analysis {
  return { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits, moves: [] }
}

describe('AnalysisStore', () => {
  it('get en una clave ausente devuelve undefined; has devuelve false', () => {
    const store = new AnalysisStore()
    expect(store.get(0)).toBeUndefined()
    expect(store.has(0)).toBe(false)
  })

  it('set + get/has: guarda y recupera el Analysis exacto para ese nodeId', () => {
    const store = new AnalysisStore()
    const a = mkAnalysis(100)
    store.set(3, a)
    expect(store.get(3)).toBe(a)
    expect(store.has(3)).toBe(true)
  })

  it('claves independientes no colisionan', () => {
    const store = new AnalysisStore()
    const a0 = mkAnalysis(10)
    const a1 = mkAnalysis(20)
    store.set(0, a0)
    store.set(1, a1)
    expect(store.get(0)).toBe(a0)
    expect(store.get(1)).toBe(a1)
  })

  it('set sobre una clave existente reemplaza el valor previo', () => {
    const store = new AnalysisStore()
    store.set(5, mkAnalysis(1))
    const a2 = mkAnalysis(2)
    store.set(5, a2)
    expect(store.get(5)).toBe(a2)
  })

  it('clear vacía el store: get/has ya no ven nada de lo insertado antes', () => {
    const store = new AnalysisStore()
    store.set(0, mkAnalysis(1))
    store.set(1, mkAnalysis(2))
    store.clear()
    expect(store.has(0)).toBe(false)
    expect(store.has(1)).toBe(false)
    expect(store.get(0)).toBeUndefined()
  })
})
