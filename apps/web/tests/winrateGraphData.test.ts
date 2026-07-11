import { describe, expect, it } from 'vitest'
import type { Analysis, Move } from '@tengen/engine'
import { GameTree } from '../src/game/gameTree'
import { AnalysisStore } from '../src/analysis/analysisStore'
import { buildWinrateGraphData } from '../src/analysis/winrateGraphData'

// ─────────────────────────────────────────────────────────────────────────────
// `buildWinrateGraphData` recorre `[tree.root, ...tree.mainLine()]` y solo emite
// un punto por nodo YA analizado (progresivo de verdad, sin placeholders). El
// foco de estos tests: (1) el hueco de nodos sin analizar se omite del array, no
// se rellena; (2) `moveNumber` seguro (raíz=0, luego 1..N); (3) `smooth:true`
// promedia POSICIONALMENTE sobre los puntos YA presentes (dos puntos consecutivos
// en el array resultante se tratan como vecinos aunque haya un hueco de jugadas
// sin analizar entre ellos en la partida real — comportamiento documentado, no bug).
// ─────────────────────────────────────────────────────────────────────────────

function tree9(): GameTree {
  return new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
}

const B = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const W = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })

function mkAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits: 50, moves: [], ...overrides }
}

describe('buildWinrateGraphData', () => {
  it('solo los nodos analizados aparecen, en orden, con moveNumber correcto (raíz=0, luego 1..N)', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    const node1 = tree.addMove(B(2, 2))
    const node2 = tree.addMove(W(3, 3))
    const node3 = tree.addMove(B(4, 4))

    store.set(tree.root.id, mkAnalysis({ winrate: 0.5, scoreLead: 0 }))
    // node1 queda SIN analizar deliberadamente (hueco).
    store.set(node2.id, mkAnalysis({ winrate: 0.6, scoreLead: 2 }))
    // node3 queda SIN analizar deliberadamente (hueco al final).

    const points = buildWinrateGraphData(tree, store)

    expect(points).toEqual([
      { nodeId: tree.root.id, moveNumber: 0, winrate: 0.5, scoreLead: 0 },
      { nodeId: node2.id, moveNumber: 2, winrate: 0.6, scoreLead: 2 },
    ])
    void node1
    void node3
  })

  it('ningún nodo analizado → []', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    tree.addMove(B(2, 2))
    tree.addMove(W(3, 3))

    expect(buildWinrateGraphData(tree, store)).toEqual([])
  })

  it('árbol sin ninguna jugada (solo raíz) analizada → un único punto moveNumber=0', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    store.set(tree.root.id, mkAnalysis({ winrate: 0.42, scoreLead: 1.5 }))

    expect(buildWinrateGraphData(tree, store)).toEqual([{ nodeId: tree.root.id, moveNumber: 0, winrate: 0.42, scoreLead: 1.5 }])
  })
})

describe('buildWinrateGraphData — opts.smooth', () => {
  it('smooth:true produce una serie DISTINTA de smooth:false/omitido, promediando con el valor previo', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    const node1 = tree.addMove(B(2, 2))
    const node2 = tree.addMove(W(3, 3))

    store.set(tree.root.id, mkAnalysis({ winrate: 0, scoreLead: 0 }))
    store.set(node1.id, mkAnalysis({ winrate: 10, scoreLead: 4 }))
    store.set(node2.id, mkAnalysis({ winrate: 20, scoreLead: 8 }))

    const raw = buildWinrateGraphData(tree, store)
    const smoothed = buildWinrateGraphData(tree, store, { smooth: true })
    const explicitlyUnsmoothed = buildWinrateGraphData(tree, store, { smooth: false })

    expect(raw).toEqual([
      { nodeId: tree.root.id, moveNumber: 0, winrate: 0, scoreLead: 0 },
      { nodeId: node1.id, moveNumber: 1, winrate: 10, scoreLead: 4 },
      { nodeId: node2.id, moveNumber: 2, winrate: 20, scoreLead: 8 },
    ])
    // Mismo promedio que `analysisSmoothing.ts` (Task 3): (previous+value)/2, primer valor intacto.
    expect(smoothed).toEqual([
      { nodeId: tree.root.id, moveNumber: 0, winrate: 0, scoreLead: 0 },
      { nodeId: node1.id, moveNumber: 1, winrate: 5, scoreLead: 2 },
      { nodeId: node2.id, moveNumber: 2, winrate: 15, scoreLead: 6 },
    ])
    expect(smoothed).not.toEqual(raw)
    expect(explicitlyUnsmoothed).toEqual(raw)
  })

  it('con un hueco (nodo sin analizar) el suavizado promedia POSICIONALMENTE sobre los puntos presentes, no sobre jugadas consecutivas', () => {
    const tree = tree9()
    const store = new AnalysisStore()
    const node1 = tree.addMove(B(2, 2))
    const node2 = tree.addMove(W(3, 3))
    const node3 = tree.addMove(B(4, 4))

    store.set(tree.root.id, mkAnalysis({ winrate: 0, scoreLead: 0 }))
    // node1 (moveNumber 1) SIN analizar: hueco real de una jugada en la partida.
    store.set(node2.id, mkAnalysis({ winrate: 10, scoreLead: 4 }))
    store.set(node3.id, mkAnalysis({ winrate: 20, scoreLead: 8 }))

    const smoothed = buildWinrateGraphData(tree, store, { smooth: true })

    // Puntos presentes: [root(0), node2(2), node3(3)]. El suavizado trata root/node2 como
    // VECINOS en el array (aunque en la partida real hay una jugada de por medio sin analizar).
    expect(smoothed).toEqual([
      { nodeId: tree.root.id, moveNumber: 0, winrate: 0, scoreLead: 0 },
      { nodeId: node2.id, moveNumber: 2, winrate: 5, scoreLead: 2 },
      { nodeId: node3.id, moveNumber: 3, winrate: 15, scoreLead: 6 },
    ])
  })
})
