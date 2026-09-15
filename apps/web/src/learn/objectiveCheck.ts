// Bloque 1 (spec 2026-09-15-aprender-curriculo-design.md, Pieza 3): árbitro de reglas puras para
// las Lecciones 1-3. Recorre CADA punto jugable de la posición inicial y confirma, con las mismas
// reglas que usa una partida real, qué jugada logra el objetivo pedagógico -- sin motor. Más
// estricto que exerciseIssues (que confía en el `correct` horneado) en una sola dirección: un nodo
// `correct` que no logra el objetivo es un error real; un punto que lo logra sin estar marcado es
// un reporte para resolver a mano (agregarlo como `correct` extra o achicar la posición), porque el
// propio enunciado de FEDIBERGO admite más de una jugada válida en los problemas de defensa.
import GoBoard from '@sabaki/go-board'
import type { StoneColor } from '@tengen/engine'
import { boardFromMoves, applyMove, capturesOf, validateMove } from '../game/rules'
import { colorToSign } from '../game/coords'
import type { Exercise } from './exercise'

export interface ObjectiveCheckResult {
  wrongCorrect: { x: number; y: number }[]
  unmarkedAlternatives: { x: number; y: number }[]
}

function opposite(color: StoneColor): StoneColor {
  return color === 'black' ? 'white' : 'black'
}

/** Grupos del color `color` con exactamente 1 libertad en `board` -- "en atari". */
function groupsInAtari(board: GoBoard, color: StoneColor): { x: number; y: number }[][] {
  const sign = colorToSign(color)
  const seen = new Set<string>()
  const groups: { x: number; y: number }[][] = []
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (board.get([x, y]) !== sign) continue
      const key = `${x},${y}`
      if (seen.has(key)) continue
      const chain = board.getChain([x, y])
      chain.forEach(([cx, cy]) => seen.add(`${cx},${cy}`))
      if (board.getLiberties([x, y]).length === 1) {
        groups.push(chain.map(([cx, cy]) => ({ x: cx, y: cy })))
      }
    }
  }
  return groups
}

function achievesObjective(exercise: Exercise, v: { x: number; y: number }): boolean {
  const before = boardFromMoves(exercise.boardSize, 0, [], exercise.setup)
  if (!validateMove(before, exercise.toPlay, v).legal) return false

  if (exercise.objective === 'matar') {
    const capturesBefore = capturesOf(before)
    const after = applyMove(before, exercise.toPlay, v)
    return capturesOf(after)[exercise.toPlay] > capturesBefore[exercise.toPlay]
  }

  if (exercise.objective === 'vivir') {
    const atGroups = groupsInAtari(before, exercise.toPlay)
    if (atGroups.length === 0) return false
    const after = applyMove(before, exercise.toPlay, v)
    return atGroups.some((group) => {
      const anchor = group[0]
      if (!anchor) return false
      if (after.get([anchor.x, anchor.y]) !== colorToSign(exercise.toPlay)) return false
      return after.getLiberties([anchor.x, anchor.y]).length >= 2
    })
  }

  if (exercise.objective === 'ko') {
    const capturesBefore = capturesOf(before)
    const after = applyMove(before, exercise.toPlay, v)
    if (capturesOf(after)[exercise.toPlay] <= capturesBefore[exercise.toPlay]) return false
    const diff = before.diff(after) ?? []
    const captured = diff.find(([x, y]) => after.get([x, y]) === 0 && before.get([x, y]) !== 0)
    if (!captured) return false
    const recapture = validateMove(after, opposite(exercise.toPlay), { x: captured[0], y: captured[1] })
    return !recapture.legal && recapture.reason === 'ko'
  }

  return false
}

/** Todos los vértices del tablero (ocupados incluidos -- `achievesObjective` los descarta por
 * `validateMove` devolviendo overwrite=ilegal, así que no hace falta filtrarlos acá). */
function everyVertex(boardSize: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  for (let y = 0; y < boardSize; y++) for (let x = 0; x < boardSize; x++) points.push({ x, y })
  return points
}

export function checkObjective(exercise: Exercise): ObjectiveCheckResult {
  const correctVertices = exercise.tree.children
    .filter((c) => c.move !== undefined && c.move.vertex !== 'pass' && c.correct === true)
    .map((c) => (c.move!.vertex as { x: number; y: number }))

  const wrongCorrect = correctVertices.filter((v) => !achievesObjective(exercise, v))

  const correctKeys = new Set(correctVertices.map((v) => `${v.x},${v.y}`))
  const unmarkedAlternatives = everyVertex(exercise.boardSize).filter(
    (v) => !correctKeys.has(`${v.x},${v.y}`) && achievesObjective(exercise, v),
  )

  return { wrongCorrect, unmarkedAlternatives }
}
