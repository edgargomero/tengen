import { describe, expect, it } from 'vitest'
import type { Analysis, MoveAnalysis } from '@tengen/engine'
import { decodeAnalysisFromNodeData, encodeAnalysisForNode } from '../src/analysis/sgfAnalysisCodec'

function mkMove(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return { vertex: { x: 4, y: 4 }, visits: 50, winrate: 0.5, scoreLead: 0, prior: 0.2, pv: [], ...overrides }
}

function mkAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return { winrate: 0.55, scoreLead: 2.5, scoreStdev: 3, visits: 100, moves: [], ...overrides }
}

describe('encodeAnalysisForNode / decodeAnalysisFromNodeData — round-trip', () => {
  it('un análisis con una candidata (con pv) round-tripea winrate/scoreLead/visits y la secuencia', () => {
    const top = mkMove({
      vertex: { x: 4, y: 4 },
      pv: [
        { x: 2, y: 2 },
        { x: 6, y: 6 },
      ],
    })
    const analysis = mkAnalysis({ winrate: 0.6212, scoreLead: 3.45, visits: 100, moves: [top] })

    const data = encodeAnalysisForNode(analysis)
    const decoded = decodeAnalysisFromNodeData(data)

    expect(decoded).not.toBeNull()
    expect(decoded!.winrate).toBeCloseTo(0.6212, 4)
    expect(decoded!.scoreLead).toBeCloseTo(3.45, 2)
    expect(decoded!.visits).toBe(100)
    expect(decoded!.moves).toHaveLength(1)
    expect(decoded!.moves[0]!.vertex).toEqual({ x: 4, y: 4 })
    expect(decoded!.moves[0]!.pv).toEqual([
      { x: 2, y: 2 },
      { x: 6, y: 6 },
    ])
  })

  it('"candidata con más visitas" se elige por reduce, no por orden del array', () => {
    const low = mkMove({ vertex: { x: 0, y: 0 }, visits: 10 })
    const high = mkMove({ vertex: { x: 8, y: 8 }, visits: 90 })
    const analysis = mkAnalysis({ moves: [low, high] }) // la de MÁS visitas va SEGUNDA en el array

    const decoded = decodeAnalysisFromNodeData(encodeAnalysisForNode(analysis))
    expect(decoded!.moves[0]!.vertex).toEqual({ x: 8, y: 8 }) // ganó la de 90 visitas, no la primera del array
  })

  it('sin candidatas (moves: []) → sin TGP, decode da moves: []', () => {
    const analysis = mkAnalysis({ moves: [] })
    const data = encodeAnalysisForNode(analysis)
    expect(data.TGP).toBeUndefined()
    const decoded = decodeAnalysisFromNodeData(data)
    expect(decoded!.moves).toEqual([])
  })

  it('candidata top con vertex="pass" → sin TGP (un pase no tiene casilla)', () => {
    const analysis = mkAnalysis({ moves: [mkMove({ vertex: 'pass', visits: 100 })] })
    const data = encodeAnalysisForNode(analysis)
    expect(data.TGP).toBeUndefined()
  })

  it('pv con un pase en medio se trunca en el primer pase (mismo criterio que buildPvSequence al dibujar)', () => {
    const top = mkMove({ vertex: { x: 4, y: 4 }, pv: [{ x: 2, y: 2 }, 'pass', { x: 6, y: 6 }] })
    const analysis = mkAnalysis({ moves: [top] })
    const decoded = decodeAnalysisFromNodeData(encodeAnalysisForNode(analysis))
    expect(decoded!.moves[0]!.pv).toEqual([{ x: 2, y: 2 }]) // corta ANTES del pase, nada después
  })

  it('un solo vértice (candidata sin continuación) es un TGP válido de 2 caracteres', () => {
    const analysis = mkAnalysis({ moves: [mkMove({ vertex: { x: 4, y: 4 }, pv: [] })] })
    const data = encodeAnalysisForNode(analysis)
    expect(data.TGP![0]).toHaveLength(2)
    const decoded = decodeAnalysisFromNodeData(data)
    expect(decoded!.moves[0]!.vertex).toEqual({ x: 4, y: 4 })
    expect(decoded!.moves[0]!.pv).toEqual([])
  })
})

describe('decodeAnalysisFromNodeData — datos corruptos o incompletos → null (nunca lanza)', () => {
  it('sin ninguna propiedad TG* → null', () => {
    expect(decodeAnalysisFromNodeData({})).toBeNull()
  })

  it('TGW presente pero TGS ausente → null', () => {
    expect(decodeAnalysisFromNodeData({ TGW: ['0.5'] })).toBeNull()
  })

  it('TGW con valor no numérico → null', () => {
    expect(decodeAnalysisFromNodeData({ TGW: ['no-es-numero'], TGS: ['1'], TGN: ['10'] })).toBeNull()
  })

  it('TGP con longitud impar (corrupto) → se ignora, pero winrate/scoreLead/visits SÍ se conservan', () => {
    const decoded = decodeAnalysisFromNodeData({ TGW: ['0.5'], TGS: ['1.0'], TGN: ['10'], TGP: ['abc'] })
    expect(decoded).not.toBeNull()
    expect(decoded!.moves).toEqual([])
  })
})
