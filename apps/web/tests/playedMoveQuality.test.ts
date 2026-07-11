import { describe, expect, it } from 'vitest'
import {
  formatBoardMoveLabel,
  getNextMoveQuality,
  getPlayedMoveQuality,
  type GameNodeWithChildren,
} from '../src/analysis/vendor/web-katrain/playedMoveQuality'
import type { CandidateMove, GameNode } from '../src/analysis/vendor/web-katrain/types'

function mkCandidate(x: number, y: number, overrides: Partial<CandidateMove> = {}): CandidateMove {
  return { x, y, winRate: 0.5, scoreLead: 0, visits: 100, pointsLost: 0, order: 0, ...overrides }
}

describe('getPlayedMoveQuality', () => {
  it('nodo raíz (parent===null) → null', () => {
    const root: GameNode = { move: { x: 3, y: 3, player: 'black' }, parent: null }
    expect(getPlayedMoveQuality(root, 19)).toBeNull()
  })

  it('move===null (incluso con parent) → null', () => {
    const parent: GameNode = { move: null, parent: null }
    const node: GameNode = { move: null, parent }
    expect(getPlayedMoveQuality(node, 19)).toBeNull()
  })

  it('jugada coincide con la mejor candidata (order=0) → rank=1, valueLabel refleja "Best"', () => {
    const parent: GameNode = {
      move: null,
      parent: null,
      analysis: { rootWinRate: 0.5, rootScoreLead: 5, moves: [mkCandidate(3, 3, { order: 0, prior: 0.9 })] },
    }
    const node: GameNode = {
      move: { x: 3, y: 3, player: 'black' },
      parent,
      // Mismo rootScoreLead que el padre → pointsLost=0 → summarizePointsLost da 'Best' directamente.
      analysis: { rootWinRate: 0.5, rootScoreLead: 5, moves: [] },
    }
    const result = getPlayedMoveQuality(node, 19)
    expect(result).not.toBeNull()
    expect(result!.rank).toBe(1)
    expect(result!.valueLabel).toBe('Best')
    expect(result!.tone).toBe('success')
    expect(result!.playerLabel).toBe('B')
  })

  it('sin candidato correspondiente en parent.analysis.moves, pero con pointsLostOverride numérico → usa el override sin reventar', () => {
    const parent: GameNode = {
      move: null,
      parent: null,
      analysis: { rootWinRate: 0.5, rootScoreLead: 5, moves: [mkCandidate(1, 1, { order: 0 })] },
    }
    const node: GameNode = {
      move: { x: 5, y: 5, player: 'white' }, // no coincide con ningún candidato de parent.analysis.moves
      parent,
      analysis: undefined,
    }
    const result = getPlayedMoveQuality(node, 19, 3.7)
    expect(result).not.toBeNull()
    expect(result!.rank).toBeNull()
    expect(result!.rankLabel).toBe('Unranked')
    expect(result!.valueLabel).toBe('Lost 3.7')
    expect(result!.playerLabel).toBe('W')
  })

  it('sin candidato Y sin pointsLostOverride Y sin score computable → null', () => {
    const parent: GameNode = { move: null, parent: null, analysis: undefined }
    const node: GameNode = { move: { x: 5, y: 5, player: 'white' }, parent, analysis: undefined }
    expect(getPlayedMoveQuality(node, 19)).toBeNull()
  })
})

describe('formatBoardMoveLabel', () => {
  it('pase (x<0 || y<0) → "Pass"', () => {
    expect(formatBoardMoveLabel({ x: -1, y: -1 })).toBe('Pass')
    expect(formatBoardMoveLabel({ x: -1, y: 3 })).toBe('Pass')
    expect(formatBoardMoveLabel({ x: 3, y: -1 })).toBe('Pass')
  })

  it('columna 7 (justo antes del salto) → "H", sin ajuste', () => {
    expect(formatBoardMoveLabel({ x: 7, y: 0 }, 19)).toBe('H19')
  })

  it('columna 8 salta la letra I → "J" (ajuste x>=8 → x+1 del código fuente)', () => {
    expect(formatBoardMoveLabel({ x: 8, y: 0 }, 19)).toBe('J19')
  })

  it('boardSize por defecto = 19', () => {
    expect(formatBoardMoveLabel({ x: 0, y: 0 })).toBe('A19')
  })
})

describe('getNextMoveQuality (adaptado: children[0] en vez de getActiveChild/branchNavigation.ts)', () => {
  it('nodo sin hijos → null', () => {
    const node: GameNodeWithChildren = { move: { x: 0, y: 0, player: 'black' }, parent: null, children: [] }
    expect(getNextMoveQuality(node, 19)).toBeNull()
  })

  it('nodo con 2+ hijos → SIEMPRE usa children[0]; el segundo hijo nunca se usa (sin lógica de rama)', () => {
    const node: GameNodeWithChildren = {
      move: { x: 0, y: 0, player: 'black' },
      parent: null,
      // getNextMoveQuality delega en getPlayedMoveQuality(firstChild, ...), que lee
      // firstChild.parent.analysis (= node.analysis) para computar pointsLost — debe estar presente.
      analysis: { rootWinRate: 0.5, rootScoreLead: 0, moves: [] },
      children: [],
    }
    const firstChild: GameNodeWithChildren = {
      move: { x: 1, y: 1, player: 'white' },
      parent: node,
      analysis: { rootWinRate: 0.5, rootScoreLead: 0, moves: [] },
      children: [],
    }
    const secondChild: GameNodeWithChildren = {
      move: { x: 9, y: 9, player: 'white' }, // jugada DISTINTA — si apareciera en el resultado sería un bug
      parent: node,
      analysis: { rootWinRate: 0.9, rootScoreLead: 99, moves: [] },
      children: [],
    }
    node.children = [firstChild, secondChild]

    const result = getNextMoveQuality(node, 19)
    expect(result).not.toBeNull()
    expect(result!.moveLabel).toBe(formatBoardMoveLabel({ x: 1, y: 1 }, 19))
    expect(result!.moveLabel).not.toBe(formatBoardMoveLabel({ x: 9, y: 9 }, 19))
  })
})
