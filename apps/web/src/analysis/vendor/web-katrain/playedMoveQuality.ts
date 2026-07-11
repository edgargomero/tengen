/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/playedMoveQuality.ts. Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 *
 * ── Cambios de adaptación (Fase 3a, Task 4) ──────────────────────────────────────────────────────
 * 1. `getPlayedMoveQuality(node, pointsLostOverride?)` leía `node.gameState.board.length` para el
 *    tamaño de tablero. El `GameNode` trimmed de tengen (`./types`) no tiene `gameState`, así que
 *    gana un parámetro `boardSize: number` explícito: `getPlayedMoveQuality(node, boardSize,
 *    pointsLostOverride?)`, que se pasa directo a `formatBoardMoveLabel(move, boardSize)`.
 *    `formatBoardMoveLabel` en sí NO cambia de firma (sigue con su default `boardSize = 19`, es una
 *    función standalone reusable) — solo cambia cómo `getPlayedMoveQuality` obtiene el valor que le
 *    pasa.
 * 2. `getNextMoveQuality(node, activeBranches?)` usaba `getActiveChild(node, activeBranches)` de
 *    `branchNavigation.ts` (excluido del port — ver motivo abajo). Como Fase 3a es main-line-only,
 *    "el hijo activo" es siempre `node.children[0] ?? null` (mismo razonamiento que ya usa
 *    `GameTree.mainLine()` de tengen, que navega estrictamente por `children[0]`, ver
 *    `apps/web/src/game/gameTree.ts:124-132`). Firma adaptada: `getNextMoveQuality(node, boardSize):
 *    PlayedMoveQuality | null` (sin `activeBranches`, ya no aplica).
 *
 * ── Nota de tipo: `children` vive local a este archivo, NO en `./types` ─────────────────────────
 * El `GameNode` trimmed compartido (`./types`, Task 3) es `{move, parent, analysis?}` — sin
 * `children`, porque ninguna otra función portada (`nodeAnalysis.ts`, `analysisSummary.ts`,
 * `analysisCoverage.ts`, `analysisSmoothing.ts`, `topMoveMetric.ts`, `gameReport.ts`) lo necesita.
 * Solo `getNextMoveQuality` (este archivo) necesita navegar a un hijo, así que el campo se declara
 * LOCALMENTE como `GameNodeWithChildren = GameNode & { children: GameNode[] }` en vez de extender el
 * tipo compartido (instrucción explícita del brief de esta tarea: no tocar `./types` salvo que un
 * campo haga falta genuinamente — este sí hace falta, pero solo para esta única función, así que se
 * acota el alcance en vez de ensanchar el tipo compartido). El `GameNode` real de tengen
 * (`apps/web/src/game/gameTree.ts:31-36`) ya trae `children: GameNode[]` de forma nativa, así que
 * Task 5 puede satisfacer este parámetro pasando directamente (o casi directamente) el nodo real del
 * árbol en vez de la forma trimmed que usa `computeGameReport`.
 *
 * ── Exclusión deliberada: `branchNavigation.ts` / `positionEval.ts` (NO se portan) ─────────────
 * Mismo motivo que en `gameReport.ts` (ver su cabecera): Fase 3a acota el alcance a la línea
 * principal de la partida (`tree.mainLine()` de tengen), así que la resolución de "rama activa" de
 * `branchNavigation.ts` (`ActiveBranchMap`/`getActiveChild`, 189 líneas) no hace falta — se excluye
 * del port (hallazgo 16 del plan de Fase 3a) y se re-evalúa cuando una fase futura necesite revisar
 * variaciones. `positionEval.ts` tampoco se porta (glue code impuro sobre el store de web-katrain,
 * tengen ya tiene el equivalente vía `Analysis.scoreLead`/`winrate`; hallazgo 15). Ninguno de los dos
 * es importado por este archivo en el original.
 *
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */
import type { CandidateMove, GameNode, Move, Player } from './types'
import { summarizePointsLost, type PointsLostSummary } from './analysisSummary'
import { computeNodePointsLost } from './nodeAnalysis'

