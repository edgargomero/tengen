// Puente entre el árbol de partida de tengen (`GameTree`/`GameNode`, Fase 2) + el cache de análisis
// (`AnalysisStore`, Task 2) y la forma de `GameNode`/`CandidateMove`/`AnalysisResult` que esperan los
// archivos portados de web-katrain en `./vendor/web-katrain/` (Tasks 3-4). Archivo 100% NATIVO de
// tengen — NO es un port, no lleva cabecera MIT ni entrada en THIRD-PARTY-LICENSES/
// adaptaciones-upstream.md. Solo CONSUME lo ya portado; no copia lógica de ahí.
//
// Es el ÚNICO lugar del código donde el `GameNode`/`Move` de tengen y el `GameNode`/`Move` del
// vendor (mismos nombres, formas DISTINTAS) se tocan — de ahí que TODOS los imports de ambos mundos
// lleven alias explícito (`Tengen*` / `Vendor*`), sin excepción, para que nunca quede un `GameNode`
// ambiguo en este archivo.
//
// Puntos de riesgo (ver docs/superpowers/plans/2026-07-11-fase3a-analizar.md, Task 5):
//   1. Convención de pase: tengen usa el literal `'pass'` en `Vertex`; el vendor usa `x<0||y<0`
//      (confirmado en `xyToGtp` de gameReport.ts). `adaptVertex` es la ÚNICA función que decide esa
//      conversión, y se aplica igual a `node.move` y a cada candidata — si no fueran la misma
//      función, un pase real nunca calzaría con su candidata en `parent.analysis.moves.find(...)`.
//   2. `order`: el vendor usa `order=0` como "mejor jugada" (más visitada). tengen no ordena
//      `Analysis.moves`. Se ordena una COPIA (nunca el array original, que puede estar cacheado/
//      reusado en `AnalysisStore`) por `visits` descendente.
//   3. Signo de `pointsLost`: NO existe en `MoveAnalysis` de tengen (decisión deliberada de Fase 2,
//      ver comentario de `mapAnalysis` en `packages/engine/src/engine.ts:44-67` — `Analysis.scoreLead`
//      YA viene en perspectiva de Negro, tanto root como por candidata, así que la resta no necesita
//      más conversión de perspectiva). Se calcula aquí con la misma fórmula/convención de signo que
//      `computePointsLostStrict` (gameReport.ts) / `computeNodePointsLost` (nodeAnalysis.ts):
//        pointsLost = signo(mover) × (rootScoreLead_del_nodo − candidata.scoreLead)
//        signo = +1 si mover==='black', −1 si mover==='white'
//      donde `mover` es SIEMPRE `tree.currentTurnAt(node)` — quien elige ENTRE estas candidatas
//      DESDE `node` — nunca `node.move.color` (el color que jugó PARA LLEGAR a `node`).
import type { Analysis, BoardSize, Move as TengenMove, MoveAnalysis, StoneColor, Vertex as TengenVertex } from '@tengen/engine'
import type { GameNode as TengenGameNode, GameTree } from '../game/gameTree'
import type { AnalysisStore } from './analysisStore'
import { formatBoardMoveLabel } from './vendor/web-katrain/playedMoveQuality'
import type {
  AnalysisResult as VendorAnalysisResult,
  CandidateMove as VendorCandidateMove,
  GameNode as VendorGameNode,
  Move as VendorMove,
} from './vendor/web-katrain/types'

/**
 * Convención de pase: `(-1,-1)`. Verificado en `~/dev/vendor/web-katrain/src/utils/gameReport.ts`,
 * `xyToGtp(x,y,boardSize)`: `if (x < 0 || y < 0) return 'pass'` — cualquier x<0 o y<0 es pase para
 * el vendor, y `(-1,-1)` es la codificación natural. Reusada IDÉNTICA para `node.move` y para cada
 * candidata (ver riesgo #1 en la cabecera del archivo).
 */
function adaptVertex(v: TengenVertex): { x: number; y: number } {
  return v === 'pass' ? { x: -1, y: -1 } : { x: v.x, y: v.y }
}

function adaptMove(move: TengenMove | null): VendorMove | null {
  if (!move) return null
  const { x, y } = adaptVertex(move.vertex)
  return { x, y, player: move.color } // StoneColor === Player (mismos literales), sin conversión.
}

/**
 * Adapta una candidata individual. `pointsLost` y `order` son los dos campos que el vendor espera y
 * que `MoveAnalysis` de tengen NO trae (ver riesgo #2/#3 en la cabecera).
 */
