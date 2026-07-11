import type { Analysis, Move, MoveAnalysis, Vertex } from '@tengen/engine'
import { describe, expect, it } from 'vitest'
import { GameTree } from '../src/game/gameTree'
import { AnalysisStore } from '../src/analysis/analysisStore'
import { adaptGameNode, adaptMainLine } from '../src/analysis/katrainAdapter'
import { computeGameReport } from '../src/analysis/vendor/web-katrain/gameReport'
import { DEFAULT_EVAL_THRESHOLDS } from '../src/analysis/vendor/web-katrain/nodeAnalysis'
import { getPlayedMoveQuality, formatBoardMoveLabel } from '../src/analysis/vendor/web-katrain/playedMoveQuality'
import type { CandidateMove } from '../src/analysis/vendor/web-katrain/types'

// ── Helpers de fixture (tengen) ───────────────────────────────────────────────────────────────

function tree9(): GameTree {
  return new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
}

const B = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const W = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })
const BPASS: Move = { color: 'black', vertex: 'pass' }
const WPASS: Move = { color: 'white', vertex: 'pass' }

function mkMoveAnalysis(vertex: Vertex, overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    vertex,
    visits: 10,
    winrate: 0.5,
    scoreLead: 0,
    prior: 0.1,
    pv: [],
    ...overrides,
  }
}

function mkAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    winrate: 0.5,
    scoreLead: 0,
    scoreStdev: 1,
    visits: 100,
    moves: [],
    ...overrides,
  }
}

// Encuentra una candidata adaptada por coordenadas (identidad por x,y, no por posición en el array).
function findCandidate(moves: CandidateMove[], x: number, y: number): CandidateMove | undefined {
  return moves.find((m) => m.x === x && m.y === y)
}

// ── Convención de pase ───────────────────────────────────────────────────────────────────────

describe('katrainAdapter — convención de pase (-1,-1)', () => {
  it('una jugada de pase adaptada da {x:-1,y:-1,player}', () => {
    const t = tree9()
    const store = new AnalysisStore()
    const n1 = t.addMove(BPASS)
    const adapted = adaptGameNode(n1, t, store)
    expect(adapted.move).toEqual({ x: -1, y: -1, player: 'black' })
  })

  it('una candidata de pase en Analysis.moves adaptada da x:-1,y:-1 en el CandidateMove', () => {
    const t = tree9()
    const store = new AnalysisStore()
    store.set(
      t.root.id,
      mkAnalysis({
        moves: [mkMoveAnalysis('pass', { visits: 5 }), mkMoveAnalysis({ x: 2, y: 2 }, { visits: 3 })],
      })
    )
    const adapted = adaptGameNode(t.root, t, store)
    const passCandidate = findCandidate(adapted.analysis!.moves, -1, -1)
    expect(passCandidate).toBeDefined()
  })

  it('integración: una jugada de pase real ENCUENTRA su candidata de pase correspondiente vía getPlayedMoveQuality (no null, rank correcto)', () => {
    const t = tree9()
    const store = new AnalysisStore()
    const b1 = t.addMove(B(2, 2))
    // El padre (b1) tiene una candidata de pase muy visitada (será la #1 tras ordenar por visits)
    // y otra candidata normal menos visitada.
    store.set(
      b1.id,
      mkAnalysis({
        scoreLead: 0,
        moves: [
          mkMoveAnalysis('pass', { visits: 80, scoreLead: -1, winrate: 0.4, prior: 0.3 }),
          mkMoveAnalysis({ x: 5, y: 5 }, { visits: 20, scoreLead: 2, winrate: 0.6, prior: 0.5 }),
        ],
      })
    )
    const w1 = t.addMove(WPASS) // el pase REAL jugado por Blanco
    const adapted = adaptGameNode(w1, t, store)

    expect(adapted.move).toEqual({ x: -1, y: -1, player: 'white' })

    const quality = getPlayedMoveQuality(adapted, t.meta.boardSize)
    expect(quality).not.toBeNull()
    // La candidata de pase es la más visitada (80 > 20) → order=0 → rank=1.
    expect(quality!.rank).toBe(1)
    expect(quality!.moveLabel).toBe('Pass')
  })
})

// ── `order` ordena de verdad ────────────────────────────────────────────────────────────────

