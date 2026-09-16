// Fase Aprender Bloque 3: el formato de un ejercicio de "contar puntos" (posición TERMINADA, sin
// árbol de jugadas) y su validador de forma/contenido. Dominio puro (corre en Node), mismo patrón
// que exercise.ts/exerciseIssues, pero sin `tree`: el alumno declara un score y se lo compara
// (Task 3, UI) contra `countArea` (más komi si el ejercicio lo trae).
//
// `LessonExercise` es la unión que consume `Lesson.exercises` (lesson.ts): un ejercicio de lección
// es o bien un `Exercise` (jugada, con `tree`) o bien un `CountingExercise` (conteo, con `kind:
// 'conteo'`) -- discriminados por `isCountingExercise`.
import type { BoardSize } from '@tengen/engine'
import type { SetupStones } from '../game/rules'
import { countArea } from '../game/territory'
import type { Exercise } from './exercise'

export interface CountingExercise {
  kind: 'conteo'
  id: string
  collection: string
  boardSize: BoardSize
  setup: SetupStones
  /** Piedras + territorio SIN komi, horneado y verificado contra `countArea` real -- mismo
   * protocolo que el `correct` horneado de un `Exercise`. */
  correctScore: { black: number; white: number }
  /** Ausente si el ejercicio no juega con komi (p.ej. Lección 11); 5.5 desde la Lección 12. */
  komi?: number
}

export type LessonExercise = Exercise | CountingExercise

/** Type guard: distingue CountingExercise de Exercise dentro de la unión LessonExercise. */
export function isCountingExercise(exercise: LessonExercise): exercise is CountingExercise {
  return 'kind' in exercise && exercise.kind === 'conteo'
}

/**
 * Problemas de forma/contenido de un CountingExercise. [] = apto. Mismo protocolo que
 * exerciseIssues/checkObjective:
 * - setup no vacío (una posición de conteo sin piedras no es una posición);
 * - sin vértices duplicados dentro de un mismo color, ni el mismo vértice en ambos colores;
 * - komi no negativo, si está presente;
 * - `correctScore` coincide EXACTAMENTE con el `countArea` real (piedras+territorio, sin komi) --
 *   drift entre lo declarado y lo calculado es un error de contenido, no una advertencia.
 */
export function countingExerciseIssues(exercise: CountingExercise): string[] {
  const issues: string[] = []
  const { setup, komi, correctScore, boardSize } = exercise

  if (setup.black.length === 0 && setup.white.length === 0) {
    issues.push('setup vacío: un ejercicio de conteo sin piedras no es un ejercicio de conteo')
  }

  const seen = new Map<string, 'black' | 'white'>()
  const checkDuplicates = (vertices: { x: number; y: number }[], color: 'black' | 'white'): void => {
    for (const v of vertices) {
      const key = `${v.x},${v.y}`
      const existing = seen.get(key)
      if (existing === undefined) {
        seen.set(key, color)
      } else if (existing === color) {
        issues.push(`(${v.x},${v.y}) duplicado en setup.${color}`)
      } else {
        issues.push(`(${v.x},${v.y}) aparece en ambos colores (setup.black y setup.white)`)
      }
    }
  }
  checkDuplicates(setup.black, 'black')
  checkDuplicates(setup.white, 'white')

  if (komi !== undefined && komi < 0) {
    issues.push(`komi negativo: ${komi}`)
  }

  const computed = countArea(boardSize, setup)
  if (computed.black !== correctScore.black || computed.white !== correctScore.white) {
    issues.push(
      `correctScore no coincide con countArea real: declarado ${JSON.stringify(correctScore)}, ` +
        `calculado ${JSON.stringify(computed)}`,
    )
  }

  return issues
}
