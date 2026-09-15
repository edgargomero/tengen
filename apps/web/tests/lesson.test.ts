import { describe, it, expect } from 'vitest'
import { lessonIssues, type Lesson } from '../src/learn/lesson'
import type { Exercise } from '../src/learn/exercise'

function validExercise(id: string): Exercise {
  return {
    id,
    collection: 'test',
    boardSize: 9,
    setup: { black: [{ x: 3, y: 4 }], white: [{ x: 2, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 3 }] },
    toPlay: 'white',
    objective: 'matar',
    tree: {
      children: [
        { move: { color: 'white', vertex: { x: 3, y: 5 } }, correct: true, children: [] },
      ],
    },
  }
}

const validLesson: Lesson = {
  id: 'b1-l1',
  block: 1,
  workshop: 1,
  title: 'La jugada y la captura',
  theory: ['Párrafo uno.', 'Párrafo dos.'],
  exercises: Array.from({ length: 6 }, (_, i) => validExercise(`ex-${i}`)),
  checkpoint: false,
  practiceOpponent: { rank: '20k', boardSize: 9 },
}

describe('lessonIssues', () => {
  it('acepta una lección válida', () => {
    expect(lessonIssues(validLesson)).toEqual([])
  })

  it('rechaza menos de 6 ejercicios', () => {
    const issues = lessonIssues({ ...validLesson, exercises: validLesson.exercises.slice(0, 3) })
    expect(issues).toContain('exercises.length debe ser 6, es 3')
  })

  it('rechaza theory vacía', () => {
    expect(lessonIssues({ ...validLesson, theory: [] })).toContain('theory vacía: la lección no tiene texto')
  })

  it('propaga un exerciseIssues real (setup vacío)', () => {
    const broken = { ...validExercise('broken'), setup: { black: [], white: [] } }
    const issues = lessonIssues({ ...validLesson, exercises: [broken, ...validLesson.exercises.slice(1)] })
    expect(issues.some((i) => i.includes('setup vacío'))).toBe(true)
  })
})