describe('katrainAdapter — order = índice tras ordenar por visits DESCENDENTE', () => {
  it('candidatas alimentadas SIN orden (visits [10,50,5]) → order resultante [1,0,2] por identidad x,y', () => {
    const t = tree9()
    const store = new AnalysisStore()
    store.set(
      t.root.id,
      mkAnalysis({
        moves: [
          mkMoveAnalysis({ x: 0, y: 0 }, { visits: 10 }),
          mkMoveAnalysis({ x: 1, y: 1 }, { visits: 50 }),
          mkMoveAnalysis({ x: 2, y: 2 }, { visits: 5 }),
        ],
      })
    )
    const adapted = adaptGameNode(t.root, t, store)
    const moves = adapted.analysis!.moves
    expect(findCandidate(moves, 0, 0)?.order).toBe(1)
    expect(findCandidate(moves, 1, 1)?.order).toBe(0)
    expect(findCandidate(moves, 2, 2)?.order).toBe(2)
  })

  it('no muta el array original de Analysis.moves cacheado en el store', () => {
    const t = tree9()
    const store = new AnalysisStore()
    const original = [
      mkMoveAnalysis({ x: 0, y: 0 }, { visits: 10 }),
      mkMoveAnalysis({ x: 1, y: 1 }, { visits: 50 }),
    ]
    store.set(t.root.id, mkAnalysis({ moves: original }))
    adaptGameNode(t.root, t, store)
    // El array original sigue en su orden de inserción — no fue reordenado en sitio.
    expect(original[0]!.vertex).toEqual({ x: 0, y: 0 })
    expect(original[1]!.vertex).toEqual({ x: 1, y: 1 })
  })
})

// ── Signo de pointsLost para Negro y Blanco ─────────────────────────────────────────────────

describe('katrainAdapter — signo de pointsLost (usa tree.currentTurnAt, NO node.move.player)', () => {
  it('nodo donde le toca jugar a NEGRO (raíz, handicap 0): candidata peor que el root → pointsLost > 0', () => {
    const t = tree9()
    const store = new AnalysisStore()
    expect(t.currentTurnAt(t.root)).toBe('black')
    store.set(
      t.root.id,
      mkAnalysis({
        scoreLead: 5, // root a favor de Negro por 5
        moves: [mkMoveAnalysis({ x: 3, y: 3 }, { scoreLead: 3, visits: 10 })], // peor para Negro (menos lead)
      })
    )
    const adapted = adaptGameNode(t.root, t, store)
    const candidate = findCandidate(adapted.analysis!.moves, 3, 3)!
    expect(candidate.pointsLost).toBeGreaterThan(0)
    expect(candidate.pointsLost).toBeCloseTo(2, 10)
  })

  it('nodo donde le toca jugar a BLANCO (tras la 1ª jugada de Negro): mismo escenario relativo → pointsLost > 0 también', () => {
    const t = tree9()
    const store = new AnalysisStore()
    const n1 = t.addMove(B(2, 2))
    expect(t.currentTurnAt(n1)).toBe('white')
    store.set(
      n1.id,
      mkAnalysis({
        scoreLead: -5, // root a favor de Blanco por 5
        moves: [mkMoveAnalysis({ x: 3, y: 3 }, { scoreLead: -3, visits: 10 })], // peor para Blanco (menos ventaja blanca)
      })
    )
    const adapted = adaptGameNode(n1, t, store)
    const candidate = findCandidate(adapted.analysis!.moves, 3, 3)!
    expect(candidate.pointsLost).toBeGreaterThan(0)
    expect(candidate.pointsLost).toBeCloseTo(2, 10)
  })

  it('la candidata MÁS VISITADA (order=0) construida para calzar exacto con rootScoreLead → pointsLost cercano/exacto a 0', () => {
    const t = tree9()
    const store = new AnalysisStore()
    store.set(
      t.root.id,
      mkAnalysis({
        scoreLead: 4,
        moves: [
          mkMoveAnalysis({ x: 3, y: 3 }, { scoreLead: 4, visits: 100 }), // calza exacto con el root
          mkMoveAnalysis({ x: 4, y: 4 }, { scoreLead: 1, visits: 1 }),
        ],
      })
    )
    const adapted = adaptGameNode(t.root, t, store)
    const best = findCandidate(adapted.analysis!.moves, 3, 3)!
    expect(best.order).toBe(0)
    expect(best.pointsLost).toBe(0)
  })

  it('White jugando peor incrementa pointsLost proporcionalmente al delta de scoreLead (no solo el signo)', () => {
    const t = tree9()
    const store = new AnalysisStore()
    const n1 = t.addMove(B(2, 2))
    store.set(
      n1.id,
      mkAnalysis({
        scoreLead: -2,
        moves: [mkMoveAnalysis({ x: 0, y: 8 }, { scoreLead: 6, visits: 1 })], // blunder de Blanco: entrega 8 puntos
      })
    )
    const adapted = adaptGameNode(n1, t, store)
    const candidate = findCandidate(adapted.analysis!.moves, 0, 8)!
    expect(candidate.pointsLost).toBeCloseTo(8, 10)
  })
})

