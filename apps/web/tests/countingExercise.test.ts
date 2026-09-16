// Fase Aprender Bloque 3: countingExerciseIssues es el guardián de contenido de un
// CountingExercise -- mismo protocolo que exercise.test.ts/exerciseIssues, corre a mano en cada
// task de autoría antes de comitear (ver countingExercise.ts).
import { describe, expect, it } from 'vitest'
import type { BoardSize } from '@tengen/engine'
import { countingExerciseIssues, type CountingExercise } from '../src/learn/countingExercise'

const SIZE: BoardSize = 9

// Mismo muro adyacente negro(x=4)/blanco(x=5) de territory.test.ts -- calculado a mano ahí:
// negro=45, blanco=36, sin dame.
const VALID_SETUP = {
  black: Array.from({ length: SIZE }, (_, y) => ({ x: 4, y })),
  white: Array.from({ length: SIZE }, (_, y) => ({ x: 5, y })),
}

function validExercise(): CountingExercise {
  return {
    kind: 'conteo',
    id: 'test-conteo-001',
    collection: 'test',
    boardSize: SIZE,
    setup: { black: [...VALID_SETUP.black], white: [...VALID_SETUP.white] },
    correctScore: { black: 45, white: 36 },
  }
}

describe('countingExerciseIssues', () => {
  it('un ejercicio bien formado no reporta problemas', () => {
    expect(countingExerciseIssues(validExercise())).toEqual([])
  })

  it('un ejercicio bien formado CON komi no negativo tampoco reporta problemas', () => {
    const e = validExercise()
    e.komi = 5.5
    expect(countingExerciseIssues(e)).toEqual([])
  })

  it('setup vacío (sin piedras de ningún color) es un problema', () => {
    const e = validExercise()
    e.setup = { black: [], white: [] }
    expect(countingExerciseIssues(e).some((m) => m.includes('setup vacío'))).toBe(true)
  })

  it('komi negativo es un problema', () => {
    const e = validExercise()
    e.komi = -1
    expect(countingExerciseIssues(e).some((m) => m.includes('komi'))).toBe(true)
  })

  it('un vértice duplicado dentro del mismo color es un problema', () => {
    const e = validExercise()
    e.setup = { black: [...e.setup.black, { x: 4, y: 0 }], white: e.setup.white }
    expect(countingExerciseIssues(e).some((m) => m.includes('duplicado'))).toBe(true)
  })

  it('un vértice que aparece en ambos colores a la vez es un problema', () => {
    const e = validExercise()
    e.setup = { black: [...e.setup.black, { x: 5, y: 0 }], white: e.setup.white }
    expect(countingExerciseIssues(e).some((m) => m.includes('ambos colores'))).toBe(true)
  })

  it('correctScore.black con drift respecto a countArea real es un problema', () => {
    const e = validExercise()
    e.correctScore = { black: 999, white: 36 }
    expect(countingExerciseIssues(e).some((m) => m.includes('correctScore'))).toBe(true)
  })

  it('correctScore.white con drift respecto a countArea real también se detecta', () => {
    const e = validExercise()
    e.correctScore = { black: 45, white: 0 }
    expect(countingExerciseIssues(e).some((m) => m.includes('correctScore'))).toBe(true)
  })
})
