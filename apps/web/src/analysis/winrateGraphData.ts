// Extrae la serie de datos del gráfico de winrate/scoreLead de "Modo Analizar" (Fase 3a, Task 8) a
// partir de `GameTree` + `AnalysisStore`. Archivo 100% NATIVO: no copia lógica de ningún archivo
// vendor propio nuevo — solo CONSUME `smoothAnalysisGraphValues` (Task 3, ya portado). Sin cabecera
// MIT, sin entrada en THIRD-PARTY-LICENSES/adaptaciones-upstream.md.
import type { GameTree } from '../game/gameTree'
import type { AnalysisStore } from './analysisStore'
import { smoothAnalysisGraphValues } from './vendor/web-katrain/analysisSmoothing'

export type WinrateGraphPoint = {
  nodeId: number
  /** 0 para la raíz; `depth+1` (misma convención que Task 4/`gameReport.ts`) para cada nodo de
   * `tree.mainLine()`. Como `[tree.root, ...tree.mainLine()]` ya antepone la raíz, el índice 0-based
   * de ESE array coincide exactamente con este número (raíz→0, mainLine()[0]→1, mainLine()[1]→2…) —
   * no hace falta una rama especial para la raíz, es una coincidencia aritmética, no un caso aparte. */
  moveNumber: number
  /** Perspectiva Negro, sin convertir — `Analysis.winrate` tal cual. */
  winrate: number
  /** Perspectiva Negro, sin convertir — `Analysis.scoreLead` tal cual. */
  scoreLead: number
}

/**
 * Recorre `[tree.root, ...tree.mainLine()]`; por cada nodo YA analizado (`store.has(node.id)`)
 * agrega un punto. Un nodo sin analizar se OMITE del array (no un placeholder/`null`) — el gráfico
 * progresivo simplemente tiene menos puntos hasta que el review de fondo avanza, mismo espíritu
 * "progresivo de verdad" que `GameReview`.
 *
 * `opts.smooth`: aplica `smoothAnalysisGraphValues` en dos pasadas independientes (winrate y
 * scoreLead) sobre las series YA extraídas de los puntos presentes — es decir, el suavizado es
 * POSICIONAL sobre el array resultante, no sobre "jugada N del total teórico" de la partida. Si hay
 * huecos por nodos aún sin analizar, dos puntos consecutivos EN EL ARRAY se tratan como vecinos
 * aunque no sean jugadas consecutivas en la partida real. Es una aproximación ACEPTADA (documentada
 * aquí y testeada explícitamente), no un bug: recalcular vecindad "real" tendría que inventar
 * valores para los huecos, contradiciendo la decisión de arriba de omitirlos sin más.
 */
export function buildWinrateGraphData(tree: GameTree, store: AnalysisStore, opts?: { smooth?: boolean }): WinrateGraphPoint[] {
  const nodes = [tree.root, ...tree.mainLine()]
  const points: WinrateGraphPoint[] = []

  nodes.forEach((node, index) => {
    const analysis = store.get(node.id)
    if (!analysis) return
    points.push({ nodeId: node.id, moveNumber: index, winrate: analysis.winrate, scoreLead: analysis.scoreLead })
  })

  if (!opts?.smooth) return points

  const smoothedWinrates = smoothAnalysisGraphValues(points.map((p) => p.winrate))
  const smoothedScoreLeads = smoothAnalysisGraphValues(points.map((p) => p.scoreLead))
  return points.map((p, i) => ({ ...p, winrate: smoothedWinrates[i]!, scoreLead: smoothedScoreLeads[i]! }))
}