// ── Nodo sin análisis → seguro en toda la cadena ────────────────────────────────────────────

describe('katrainAdapter — nodo sin análisis en AnalysisStore', () => {
  it('árbol de 3 jugadas, SOLO raíz y última jugada analizadas → adaptMainLine no lanza; intermedios .analysis===undefined; raíz y última poblados; cadena .parent intacta', () => {
    const t = tree9()
    const store = new AnalysisStore()
    const n1 = t.addMove(B(2, 2))
    const n2 = t.addMove(W(6, 6))
    const n3 = t.addMove(B(4, 4))
    store.set(t.root.id, mkAnalysis({ scoreLead: 0, moves: [mkMoveAnalysis({ x: 2, y: 2 }, { visits: 1 })] }))
    store.set(n3.id, mkAnalysis({ scoreLead: 1, moves: [mkMoveAnalysis({ x: 0, y: 0 }, { visits: 1 })] }))
    // n1, n2 deliberadamente SIN entrada en el store.

    let adapted: ReturnType<typeof adaptMainLine>
    expect(() => {
      adapted = adaptMainLine(t, store)
    }).not.toThrow()

    adapted = adaptMainLine(t, store)
    expect(adapted).toHaveLength(3)
    expect(adapted[0]!.analysis).toBeUndefined() // n1
    expect(adapted[1]!.analysis).toBeUndefined() // n2
    expect(adapted[2]!.analysis).toBeDefined() // n3, la última jugada

    // Navega .parent desde el último nodo adaptado hasta llegar a la raíz (move === null).
    let cursor = adapted[2]!
    while (cursor.move !== null) {
      expect(cursor.parent).not.toBeNull()
      cursor = cursor.parent!
    }
    // `cursor` es ahora la raíz adaptada: move===null, parent===null, y SÍ tiene analysis
    // (porque store.get(tree.root.id) la tenía).
    expect(cursor.parent).toBeNull()
    expect(cursor.analysis).toBeDefined()
  })

  it('adaptGameNode sobre un nodo sin análisis en toda la cadena de padres tampoco lanza', () => {
    const t = tree9()
    const store = new AnalysisStore()
    const n1 = t.addMove(B(2, 2))
    t.addMove(W(6, 6))
    const n3 = t.addMove(B(4, 4))
    expect(() => adaptGameNode(n3, t, store)).not.toThrow()
    const adapted = adaptGameNode(n3, t, store)
    expect(adapted.analysis).toBeUndefined()
    expect(adapted.parent!.analysis).toBeUndefined()
    expect(adapted.parent!.parent!.analysis).toBeUndefined()
    const root = adapted.parent!.parent!.parent! // raíz adaptada: move===null, parent===null
    expect(root.move).toBeNull()
    expect(root.parent).toBeNull()
    expect(root.analysis).toBeUndefined()
    void n1
  })
})

// ── Contrato exacto de adaptMainLine + integración end-to-end con computeGameReport ────────

