import type { Move } from '@tengen/engine'
import { describe, expect, it } from 'vitest'
import { GameTree } from '../src/game/gameTree'

// Metadata base reutilizable (sin handicap, 9×9).
function tree9(): GameTree {
  return new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0, humanColor: 'black' })
}

const B = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const W = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })

describe('GameTree — construcción', () => {
  it('la raíz no tiene jugada ni padre, y el cursor arranca en la raíz', () => {
    const t = tree9()
    expect(t.root.move).toBeNull()
    expect(t.root.parent).toBeNull()
    expect(t.current).toBe(t.root)
    expect(t.meta).toEqual({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0, humanColor: 'black' })
  })

  it('fromConfig deriva la metadata desde una GameConfig (descarta opponent)', () => {
    const t = GameTree.fromConfig({
      boardSize: 19,
      komi: 0.5,
      rules: 'japanese',
      handicap: 2,
      opponent: { kind: 'kata', visits: 100 },
      humanColor: 'black',
    })
    expect(t.meta).toEqual({ boardSize: 19, komi: 0.5, rules: 'japanese', handicap: 2, humanColor: 'black' })
  })
})

describe('GameTree — addMove', () => {
  it('extiende la línea y mueve el cursor al nodo nuevo', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    expect(t.current).toBe(n1)
    expect(n1.move).toEqual(B(2, 2))
    expect(t.root.children).toHaveLength(1)
    const n2 = t.addMove(W(6, 6))
    expect(n2.parent).toBe(n1)
    expect(t.current).toBe(n2)
  })

  it('re-jugar la misma jugada NO duplica: navega al hijo existente', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    t.toRoot()
    const again = t.addMove(B(2, 2))
    expect(again).toBe(n1)
    expect(t.root.children).toHaveLength(1)
    expect(t.current).toBe(n1)
  })

  it('jugar distinto tras retroceder crea una variación (2 hijos)', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    t.toRoot()
    const variation = t.addMove(B(6, 6))
    expect(t.root.children).toHaveLength(2)
    expect(t.current).toBe(variation)
    expect(t.root.children[1]).toBe(variation)
  })

  it('trata un pase como una jugada más (no lo confunde con otra)', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    const passNode = t.addMove({ color: 'white', vertex: 'pass' })
    expect(passNode.move).toEqual({ color: 'white', vertex: 'pass' })
    t.toParent()
    // re-jugar el pase del mismo color no duplica
    const again = t.addMove({ color: 'white', vertex: 'pass' })
    expect(again).toBe(passNode)
  })
})

describe('GameTree — navegación', () => {
  it('toParent / toChild / toRoot mueven el cursor y devuelven si hubo movimiento', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    const n2 = t.addMove(W(6, 6))
    expect(t.toParent()).toBe(true)
    expect(t.current).toBe(n1)
    expect(t.toChild()).toBe(true)
    expect(t.current).toBe(n2)
    t.toRoot()
    expect(t.current).toBe(t.root)
    expect(t.toParent()).toBe(false) // la raíz no tiene padre
    expect(t.toChild(5)).toBe(false) // índice inexistente
  })

  it('toChild(index) elige la variación por índice (default 0 = línea principal)', () => {
    const t = tree9()
    const main = t.addMove(B(2, 2))
    t.toRoot()
    const alt = t.addMove(B(6, 6))
    t.toRoot()
    expect(t.toChild()).toBe(true)
    expect(t.current).toBe(main)
    t.toRoot()
    expect(t.toChild(1)).toBe(true)
    expect(t.current).toBe(alt)
  })
})

describe('GameTree — mainLine', () => {
  it('devuelve los nodos-jugada del camino de primeros-hijos (raíz excluida)', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    const n2 = t.addMove(W(6, 6))
    t.toRoot()
    t.addMove(B(4, 4)) // variación: NO debe aparecer en la línea principal
    const line = t.mainLine()
    expect(line).toEqual([n1, n2])
  })

  it('árbol vacío → línea principal vacía', () => {
    expect(tree9().mainLine()).toEqual([])
  })
})

describe('GameTree — pathTo / nodeAtPath / navigateToPath', () => {
  it('pathTo devuelve los índices de hijo desde la raíz; nodeAtPath lo invierte', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    t.toRoot()
    const alt = t.addMove(B(6, 6)) // segundo hijo de la raíz
    const child = t.addMove(W(3, 3)) // primer hijo de alt
    expect(t.pathTo(t.root)).toEqual([])
    expect(t.pathTo(alt)).toEqual([1])
    expect(t.pathTo(child)).toEqual([1, 0])
    expect(t.nodeAtPath([1, 0])).toBe(child)
    expect(t.nodeAtPath([])).toBe(t.root)
    expect(t.nodeAtPath([9])).toBeNull() // índice inexistente
  })

  it('navigateToPath mueve el cursor y devuelve false ante un path inválido', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    const child = t.addMove(W(6, 6))
    t.toRoot()
    expect(t.navigateToPath([0, 0])).toBe(true)
    expect(t.current).toBe(child)
    expect(t.navigateToPath([0, 5])).toBe(false)
  })
})

