// Fase Aprender T4: máquina de estados pura de un ejercicio (sin motor adentro). La vista decide
// qué hacer ante 'fuera-de-arbol' (llamar al motor, T5); acá solo se navega el árbol de solución.
import { describe, expect, it } from 'vitest'
import { createExerciseSession } from '../src/learn/exerciseSession'
import type { Exercise, ExerciseNode } from '../src/learn/exercise'

// Esquina superior izquierda, juegan negras ("matar"):
//   setup: W(0,0) W(1,0) · B(0,2) B(1,1) B(2,0)
//   Solución: B(0,1) captura las dos blancas → hoja correcta.
//   Con resistencia: B(3,3) correcta → W(4,4) responde → B(5,5) correcta (hoja).
//   Fallo en árbol: B(6,6) incorrecta, con refutación W(0,1) y comentario.
const n = (partial: Partial<ExerciseNode>): ExerciseNode => ({ children: [], ...partial })
const B = (x: number, y: number) => ({ color: 'black' as const, vertex: { x, y } })
const W = (x: number, y: number) => ({ color: 'white' as const, vertex: { x, y } })

function exercise(): Exercise {
  return {
    id: 'demo-001',
    collection: 'demo',
    boardSize: 19,
    setup: {
      black: [
        { x: 0, y: 2 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ],
      white: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
    toPlay: 'black',
    objective: 'matar',
    tree: n({
      children: [
        n({ move: B(0, 1), correct: true, comment: 'Captura limpia' }),
        n({
          move: B(3, 3),
          correct: true,
          children: [n({ move: W(4, 4), children: [n({ move: B(5, 5), correct: true })] })],
        }),
        n({
          move: B(6, 6),
          correct: false,
          comment: 'Deja vivir',
          children: [n({ move: W(7, 7) })],
        }),
      ],
    }),
  }
}

describe('createExerciseSession — attempt', () => {
  it('jugada correcta que es hoja → resuelto, con su comentario', () => {
    const s = createExerciseSession(exercise())
    const r = s.attempt({ x: 0, y: 1 })
    expect(r).toEqual({ kind: 'resuelto', comment: 'Captura limpia' })
    expect(s.state).toBe('resuelto')
  })

  it('jugada correcta con continuación → avanza con la respuesta del rival; sigue esperando', () => {
    const s = createExerciseSession(exercise())
    const r = s.attempt({ x: 3, y: 3 })
    expect(r).toEqual({ kind: 'avanza', reply: W(4, 4) })
    expect(s.state).toBe('esperando')
    // El tablero ya tiene la jugada del alumno Y la respuesta del rival.
    const board = s.tree.boardAt()
    expect(board.get([3, 3])).toBe(1)
    expect(board.get([4, 4])).toBe(-1)
    // Y la línea se puede rematar: B(5,5) resuelve.
    expect(s.attempt({ x: 5, y: 5 })).toEqual({ kind: 'resuelto' })
  })

  it('jugada incorrecta DEL árbol → fallo-en-arbol con refutación y comentario; estado fallado', () => {
    const s = createExerciseSession(exercise())
    const r = s.attempt({ x: 6, y: 6 })
    expect(r).toEqual({ kind: 'fallo-en-arbol', refutation: W(7, 7), comment: 'Deja vivir' })
    expect(s.state).toBe('fallado')
    // La refutación también se jugó en el tablero (se muestra el castigo).
    expect(s.tree.boardAt().get([7, 7])).toBe(-1)
  })

  it('jugada FUERA del árbol → fuera-de-arbol; estado respondiendo; la Position incluye la jugada', () => {
    const s = createExerciseSession(exercise())
    const r = s.attempt({ x: 9, y: 9 })
    expect(r).toEqual({ kind: 'fuera-de-arbol', move: B(9, 9) })
    expect(s.state).toBe('respondiendo')
    const pos = s.tree.positionAt()
    expect(pos.moves).toEqual([B(9, 9)])
    expect(pos.setup).toBeDefined()
  })

  it('jugada ilegal (punto ocupado) → ilegal; nada cambia', () => {
    const s = createExerciseSession(exercise())
    const r = s.attempt({ x: 0, y: 0 }) // sobre una blanca del setup
    expect(r).toEqual({ kind: 'ilegal', reason: 'overwrite' })
    expect(s.state).toBe('esperando')
    expect(s.tree.positionAt().moves).toEqual([])
  })

  it('attempt fuera del estado esperando lanza (bug del caller)', () => {
    const s = createExerciseSession(exercise())
    s.attempt({ x: 0, y: 1 }) // resuelto
    expect(() => s.attempt({ x: 9, y: 9 })).toThrow()
  })
})

describe('createExerciseSession — fail / reintentar / solution', () => {
  it('fail() cierra un fuera-de-arbol como fallado (lo llama la vista tras la refutación del motor)', () => {
    const s = createExerciseSession(exercise())
    s.attempt({ x: 9, y: 9 })
    s.fail()
    expect(s.state).toBe('fallado')
  })

  it('reintentar vuelve al setup limpio y una variación previa fuera-de-arbol NO contamina el árbol', () => {
    const s = createExerciseSession(exercise())
    s.attempt({ x: 9, y: 9 })
    s.fail()
    s.reintentar()
    expect(s.state).toBe('esperando')
    expect(s.tree.positionAt().moves).toEqual([])
    // El mismo vértice sigue siendo fuera-de-arbol (el intento previo no lo volvió "del árbol").
    expect(s.attempt({ x: 9, y: 9 })).toEqual({ kind: 'fuera-de-arbol', move: B(9, 9) })
  })

  it('solution() devuelve la línea principal correcta (primera rama correcta, resistencia principal)', () => {
    const s = createExerciseSession(exercise())
    expect(s.solution()).toEqual([B(0, 1)])
  })
})
