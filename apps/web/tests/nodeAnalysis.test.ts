import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EVAL_THRESHOLDS,
  computeNodePointsLost,
  getEvaluationClass,
} from '../src/analysis/vendor/web-katrain/nodeAnalysis'
import type { CandidateMove, GameNode } from '../src/analysis/vendor/web-katrain/types'

function mkCandidate(x: number, y: number, pointsLost: number): CandidateMove {
  return { x, y, winRate: 0.5, scoreLead: 0, visits: 100, pointsLost, order: 0 }
}

describe('computeNodePointsLost', () => {
  it('nodo raíz (parent===null) → null', () => {
    const root: GameNode = { move: { x: 3, y: 3, player: 'black' }, parent: null }
    expect(computeNodePointsLost(root)).toBeNull()
  })

  it('move===null (incluso con parent) → null', () => {
    const parent: GameNode = { move: null, parent: null }
    const node: GameNode = { move: null, parent }
    expect(computeNodePointsLost(node)).toBeNull()
  })

  it('sin analysis en padre ni hijo y sin candidato en fallback → null', () => {
    const parent: GameNode = { move: null, parent: null }
    const node: GameNode = { move: { x: 3, y: 3, player: 'black' }, parent }
    expect(computeNodePointsLost(node)).toBeNull()
  })

  it('sin rootScoreLead válido en padre/hijo, pero con candidato coincidente en el fallback → usa candidate.pointsLost', () => {
    const parent: GameNode = {
      move: null,
      parent: null,
      analysis: { rootWinRate: 0.5, rootScoreLead: Number.NaN, moves: [mkCandidate(3, 3, 4.2), mkCandidate(4, 4, 1)] },
    }
    const node: GameNode = { move: { x: 3, y: 3, player: 'black' }, parent }
    expect(computeNodePointsLost(node)).toBe(4.2)
  })

  it('fallback sin candidato coincidente (x/y distintos) → null', () => {
    const parent: GameNode = {
      move: null,
      parent: null,
      analysis: { rootWinRate: 0.5, rootScoreLead: Number.NaN, moves: [mkCandidate(4, 4, 1)] },
    }
    const node: GameNode = { move: { x: 3, y: 3, player: 'black' }, parent }
    expect(computeNodePointsLost(node)).toBeNull()
  })

  it('Negro: scoreLead baja de padre a hijo → pointsLost positivo (perdió puntos)', () => {
    const parent: GameNode = { move: null, parent: null, analysis: { rootWinRate: 0.5, rootScoreLead: 5, moves: [] } }
    const node: GameNode = {
      move: { x: 3, y: 3, player: 'black' },
      parent,
      analysis: { rootWinRate: 0.5, rootScoreLead: 3, moves: [] },
    }
    expect(computeNodePointsLost(node)).toBe(2)
  })

  it('Negro: scoreLead sube de padre a hijo → pointsLost negativo (ganó puntos)', () => {
    const parent: GameNode = { move: null, parent: null, analysis: { rootWinRate: 0.5, rootScoreLead: 3, moves: [] } }
    const node: GameNode = {
      move: { x: 3, y: 3, player: 'black' },
      parent,
      analysis: { rootWinRate: 0.5, rootScoreLead: 5, moves: [] },
    }
    expect(computeNodePointsLost(node)).toBe(-2)
  })

  it('Blanco: signo invertido respecto a Negro para el mismo delta de scoreLead', () => {
    const parent: GameNode = {
      move: null,
      parent: null,
      analysis: { rootWinRate: 0.5, rootScoreLead: -5, moves: [] },
    }
    const node: GameNode = {
      move: { x: 3, y: 3, player: 'white' },
      parent,
      analysis: { rootWinRate: 0.5, rootScoreLead: -3, moves: [] },
    }
    // El scoreLead (perspectiva Negro) subió de -5 a -3: la ventaja de Blanco se redujo en 2 → Blanco perdió 2 puntos.
    expect(computeNodePointsLost(node)).toBe(2)
  })
})

describe('getEvaluationClass', () => {
  it('umbral por defecto: exactamente 12 → índice 0', () => {
    expect(getEvaluationClass(12)).toBe(0)
  })

  it('umbral por defecto: 6.01 (justo sobre 6) → índice 1', () => {
    expect(getEvaluationClass(6.01)).toBe(1)
  })

  it('umbral por defecto: exactamente 6 → índice 1 (borde, no estrictamente menor)', () => {
    expect(getEvaluationClass(6)).toBe(1)
  })

  it('umbral por defecto: exactamente 3 → índice 2', () => {
    expect(getEvaluationClass(3)).toBe(2)
  })

  it('umbral por defecto: exactamente 1.5 → índice 3', () => {
    expect(getEvaluationClass(1.5)).toBe(3)
  })

  it('umbral por defecto: exactamente 0.5 → índice 4', () => {
    expect(getEvaluationClass(0.5)).toBe(4)
  })

  it('umbral por defecto: exactamente 0 → índice 5', () => {
    expect(getEvaluationClass(0)).toBe(5)
  })

  it('umbral por defecto: -1 (por debajo de todos los umbrales) → índice 5 (clamp)', () => {
    expect(getEvaluationClass(-1)).toBe(5)
  })

  it('valor muy por encima de todos los umbrales → índice 0 (clamp)', () => {
    expect(getEvaluationClass(1000)).toBe(0)
  })

  it('pointsLost no finito (NaN) → tratado como 0 → índice 5', () => {
    expect(getEvaluationClass(Number.NaN)).toBe(5)
  })

  it('respeta DEFAULT_EVAL_THRESHOLDS exportado', () => {
    expect(DEFAULT_EVAL_THRESHOLDS).toEqual([12, 6, 3, 1.5, 0.5, 0])
  })
})