describe('GameTree — positionAt (pieza de correctitud central)', () => {
  it('deriva la Position desde metadata + jugadas del camino, en orden', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    const cursor = t.addMove(W(6, 6))
    const pos = t.positionAt(cursor)
    expect(pos).toEqual({
      boardSize: 9,
      komi: 6.5,
      rules: 'chinese',
      handicap: 0,
      moves: [B(2, 2), W(6, 6)],
    })
  })

  it('positionAt(cursor por defecto) usa el cursor actual', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    t.addMove(W(6, 6))
    t.toParent() // cursor en la primera jugada
    expect(t.positionAt().moves).toEqual([B(2, 2)])
  })

  it('con handicap≥2, moves NO incluye piedras de handicap y arranca en Blanco', () => {
    const t = new GameTree({ boardSize: 19, komi: 0.5, rules: 'chinese', handicap: 2, humanColor: 'black' })
    t.addMove(W(15, 15)) // Blanco mueve primero con handicap
    t.addMove(B(3, 3))
    const pos = t.positionAt(t.current)
    expect(pos.handicap).toBe(2)
    expect(pos.moves).toHaveLength(2)
    expect(pos.moves[0]?.color).toBe('white')
    // ninguna jugada es una piedra de handicap
    expect(pos.moves.map((m) => m.color)).toEqual(['white', 'black'])
  })
})

describe('GameTree — helpers de display (delegan en rules)', () => {
  it('boardAt refleja el tablero en el cursor (incluye handicap)', () => {
    const t = new GameTree({ boardSize: 19, komi: 0.5, rules: 'chinese', handicap: 2, humanColor: 'black' })
    const board = t.boardAt(t.root)
    // piedras de handicap presentes (negras) sin jugadas aún
    expect(board.get([3, 15])).toBe(1)
    expect(board.get([15, 3])).toBe(1)
  })

  it('currentTurnAt: sin handicap arranca Negro; con handicap≥2 arranca Blanco', () => {
    expect(tree9().currentTurnAt(tree9().root)).toBe('black')
    const th = new GameTree({ boardSize: 19, komi: 0.5, rules: 'chinese', handicap: 2, humanColor: 'black' })
    expect(th.currentTurnAt(th.root)).toBe('white')
  })
})

describe('GameTree — isAtLiveTip (Fase 2, Task 5: guard del modo exploración)', () => {
  it('árbol vacío, cursor en la raíz → true (la raíz ES el tip vivo sin jugadas)', () => {
    expect(tree9().isAtLiveTip()).toBe(true)
  })

  it('cursor en el tip de la línea principal tras jugar → true', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    t.addMove(W(6, 6))
    expect(t.isAtLiveTip()).toBe(true)
  })

  it('retroceder (toParent) desde el tip → false, aunque el nodo no sea una hoja', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    t.addMove(W(6, 6))
    t.toParent()
    expect(t.isAtLiveTip()).toBe(false)
  })

  it('CRÍTICO: tras jugar la PRIMERA jugada de una variación (nodo nuevo, SIN hijos, por tanto ' +
    'una hoja) sigue siendo false — "hoja" no es sinónimo de "tip vivo"', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    t.addMove(W(6, 6)) // línea principal: tip real
    t.toParent() // cursor vuelve a B(2,2), que YA tiene un hijo (línea principal)
    const variationNode = t.addMove(B(4, 4)) // jugada distinta → variación (segundo hijo)
    expect(t.current).toBe(variationNode)
    expect(variationNode.children).toHaveLength(0) // es una hoja...
    expect(t.isAtLiveTip()).toBe(false) // ...pero NO es el tip vivo (la variación nunca lo es)
  })

  it('CRÍTICO: sigue siendo false tras una SEGUNDA jugada dentro de la misma variación (el bug ' +
    'real: la exploración debe seguir activa más allá de la primera jugada)', () => {
    const t = tree9()
    t.addMove(B(2, 2))
    t.addMove(W(6, 6))
    t.toParent()
    t.addMove(B(4, 4)) // 1ª jugada de la variación
    const secondVariationMove = t.addMove(W(5, 5)) // 2ª jugada de la MISMA variación
    expect(t.current).toBe(secondVariationMove)
    expect(t.isAtLiveTip()).toBe(false)
  })

  it('reencontrar la línea principal (re-jugar la misma jugada real) vuelve a dar true', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    const n2 = t.addMove(W(6, 6)) // tip real
    t.toParent() // cursor en n1 (fuera del tip)
    expect(t.isAtLiveTip()).toBe(false)
    const rejoined = t.addMove(W(6, 6)) // misma jugada que n2: addMove dedup-navega, no ramifica
    expect(rejoined).toBe(n2)
    expect(t.isAtLiveTip()).toBe(true)
  })

  it('partida con handicap: cursor en la raíz (sin jugadas aún) → true', () => {
    const th = new GameTree({ boardSize: 19, komi: 0.5, rules: 'chinese', handicap: 2, humanColor: 'black' })
    expect(th.isAtLiveTip()).toBe(true)
  })
})

