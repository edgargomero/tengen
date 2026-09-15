import { describe, it, expect } from 'vitest'
import { checkObjective } from '../src/learn/objectiveCheck'
import type { Exercise } from '../src/learn/exercise'

describe('checkObjective', () => {
  it('matar: captura de una cadena de 2 piedras -- (4,5) es la única correcta', () => {
    const ex: Exercise = {
      id: 'b1-l1-02', collection: 'bloque-1-leccion-1', boardSize: 9,
      setup: {
        black: [{ x: 3, y: 4 }, { x: 4, y: 4 }],
        white: [{ x: 2, y: 4 }, { x: 4, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 5 }, { x: 5, y: 4 }],
      },
      toPlay: 'white', objective: 'matar',
      tree: { children: [{ move: { color: 'white', vertex: { x: 4, y: 5 } }, correct: true, children: [] }] },
    }
    const result = checkObjective(ex)
    expect(result.wrongCorrect).toEqual([])
    expect(result.unmarkedAlternatives).toEqual([])
  })

  it('matar: detecta un `correct` que NO captura nada (posición mal armada)', () => {
    const ex: Exercise = {
      id: 'broken', collection: 'test', boardSize: 9,
      setup: { black: [{ x: 3, y: 4 }, { x: 4, y: 4 }], white: [{ x: 2, y: 4 }] },
      toPlay: 'white', objective: 'matar',
      // (0,0) no toca la cadena negra: no puede capturar nada.
      tree: { children: [{ move: { color: 'white', vertex: { x: 0, y: 0 } }, correct: true, children: [] }] },
    }
    expect(checkObjective(ex).wrongCorrect).toEqual([{ x: 0, y: 0 }])
  })

  it('vivir: salvar una cadena blanca de 2 piedras en atari -- (4,5) es la única salida', () => {
    const ex: Exercise = {
      id: 'b1-l1-04', collection: 'bloque-1-leccion-1', boardSize: 9,
      setup: {
        white: [{ x: 3, y: 4 }, { x: 4, y: 4 }],
        black: [{ x: 2, y: 4 }, { x: 5, y: 4 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 5 }],
      },
      toPlay: 'white', objective: 'vivir',
      tree: { children: [{ move: { color: 'white', vertex: { x: 4, y: 5 } }, correct: true, children: [] }] },
    }
    const result = checkObjective(ex)
    expect(result.wrongCorrect).toEqual([])
    expect(result.unmarkedAlternatives).toEqual([])
  })
})
