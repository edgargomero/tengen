import { describe, expect, it } from 'vitest'
import type { Analysis, Move, MoveAnalysis, Vertex } from '@tengen/engine'
import { GameTree } from '../src/game/gameTree'
import { AnalysisStore } from '../src/analysis/analysisStore'
import { buildGhostStoneMap, buildHeatMap, buildPvLines, toneToGhostType } from '../src/analysis/overlays'

// ─────────────────────────────────────────────────────────────────────────────
// El foco real de esta tarea (Task 8): traducir `Analysis`/`GameNode` nativos a las
// primitivas de `@sabaki/shudan`. El footgun de indexación es el riesgo central:
// `Map<T> = T[][]` de Shudan se indexa `grid[y][x]`, NO `grid[x][y]`. Cada test de
// grilla usa un vértice ASIMÉTRICO (x≠y) y verifica AMBAS celdas — la correcta
// poblada Y la transpuesta vacía — para que una transposición silenciosa no pase.
// ─────────────────────────────────────────────────────────────────────────────

function tree9(): GameTree {
  return new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
}

const B = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const W = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })

function mkMoveAnalysis(vertex: Vertex, overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return { vertex, visits: 10, winrate: 0.5, scoreLead: 0, prior: 0.1, pv: [], ...overrides }
}

function mkAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits: 50, moves: [], ...overrides }
}

describe('buildHeatMap', () => {
  it('indexa [y][x], no [x][y]: un vértice asimétrico vive en grid[y][x] y grid[x][y] queda null', () => {
    const analysis = mkAnalysis({
      moves: [mkMoveAnalysis({ x: 2, y: 7 }, { visits: 50 }), mkMoveAnalysis({ x: 0, y: 0 }, { visits: 25 })],
    })
    const grid = buildHeatMap(analysis, 9)

    expect(grid).toHaveLength(9)
    expect(grid[7]![2]).toEqual({ strength: 1 })
    // Belt-and-suspenders: la celda TRANSPUESTA debe quedar vacía. Un bug que indexe
    // [x][y] pondría el dato aquí en vez de en grid[7][2] y este assert lo cazaría.
    expect(grid[2]![7]).toBeNull()
  })

  it('normaliza strength a [0,1]: la candidata más visitada da 1, la mitad de visitas da 0.5', () => {
    const analysis = mkAnalysis({
      moves: [mkMoveAnalysis({ x: 1, y: 0 }, { visits: 100 }), mkMoveAnalysis({ x: 5, y: 5 }, { visits: 50 })],
    })
    const grid = buildHeatMap(analysis, 9)

    expect(grid[0]![1]).toEqual({ strength: 1 })
    expect(grid[5]![5]).toEqual({ strength: 0.5 })
  })

  it('omite la candidata de pase de la grilla, pero SÍ cuenta sus visits para normalizar maxVisits', () => {
    const analysis = mkAnalysis({
      moves: [mkMoveAnalysis('pass', { visits: 100 }), mkMoveAnalysis({ x: 3, y: 3 }, { visits: 25 })],
    })
    const grid = buildHeatMap(analysis, 9)

    // maxVisits=100 (del pase, aunque no se dibuje) → la candidata real da 25/100=0.25.
    expect(grid[3]![3]).toEqual({ strength: 0.25 })
    const nonNullCells = grid.flat().filter((cell) => cell !== null)
    expect(nonNullCells).toHaveLength(1)
  })

  it('analysis.moves vacío → grilla boardSize×boardSize toda null, sin lanzar', () => {
    const analysis = mkAnalysis({ moves: [] })
    const grid = buildHeatMap(analysis, 9)

    expect(grid).toHaveLength(9)
    for (const row of grid) {
      expect(row).toHaveLength(9)
      for (const cell of row) expect(cell).toBeNull()
    }
  })

  it('todas las candidatas con 0 visits → strength 0, no NaN (guard de división por cero)', () => {
    const analysis = mkAnalysis({ moves: [mkMoveAnalysis({ x: 4, y: 4 }, { visits: 0 })] })
    const grid = buildHeatMap(analysis, 9)

    expect(grid[4]![4]).toEqual({ strength: 0 })
  })
})

describe('toneToGhostType (mapeo tone→type de Shudan, testeado exhaustivamente y en aislamiento)', () => {
  it('success → good', () => {
    expect(toneToGhostType('success')).toBe('good')
  })
  it('warning → doubtful', () => {
    expect(toneToGhostType('warning')).toBe('doubtful')
  })
  it('danger → bad', () => {
    expect(toneToGhostType('danger')).toBe('bad')
  })
  it("muted → null (sin GhostStone, NO se inventa un type — 'interesting' queda sin usar)", () => {
    expect(toneToGhostType('muted')).toBeNull()
  })
})