describe('GameTree — removeNode (Fase 1 editor de repaso)', () => {
  it('borra una hoja: desaparece de parent.children', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    const n2 = t.addMove(W(6, 6))
    t.removeNode(n2)
    expect(n1.children).toEqual([])
  })

  it('si el cursor estaba en el nodo borrado, se reubica en el padre', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    const n2 = t.addMove(W(6, 6)) // cursor en n2
    t.removeNode(n2)
    expect(t.current).toBe(n1)
  })

  it('borra un subárbol entero y reubica el cursor al padre del nodo borrado', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2)) // primer hijo de la raíz
    t.addMove(W(6, 6)) // cursor profundo dentro del subárbol de n1
    t.removeNode(n1)
    expect(t.root.children).toEqual([]) // todo el subárbol desapareció
    expect(t.current).toBe(t.root) // cursor reubicado al padre de n1 (la raíz)
  })

  it('el cursor fuera del subárbol borrado NO se mueve', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2)) // primer hijo
    t.toRoot()
    const alt = t.addMove(B(6, 6)) // segundo hijo; cursor en alt
    t.removeNode(n1) // borra el OTRO subárbol
    expect(t.root.children).toEqual([alt])
    expect(t.current).toBe(alt) // intacto
  })

  it('la raíz está protegida: removeNode(root) es no-op', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    t.removeNode(t.root)
    expect(t.root.children).toEqual([n1]) // intacto
    expect(t.current).toBe(n1) // intacto
  })
})

describe('GameTree — promoteToMainLine (Fase 1 editor de repaso)', () => {
  it('promueve una variación de primer nivel: mainLine() pasa por ella y queda como children[0]', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2)) // línea principal original
    t.toRoot()
    const alt = t.addMove(B(6, 6)) // segundo hijo de la raíz (variación)
    t.promoteToMainLine(alt)
    expect(t.root.children).toEqual([alt, n1]) // alt al frente, n1 corrido
    expect(t.mainLine()).toEqual([alt])
  })

  it('promueve un nodo PROFUNDO: cada ancestro del camino queda con el hijo correcto en índice 0', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2)) // línea principal original
    t.toRoot()
    const alt = t.addMove(B(6, 6)) // variación (segundo hijo de la raíz)
    const altChild = t.addMove(W(3, 3)) // hijo de alt
    t.promoteToMainLine(altChild)
    expect(t.root.children[0]).toBe(alt) // ancestro 1: alt al frente
    expect(alt.children[0]).toBe(altChild) // ancestro 2: altChild al frente (ya lo estaba)
    expect(t.mainLine()).toEqual([alt, altChild]) // la línea principal ahora recorre la variación
    expect(t.root.children[1]).toBe(n1) // la vieja principal corrida atrás
  })

  it('promover un nodo que YA está en la línea principal no cambia nada', () => {
    const t = tree9()
    const n1 = t.addMove(B(2, 2))
    const n2 = t.addMove(W(6, 6))
    t.toRoot()
    t.addMove(B(6, 6)) // una variación cualquiera
    t.promoteToMainLine(n2)
    expect(t.mainLine()).toEqual([n1, n2])
    expect(t.root.children[0]).toBe(n1)
  })
})

describe('GameTree — fromConfig con reloj', () => {
  it('sin clock en la config, meta.clock queda ausente', () => {
    const t = GameTree.fromConfig({
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      opponent: { kind: 'kata', visits: 100 },
      humanColor: 'black',
    })
    expect(t.meta.clock).toBeUndefined()
  })

  it('con clock, inicializa el mismo estado para ambos colores', () => {
    const clock = { mainTimeMs: 600_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    const t = GameTree.fromConfig({
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      opponent: { kind: 'kata', visits: 100 },
      humanColor: 'black',
      clock,
    })
    expect(t.meta.clock).toEqual({
      config: clock,
      state: {
        black: { mainTimeRemainingMs: 600_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
        white: { mainTimeRemainingMs: 600_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
      },
    })
  })

  it('con mainTimeMs=0 (byoyomi desde el arranque), inicializa inByoyomi=true', () => {
    const clock = { mainTimeMs: 0, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    const t = GameTree.fromConfig({
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      opponent: { kind: 'kata', visits: 100 },
      humanColor: 'black',
      clock,
    })
    expect(t.meta.clock?.state.black.inByoyomi).toBe(true)
    expect(t.meta.clock?.state.white.inByoyomi).toBe(true)
  })
})