/**
 * `GameNode` trimmed + `children`, usado SOLO por `getNextMoveQuality` (reemplaza
 * `getActiveChild`/`ActiveBranchMap` de `branchNavigation.ts`, excluido — ver cabecera del archivo).
 * No vive en `./types` porque ninguna otra función portada de este directorio lo necesita.
 */
export type GameNodeWithChildren = GameNode & { children: GameNode[] }

export interface PlayedMoveQuality {
  moveLabel: string
  playerLabel: 'B' | 'W'
  rank: number | null
  rankLabel: string
  valueLabel: string
  detailLabel: string
  tone: PointsLostSummary['tone']
  title: string
}

function playerLabel(player: Player): 'B' | 'W' {
  return player === 'black' ? 'B' : 'W'
}

export function formatBoardMoveLabel(move: Pick<Move, 'x' | 'y'>, boardSize = 19): string {
  if (move.x < 0 || move.y < 0) return 'Pass'
  const column = String.fromCharCode(65 + (move.x >= 8 ? move.x + 1 : move.x))
  return `${column}${boardSize - move.y}`
}

function candidateRank(candidate: CandidateMove, candidates: CandidateMove[]): number {
  if (Number.isFinite(candidate.order) && candidate.order >= 0) return Math.floor(candidate.order) + 1
  const index = candidates.indexOf(candidate)
  return index >= 0 ? index + 1 : 1
}

function findBestCandidate(candidates: CandidateMove[]): CandidateMove | null {
  return candidates.find((candidate) => candidate.order === 0) ?? candidates[0] ?? null
}

export function getPlayedMoveQuality(
  node: GameNode,
  boardSize: number,
  pointsLostOverride?: number | null
): PlayedMoveQuality | null {
  const move = node.move
  const parent = node.parent
  if (!move || !parent) return null

  const candidates = parent.analysis?.moves ?? []
  const candidate = candidates.find((item) => item.x === move.x && item.y === move.y) ?? null
  const pointsLost = typeof pointsLostOverride === 'number' && Number.isFinite(pointsLostOverride)
    ? pointsLostOverride
    : computeNodePointsLost(node)

  if (!candidate && typeof pointsLost !== 'number') return null

  const rank = candidate ? candidateRank(candidate, candidates) : null
  const moveLabel = formatBoardMoveLabel(move, boardSize)
  const side = playerLabel(move.player)
  const rankLabel = rank ? `#${rank}` : 'Unranked'
  const summary = summarizePointsLost(pointsLost)
  const valueLabel = summary.label === '-' && rank === 1 ? 'Best' : summary.label
  const tone = valueLabel === 'Best' ? 'success' : summary.tone
  const bestCandidate = findBestCandidate(candidates)
  const bestLabel = bestCandidate ? formatBoardMoveLabel(bestCandidate, boardSize) : null

  const titleParts = [`${side} ${moveLabel}`]
  if (rank) titleParts.push(`engine candidate ${rankLabel}`)
  if (summary.label !== '-') titleParts.push(summary.label.toLowerCase())
  if (bestLabel && bestLabel !== moveLabel) titleParts.push(`best was ${bestLabel}`)

  return {
    moveLabel,
    playerLabel: side,
    rank,
    rankLabel,
    valueLabel,
    detailLabel: rank ? `${side} ${moveLabel} ${rankLabel}` : `${side} ${moveLabel}`,
    tone,
    title: titleParts.join(' - '),
  }
}

export function getNextMoveQuality(
  node: GameNodeWithChildren,
  boardSize: number
): PlayedMoveQuality | null {
  const nextNode = node.children[0] ?? null
  return nextNode ? getPlayedMoveQuality(nextNode, boardSize) : null
}