describe('buildGhostStoneMap', () => {
  it('tone success → type good; sign=1 para Negro; indexa [y][x] con vértice asimétrico (grid[x][y] queda null)', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    store.set(tree.root.id, mkAnalysis({ scoreLead: 5, moves: [mkMoveAnalysis({ x: 2, y: 7 }, { scoreLead: 5 })] }))
    const node = tree.addMove(B(2, 7))

    const grid = buildGhostStoneMap(node, tree, store, 9)

    expect(grid[7]![2]).toEqual({ sign: 1, type: 'good' })
    expect(grid[2]![7]).toBeNull()
  })

  it('tone warning → type doubtful; sign=-1 para Blanco', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    const node1 = tree.addMove(B(4, 4)) // avanza el turno a Blanco; no se le pide calidad en este test.
    store.set(node1.id, mkAnalysis({ scoreLead: 5, moves: [mkMoveAnalysis({ x: 0, y: 0 }, { scoreLead: 5.5 })] }))
    const node2 = tree.addMove(W(0, 0))
    // pointsLost = sign(blanco=-1) * (rootScoreLead(5) - candidateScoreLead(5.5)) = -1 * (-0.5) = 0.5 → warning.

    const grid = buildGhostStoneMap(node2, tree, store, 9)

    expect(grid[0]![0]).toEqual({ sign: -1, type: 'doubtful' })
  })

  it('tone danger → type bad', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    store.set(tree.root.id, mkAnalysis({ scoreLead: 5, moves: [mkMoveAnalysis({ x: 3, y: 3 }, { scoreLead: 0 })] }))
    const node = tree.addMove(B(3, 3))
    // pointsLost = 1 * (5 - 0) = 5 → danger.

    const grid = buildGhostStoneMap(node, tree, store, 9)

    expect(grid[3]![3]).toEqual({ sign: 1, type: 'bad' })
  })

  it('raíz (node.move===null) → grilla toda null, sin lanzar', () => {
    const tree = tree9()
    const store = new AnalysisStore()

    const grid = buildGhostStoneMap(tree.root, tree, store, 9)

    expect(grid).toHaveLength(9)
    for (const row of grid) for (const cell of row) expect(cell).toBeNull()
  })

  it('sin datos suficientes (parent sin analizar) → getPlayedMoveQuality da null → celda null, no un GhostStone inventado', () => {
    const tree = tree9()
    const store = new AnalysisStore() // vacío: root nunca se analizó.
    const node = tree.addMove(B(4, 4))

    const grid = buildGhostStoneMap(node, tree, store, 9)

    for (const row of grid) for (const cell of row) expect(cell).toBeNull()
  })

  it('jugada de pase → sin casilla que llenar, grilla toda null', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    store.set(tree.root.id, mkAnalysis({ scoreLead: 0, moves: [] }))
    const node = tree.addMove({ color: 'black', vertex: 'pass' })

    const grid = buildGhostStoneMap(node, tree, store, 9)

    for (const row of grid) for (const cell of row) expect(cell).toBeNull()
  })
})

describe('buildPvLines', () => {
  it('pv YA incluye el vértice de topMove como primer elemento → sin segmento duplicado de largo 0', () => {
    const topMove = mkMoveAnalysis(
      { x: 3, y: 3 },
      { pv: [{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }] }
    )

    const lines = buildPvLines(topMove, 9)

    expect(lines).toEqual([
      { v1: [3, 3], v2: [4, 4], type: 'line' },
      { v1: [4, 4], v2: [5, 5], type: 'line' },
    ])
  })

  it('pv NO incluye el vértice de topMove → se antepone correctamente', () => {
    const topMove = mkMoveAnalysis({ x: 1, y: 1 }, { pv: [{ x: 2, y: 2 }, { x: 3, y: 3 }] })

    const lines = buildPvLines(topMove, 9)

    expect(lines).toEqual([
      { v1: [1, 1], v2: [2, 2], type: 'line' },
      { v1: [2, 2], v2: [3, 3], type: 'line' },
    ])
  })

  it("pv con un 'pass' en el medio → se trunca ahí (inclusive), no dibuja más allá", () => {
    const topMove = mkMoveAnalysis({ x: 0, y: 0 }, { pv: [{ x: 1, y: 1 }, { x: 2, y: 2 }, 'pass', { x: 8, y: 8 }] })

    const lines = buildPvLines(topMove, 9)

    expect(lines).toEqual([
      { v1: [0, 0], v2: [1, 1], type: 'line' },
      { v1: [1, 1], v2: [2, 2], type: 'line' },
    ])
  })

  it("topMove.vertex mismo ya es 'pass' (primer elemento pase) → nada que dibujar", () => {
    const topMove = mkMoveAnalysis('pass', { pv: [{ x: 1, y: 1 }] })

    expect(buildPvLines(topMove, 9)).toEqual([])
  })

  it('secuencia útil de largo 1 (tras dedup, sin pv) → []', () => {
    const topMove = mkMoveAnalysis({ x: 0, y: 0 }, { pv: [] })

    expect(buildPvLines(topMove, 9)).toEqual([])
  })

  it('vértice fuera de rango del tablero → se descarta defensivamente y trunca ahí (mismo trato que un pase)', () => {
    const topMove = mkMoveAnalysis({ x: 0, y: 0 }, { pv: [{ x: 1, y: 1 }, { x: 99, y: 2 }] })

    const lines = buildPvLines(topMove, 9)

    expect(lines).toEqual([{ v1: [0, 0], v2: [1, 1], type: 'line' }])
  })
})
