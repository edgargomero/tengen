// Bloque 1 del currículo FEDIBERGO (spec 2026-09-15-aprender-curriculo-design.md, Pieza 1): una
// Lesson envuelve teoría + 6 Exercise + el oponente sugerido para la partida de práctica. Mismo
// patrón que exercise.ts: tipo + validador de forma, sin lógica de UI ni de motor acá.
import type { HumanRank, BoardSize } from '@tengen/engine'
import { exerciseIssues, type Exercise } from './exercise'

export interface Lesson {
  id: string
  block: number
  workshop: number
  title: string
  /** Párrafos de texto plano -- sin Markdown (ver Global Constraints). */
  theory: readonly string[]
  exercises: readonly Exercise[]
  /** true en los talleres 10/20/30 -- el campo se define ahora aunque el piloto no lo ejercita. */
  checkpoint: boolean
  practiceOpponent: { rank: HumanRank; boardSize: BoardSize }
}

/** Problemas de forma de una Lesson. [] = apta. Reusa exerciseIssues por cada ejercicio -- no
 * duplica sus reglas de legalidad/forma. */
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
    for (const issue of exerciseIssues(ex)) issues.push(`exercises[${i}]: ${issue}`)
  })
  return issues
}
