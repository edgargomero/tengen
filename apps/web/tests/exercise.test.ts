// Fase Aprender T3: forma y legalidad de un Exercise. `exerciseIssues` es el validador compartido
// entre el conversor local (scripts/convert-tsumego.mjs) y el test que custodia los datos
// commiteados: un ejercicio con rama ilegal o etiquetado incompleto NO llega al bundle.
import { describe, expect, it } from 'vitest'
import { exerciseIssues, type Exercise, type ExerciseNode } from '../src/learn/exercise'

// Tsumego mínimo legal en la esquina: Negro mata con (0,1); (2,0) falla. Setup:
//   . B W      (0,0) negro  (1,0) negro… no: armamos algo simple y legal.
// Esquina superior izquierda, juegan negras:
//   W en (0,0) y (1,0); B en (0,2), (1,1), (2,0) — la blanca tiene libertades en (0,1) solamente.
//   Solución: B (0,1) captura. Fallo: B pasa de largo con (5,5).
const SETUP = {
  black: [
    { x: 0, y: 2 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
  ],
  white: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
}

function node(partial: Partial<ExerciseNode> & { children?: ExerciseNode[] }): ExerciseNode {
  return { children: [], ...partial }
}

function validExercise(): Exercise {
  return {
    id: 'test-001',
    collection: 'test',
    boardSize: 19,
    setup: SETUP,
    toPlay: 'black',
    objective: 'matar',
    tree: node({
      children: [
        node({ move: { color: 'black', vertex: { x: 0, y: 1 } }, correct: true }),
        node({ move: { color: 'black', vertex: { x: 5, y: 5 } }, correct: false, comment: 'Deja vivir' }),
      ],
    }),
  }
}

describe('exerciseIssues', () => {
  it('un ejercicio bien formado no reporta problemas', () => {
    expect(exerciseIssues(validExercise())).toEqual([])
  })

  it('la raíz con move es un problema (la raíz es la posición inicial, no una jugada)', () => {
    const e = validExercise()
    e.tree.move = { color: 'black', vertex: { x: 3, y: 3 } }
    expect(exerciseIssues(e)).not.toEqual([])
  })

  it('un nodo interno sin move es un problema', () => {
    const e = validExercise()
    e.tree.children.push(node({ children: [] })) // hijo sin move
    expect(exerciseIssues(e).some((m) => m.includes('move'))).toBe(true)
  })

  it('una rama ilegal (jugada sobre piedra existente) se reporta con el path', () => {
    const e = validExercise()
    e.tree.children.push(node({ move: { color: 'black', vertex: { x: 0, y: 0 } }, correct: false })) // sobre la blanca
    expect(exerciseIssues(e).some((m) => m.includes('ilegal'))).toBe(true)
  })

  it('la primera jugada de una rama con color distinto a toPlay es un problema', () => {
    const e = validExercise()
    e.tree.children.push(node({ move: { color: 'white', vertex: { x: 7, y: 7 } } }))
    expect(exerciseIssues(e).some((m) => m.includes('toPlay'))).toBe(true)
  })

  it('colores que no alternan dentro de una rama son un problema', () => {
    const e = validExercise()
    e.tree.children.push(
      node({
        move: { color: 'black', vertex: { x: 7, y: 7 } },
        correct: true,
        children: [node({ move: { color: 'black', vertex: { x: 8, y: 8 } }, correct: true })],
      }),
    )
    expect(exerciseIssues(e).some((m) => m.includes('altern'))).toBe(true)
  })

  it('una jugada del alumno sin `correct` horneado es un problema (la sesión no adivina)', () => {
    const e = validExercise()
    e.tree.children.push(node({ move: { color: 'black', vertex: { x: 7, y: 7 } } }))
    expect(exerciseIssues(e).some((m) => m.includes('correct'))).toBe(true)
  })

  it('setup vacío es un problema (un tsumego sin piedras no es un tsumego)', () => {
    const e = validExercise()
    e.setup = { black: [], white: [] }
    expect(exerciseIssues(e).some((m) => m.includes('setup'))).toBe(true)
  })

  it('un árbol sin ninguna rama correcta es un problema (no hay solución que enseñar)', () => {
    const e = validExercise()
    e.tree.children = [node({ move: { color: 'black', vertex: { x: 5, y: 5 } }, correct: false })]
    expect(exerciseIssues(e).some((m) => m.includes('correcta'))).toBe(true)
  })
})