function adaptCandidate(
  m: MoveAnalysis,
  rootScoreLead: number,
  mover: StoneColor,
  boardSize: BoardSize,
  order: number
): VendorCandidateMove {
  const { x, y } = adaptVertex(m.vertex)
  const sign = mover === 'black' ? 1 : -1
  const pointsLost = sign * (rootScoreLead - m.scoreLead)
  return {
    x,
    y,
    winRate: m.winrate,
    scoreLead: m.scoreLead,
    visits: m.visits,
    pointsLost,
    order,
    prior: m.prior,
    // `formatBoardMoveLabel` ya testeada en Task 4 (columna salta la 'I') — no se reimplementa aquí.
    pv: m.pv.map((v) => formatBoardMoveLabel(adaptVertex(v), boardSize)),
  }
}

/**
 * Adapta un `Analysis` completo de tengen. `mover` es quien elige ENTRE `a.moves` — SIEMPRE
 * `tree.currentTurnAt(node)` del nodo dueño de este análisis, nunca `node.move.color` (ver riesgo #3).
 * `moves` se ordena por `visits` DESCENDENTE sobre una COPIA (nunca se muta `a.moves`, que puede
 * estar cacheado/reusado por el motor en `AnalysisStore`); `order` = índice en esa copia ordenada.
 */
function adaptAnalysisResult(a: Analysis, mover: StoneColor, boardSize: BoardSize): VendorAnalysisResult {
  const sortedByVisitsDesc = [...a.moves].sort((x, y) => y.visits - x.visits)
  return {
    rootWinRate: a.winrate,
    rootScoreLead: a.scoreLead,
    rootVisits: a.visits,
    moves: sortedByVisitsDesc.map((m, i) => adaptCandidate(m, a.scoreLead, mover, boardSize, i)),
  }
}

/**
 * Adapta un único nodo de tengen (sin recursar sobre `.parent` — eso lo hace el caller, ver
 * `adaptGameNode`/`adaptMainLine` abajo, que difieren solo en CÓMO obtienen el `parent` ya adaptado).
 */
function adaptNodeShallow(
  node: TengenGameNode,
  tree: GameTree,
  store: AnalysisStore,
  parent: VendorGameNode | null
): VendorGameNode {
  const analysis = store.get(node.id)
  return {
    move: adaptMove(node.move),
    parent,
    analysis: analysis ? adaptAnalysisResult(analysis, tree.currentTurnAt(node), tree.meta.boardSize) : undefined,
  }
}

/**
 * Adapta un `GameNode` de tengen arbitrario, con su cadena `.parent` completa adaptada RECURSIVAMENTE
 * hasta la raíz (`move: null, parent: null`). Camina solo hacia arriba por `.parent` — nunca resuelve
 * `.children`/variaciones, así que funciona igual sobre un nodo de una variación (uso futuro del
 * cursor actual en Tasks 8/9) que sobre uno de la línea principal.
 */
export function adaptGameNode(node: TengenGameNode, tree: GameTree, store: AnalysisStore): VendorGameNode {
  const parent = node.parent ? adaptGameNode(node.parent, tree, store) : null
  return adaptNodeShallow(node, tree, store, parent)
}

/**
 * Adapta `tree.mainLine()` completa (SIN la raíz — primer elemento = primera jugada), con `.parent`
 * encadenado hasta un `VendorGameNode` que representa la raíz de tengen (con su propio `.analysis` si
 * `store.get(tree.root.id)` la tiene). Es el contrato directo que espera `computeGameReport` de Task 4
 * (ver comentario junto a su firma en `./vendor/web-katrain/gameReport.ts`).
 *
 * Adapta cada nodo (incluida la raíz) UNA sola vez, reutilizando el nodo previo ya adaptado como
 * `.parent` del siguiente — evita re-adaptar ancestros compartidos, a diferencia de llamar
 * `adaptGameNode` por cada nodo de `tree.mainLine()` (que sí re-adaptaría toda la cadena de padres en
 * cada llamada). Resultado equivalente en ambos casos. (`tree.currentTurnAt` sigue caminando hasta la
 * raíz internamente por nodo — este método no elimina ese costo, solo evita duplicar la adaptación.)
 */
export function adaptMainLine(tree: GameTree, store: AnalysisStore): VendorGameNode[] {
  let previous = adaptNodeShallow(tree.root, tree, store, null)
  const result: VendorGameNode[] = []
  for (const node of tree.mainLine()) {
    const adapted = adaptNodeShallow(node, tree, store, previous)
    result.push(adapted)
    previous = adapted
  }
  return result
}