describe('katrainAdapter — adaptMainLine: contrato exacto + integración con computeGameReport (Task 4)', () => {
  it('largo = tree.mainLine().length; mainLine[0].parent = raíz adaptada (move/parent null); con la raíz analizada, permite computeGameReport real', () => {
    const t = tree9()
    const store = new AnalysisStore()

    store.set(t.root.id, mkAnalysis({ scoreLead: 0, moves: [mkMoveAnalysis({ x: 8, y: 8 }, { visits: 1 })] }))
    const n1 = t.addMove(B(2, 2))
    store.set(n1.id, mkAnalysis({ scoreLead: 2, moves: [mkMoveAnalysis({ x: 8, y: 8 }, { visits: 1 })] }))
    const n2 = t.addMove(W(6, 6))
    store.set(n2.id, mkAnalysis({ scoreLead: 1, moves: [mkMoveAnalysis({ x: 8, y: 8 }, { visits: 1 })] }))
    const n3 = t.addMove(B(4, 4))
    store.set(n3.id, mkAnalysis({ scoreLead: 3, moves: [mkMoveAnalysis({ x: 8, y: 8 }, { visits: 1 })] }))

    const adapted = adaptMainLine(t, store)

    expect(adapted).toHaveLength(t.mainLine().length)
    expect(adapted).toHaveLength(3)
    expect(adapted[0]!.parent).not.toBeNull()
    expect(adapted[0]!.parent!.move).toBeNull()
    expect(adapted[0]!.parent!.parent).toBeNull()
    expect(adapted[0]!.parent!.analysis).toBeDefined()
    expect(adapted[0]!.parent!.analysis!.rootScoreLead).toBe(0)

    const report = computeGameReport({
      mainLine: adapted,
      boardSize: t.meta.boardSize,
      thresholds: [...DEFAULT_EVAL_THRESHOLDS],
    })

    expect(report.moveEntries).toHaveLength(3)
    expect(report.moveEntries.map((e) => e.moveNumber)).toEqual([1, 2, 3])
    // La 1ª jugada (Negro) SÍ aparece en el reporte — prueba que la cadena .parent hasta la raíz
    // adaptada permitió calcular pointsLost de la primera jugada (si no, se habría omitido en
    // silencio, ver comentario de contrato en gameReport.ts).
    expect(report.moveEntries[0]!.player).toBe('black')
  })
})

// ── pv → coordenadas GTP ────────────────────────────────────────────────────────────────────

describe('katrainAdapter — pv se convierte a coordenadas GTP reusando formatBoardMoveLabel', () => {
  it('pv:[{x:3,y:3},"pass"] (tengen, boardSize 9) → CandidateMove.pv con 2 strings GTP, el 2º = "Pass"', () => {
    const t = tree9()
    const store = new AnalysisStore()
    store.set(
      t.root.id,
      mkAnalysis({
        moves: [mkMoveAnalysis({ x: 0, y: 0 }, { pv: [{ x: 3, y: 3 }, 'pass'] })],
      })
    )
    const adapted = adaptGameNode(t.root, t, store)
    const candidate = findCandidate(adapted.analysis!.moves, 0, 0)!
    expect(candidate.pv).toEqual([formatBoardMoveLabel({ x: 3, y: 3 }, 9), formatBoardMoveLabel({ x: -1, y: -1 }, 9)])
    expect(candidate.pv).toEqual(['D6', 'Pass'])
  })
})

// ── adaptGameNode sobre un nodo intermedio (no el último de la mainLine) ───────────────────

describe('katrainAdapter — adaptGameNode sobre un nodo intermedio (uso futuro del cursor actual)', () => {
  it('nodo del medio de un árbol de 5 jugadas: adaptGameNode aislado es consistente con el resultado de adaptMainLine para ese mismo nodo', () => {
    const t = tree9()
    const store = new AnalysisStore()

    store.set(t.root.id, mkAnalysis({ scoreLead: 0, moves: [mkMoveAnalysis({ x: 0, y: 0 }, { visits: 3 })] }))
    t.addMove(B(0, 0))
    const n2 = t.addMove(W(1, 1))
    store.set(n2.id, mkAnalysis({ scoreLead: -1, moves: [mkMoveAnalysis({ x: 1, y: 2 }, { visits: 7 })] }))
    const n3 = t.addMove(B(2, 2)) // nodo del medio — NO tiene análisis propio
    t.addMove(W(3, 3))
    t.addMove(B(4, 4))

    expect(t.mainLine()).toHaveLength(5)

    const isolated = adaptGameNode(n3, t, store)
    const viaMainLine = adaptMainLine(t, store)[2]! // índice 2 = n3 (3ª jugada)

    expect(isolated).toEqual(viaMainLine)
    expect(isolated.move).toEqual({ x: 2, y: 2, player: 'black' })
    expect(isolated.analysis).toBeUndefined()
  })
})
