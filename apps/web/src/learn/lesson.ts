// Bloque 1 del currículo FEDIBERGO (spec 2026-09-15-aprender-curriculo-design.md, Pieza 1): una
// Lesson envuelve teoría + 6 ejercicios + el oponente sugerido para la partida de práctica. Mismo
// patrón que exercise.ts: tipo + validador de forma, sin lógica de UI ni de motor acá.
//
// Desde el Bloque 3, un ejercicio de lección puede ser un `Exercise` (jugada) o un
// `CountingExercise` (conteo de puntos, sin jugada) -- ver countingExercise.ts. Ensanchamiento de
// tipo, no migración de datos: bloque-1.json/bloque-2.json no tienen `kind`, así que
// `isCountingExercise` los sigue reconociendo como `Exercise` sin tocarlos.
import type { HumanRank, BoardSize } from '@tengen/engine'
import { exerciseIssues } from './exercise'
import { countingExerciseIssues, isCountingExercise, type LessonExercise } from './countingExercise'

export interface Lesson {
  id: string
  block: number
  workshop: number
  title: string
  /** Párrafos de texto plano -- sin Markdown (ver Global Constraints). */
  theory: readonly string[]
  exercises: readonly LessonExercise[]
  /** true en los talleres 10/20/30 -- el campo se define ahora aunque el piloto no lo ejercita. */
  checkpoint: boolean
  practiceOpponent: { rank: HumanRank; boardSize: BoardSize }
}

/** Problemas de forma de una Lesson. [] = apta. Reusa exerciseIssues/countingExerciseIssues por
 * cada ejercicio -- no duplica sus reglas de legalidad/forma. */
export function lessonIssues(lesson: Lesson): string[] {
  const issues: string[] = []
  if (lesson.title.trim() === '') issues.push('title vacío')
  if (lesson.theory.length === 0) issues.push('theory vacía: la lección no tiene texto')
  lesson.theory.forEach((p, i) => {
    if (p.trim() === '') issues.push(`theory[${i}] es un párrafo vacío`)
  })
  if (lesson.exercises.length !== 6) {
    issues.push(`exercises.length debe ser 6, es ${lesson.exercises.length}`)
  }
  lesson.exercises.forEach((ex, i) => {
    if (isCountingExercise(ex)) {
      for (const issue of countingExerciseIssues(ex)) issues.push(`exercises[${i}]: ${issue}`)
    } else if ('tree' in ex) {
      for (const issue of exerciseIssues(ex)) issues.push(`exercises[${i}]: ${issue}`)
    } else {
      // Guarda de forma: un JSON malformado sin `kind:'conteo'` NI `tree` pasa el cast de
      // TypeScript (`as unknown as LessonExercise[]` en curriculum.ts) sin que el compilador lo
      // vea -- esto lo atrapa en runtime en vez de reventar exerciseIssues con un `.tree` inexistente.
      issues.push(`exercises[${i}]: no es reconocible como Exercise (sin 'tree') ni CountingExercise (sin kind:'conteo')`)
    }
  })
  return issues
}
