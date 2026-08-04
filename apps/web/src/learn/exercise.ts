// Fase Aprender T3: el formato de un ejercicio de tsumego y su validador de forma/legalidad.
// Dominio puro (corre en Node): lo consumen el conversor local (scripts/convert-tsumego.mjs), el
// test que custodia los datos commiteados (tests/exercise.test.ts + tests/learnData.test.ts) y la
// sesión de ejercicio (learn/exerciseSession.ts).
//
// Contrato del árbol:
// - La raíz es la POSICIÓN inicial (setup + toPlay): no lleva `move`. Todo descendiente sí.
// - La profundidad alterna colores empezando por `toPlay` (nivel 1 = jugada del alumno).
// - `correct` viene HORNEADO por el conversor en cada nodo cuyo move es del color del alumno
//   (marca explícita del SGF o heurística "primera rama = solución" con WARNING): la sesión no
//   adivina nada en runtime. En nodos del rival `correct` no aplica.
import type { Move, StoneColor } from '@tengen/engine'
import { isMoveSequenceLegal, type SetupStones } from '../game/rules'

export type ExerciseObjective = 'matar' | 'vivir' | 'ko' | 'desconocido'

export interface ExerciseNode {
  /** Ausente SOLO en la raíz. */
  move?: Move
  /** Solo significativo en jugadas del color del alumno: ¿esta jugada mantiene viva la solución? */
  correct?: boolean
  /** Comentario didáctico del SGF original (si lo hay). */
  comment?: string
  children: ExerciseNode[]
}

export interface Exercise {
  id: string
  collection: string
  boardSize: 19
  setup: SetupStones
  toPlay: StoneColor
  objective: ExerciseObjective
  /** 1 (fácil) a 5 (difícil), si la colección lo trae. */
  difficulty?: number
  /** Raíz sin move; sus hijos son las primeras jugadas del alumno. */
  tree: ExerciseNode
}

const opposite = (c: StoneColor): StoneColor => (c === 'black' ? 'white' : 'black')

/**
 * Problemas de forma/legalidad de un Exercise. [] = apto. Cada string es un mensaje con el path
 * (índices de hijo desde la raíz) para ubicar el nodo ofensor. Reglas:
 * - raíz sin `move`; todo no-raíz con `move` (nunca 'pass' en v1: un tsumego no se resuelve pasando);
 * - colores alternan por rama empezando por `toPlay`;
 * - toda jugada del color del alumno trae `correct` horneado;
 * - toda rama raíz→hoja es legal sobre el setup (delegado en go-board vía isMoveSequenceLegal);
 * - setup no vacío y al menos una rama correcta.
 */
export function exerciseIssues(exercise: Exercise): string[] {
  const issues: string[] = []
  const { tree, setup, toPlay, boardSize } = exercise

  if (setup.black.length === 0 && setup.white.length === 0) {
    issues.push('setup vacío: un tsumego sin piedras no es un tsumego')
  }
  if (tree.move !== undefined) {
    issues.push('la raíz no debe llevar move (es la posición inicial)')
  }

  let hasCorrectBranch = false

  const walk = (node: ExerciseNode, path: number[], expectedColor: StoneColor, prefix: Move[]): void => {
    node.children.forEach((child, i) => {
      const childPath = [...path, i]
      const label = `[${childPath.join('.')}]`
      if (child.move === undefined) {
        issues.push(`${label} nodo no-raíz sin move`)
        return
      }
      if (child.move.vertex === 'pass') {
        issues.push(`${label} pass no soportado en un árbol de ejercicio (v1)`)
        return
      }
      if (path.length === 0 && child.move.color !== toPlay) {
        issues.push(`${label} la primera jugada debe ser de toPlay (${toPlay})`)
        return
      }
      if (child.move.color !== expectedColor) {
        issues.push(`${label} los colores no alternan (se esperaba ${expectedColor})`)
        return
      }
      if (child.move.color === toPlay && child.correct === undefined) {
        issues.push(`${label} jugada del alumno sin correct horneado`)
      }
      if (child.correct === true) hasCorrectBranch = true

      const line = [...prefix, child.move]
      if (child.children.length === 0 && !isMoveSequenceLegal(boardSize, 0, line, setup)) {
        issues.push(`${label} rama ilegal (captura/ko/overwrite inválido en la secuencia)`)
      }
      walk(child, childPath, opposite(expectedColor), line)
    })
  }
  walk(tree, [], toPlay, [])

  if (!hasCorrectBranch) {
    issues.push('el árbol no tiene ninguna rama correcta (no hay solución que enseñar)')
  }
  return issues
}
