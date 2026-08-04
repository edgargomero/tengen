// Fase Aprender T3: el guardián de los datos REALES commiteados. Todo dataset registrado en
// learn/collections.ts pasa por acá: forma discriminable, legalidad de cada rama (exerciseIssues
// delega en go-board) y las invariantes que el player asume (toPlay coherente, correct horneado).
// Si el conversor o una edición manual rompen un JSON, este test lo dice ANTES del bundle — es la
// contraparte del cast `as Exercise[]` del registro.
import { describe, expect, it } from 'vitest'
import { COLLECTIONS } from '../src/learn/collections'
import { exerciseIssues } from '../src/learn/exercise'
import { createExerciseSession } from '../src/learn/exerciseSession'

describe('datos reales de Aprender', () => {
  it('hay al menos una colección registrada y ninguna está vacía', () => {
    expect(COLLECTIONS.length).toBeGreaterThan(0)
    for (const collection of COLLECTIONS) {
      expect(collection.exercises.length).toBeGreaterThan(0)
    }
  })

  it('cada ejercicio pasa el validador de forma y legalidad sin un solo problema', () => {
    for (const collection of COLLECTIONS) {
      for (const exercise of collection.exercises) {
        expect({ id: exercise.id, issues: exerciseIssues(exercise) }).toEqual({ id: exercise.id, issues: [] })
      }
    }
  })

  it('los ids son únicos entre TODAS las colecciones (el progreso se indexa por id)', () => {
    const ids = COLLECTIONS.flatMap((c) => c.exercises.map((e) => e.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('cada ejercicio real se puede jugar: la primera jugada de solution() resuelve o avanza', () => {
    for (const collection of COLLECTIONS) {
      for (const exercise of collection.exercises) {
        const session = createExerciseSession(exercise)
        const line = session.solution()
        expect(line.length).toBeGreaterThan(0)
        const first = line[0]!
        expect(first.vertex).not.toBe('pass')
        if (first.vertex === 'pass') continue
        const result = session.attempt(first.vertex)
        expect(['resuelto', 'avanza']).toContain(result.kind)
      }
    }
  })
})
