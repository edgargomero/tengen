// Fase Aprender T3: el guardián de los datos REALES commiteados. Todo dataset registrado en
// learn/collections.ts pasa por acá: forma discriminable, legalidad de cada rama (exerciseIssues
// delega en go-board) y las invariantes que el player asume (toPlay coherente, correct horneado).
// Si el conversor o una edición manual rompen un JSON, este test lo dice ANTES del bundle — es la
// contraparte del cast `as Exercise[]` del registro.
import { describe, expect, it } from 'vitest'
import { COLLECTIONS } from '../src/learn/collections'
import { exerciseIssues } from '../src/learn/exercise'
import { createExerciseSession } from '../src/learn/exerciseSession'
import { CURRICULUM } from '../src/learn/curriculum'
import { lessonIssues } from '../src/learn/lesson'
import { checkObjective } from '../src/learn/objectiveCheck'

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

  it('los ids son únicos entre TODAS las colecciones Y el currículo (comparten namespace de progreso: `tengen:learn:v1` se indexa por id, y una colisión contaminaría el progreso entre ambos o desbloquearía una lección sola)', () => {
    const ids = [
      ...COLLECTIONS.flatMap((c) => c.exercises.map((e) => e.id)),
      ...CURRICULUM.flatMap((l) => l.exercises.map((e) => e.id)),
    ]
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

describe('CURRICULUM', () => {
  it('cada lección registrada pasa lessonIssues sin problemas', () => {
    for (const lesson of CURRICULUM) {
      expect(lessonIssues(lesson), `lección ${lesson.id}`).toEqual([])
    }
  })

  it('el orden de bloque/workshop es estrictamente creciente (desbloqueo secuencial depende de esto)', () => {
    const workshops = CURRICULUM.map((l) => l.workshop)
    expect(workshops).toEqual([...workshops].sort((a, b) => a - b))
  })

  // Pieza 3 de la spec: "el chequeo exhaustivo de reglas de la Pieza 3 [...] contra cada punto
  // jugable de cada posición, no solo los del árbol". Hasta ahora `checkObjective` era una
  // conveniencia de autoría que cada task de contenido corría a mano -- nada en CI lo ejecutaba
  // contra el JSON commiteado, así que una edición futura que rompiera una posición pasaría sin que
  // nada lo detectara. `wrongCorrect` es la mitad de fallo duro (una jugada marcada `correct` que en
  // realidad no logra el objetivo); `unmarkedAlternatives` es reporte, no fallo, por diseño de la
  // spec (FEDIBERGO admite más de una jugada válida en varios problemas de defensa) -- pero si
  // aparece, se hace visible por `console.warn` para que una regresión futura no quede muda.
  it('checkObjective: cada jugada marcada correct logra el objetivo pedagógico, en cada punto jugable de cada ejercicio real', () => {
    for (const lesson of CURRICULUM) {
      for (const exercise of lesson.exercises) {
        // Guarda contra un gate vacío: si nadie marcó ninguna jugada correct entre los hijos
        // directos de la raíz (lo que mira checkObjective), wrongCorrect sería trivialmente [] sin
        // haber chequeado nada real.
        const correctCount = exercise.tree.children.filter(
          (c) => c.move !== undefined && c.move.vertex !== 'pass' && c.correct === true,
        ).length
        expect(correctCount, `${lesson.id}/${exercise.id}: ninguna jugada correct entre los hijos de la raíz`).toBeGreaterThan(0)

        const result = checkObjective(exercise)
        if (result.unmarkedAlternatives.length > 0) {
          console.warn(
            `${lesson.id}/${exercise.id}: ${result.unmarkedAlternatives.length} alternativa(s) sin marcar que también logran el objetivo -- ${JSON.stringify(result.unmarkedAlternatives)}`,
          )
        }
        expect(
          result.wrongCorrect,
          `${lesson.id}/${exercise.id}: jugada(s) marcadas correct que NO logran el objetivo -- ${JSON.stringify(result.wrongCorrect)}`,
        ).toEqual([])
      }
    }
  })
})
