import type { Move } from '@tengen/engine'
import { describe, expect, it } from 'vitest'
import { GameTree } from '../src/game/gameTree'
import { computeMoveTreeLayout } from '../src/ui/vendor/web-katrain/moveTreeLayout'
import { flattenGameTree, gameTreeNodeLabel } from '../src/ui/gameTreeGraphAdapter'

function tree9(): GameTree {
  return new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
}

const blackMove = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const whiteMove = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })

describe('flattenGameTree', () => {
  it('emite id/parentId como string, nunca number', () => {
    const t = tree9()
    t.addMove(blackMove(2, 2))
    for (const item of flattenGameTree(t)) {
      expect(typeof item.id).toBe('string')
      expect(item.parentId === null || typeof item.parentId === 'string').toBe(true)
    }
  })

  it('la raíz es isRoot con parentId null', () => {
    const t = tree9()
    const [rootItem] = flattenGameTree(t)
    expect(rootItem).toMatchObject({ id: '0', parentId: null, isRoot: true, player: null })
  })

  // Test anti-regresión del landmine documentado en el plan: la raíz de tengen tiene id NUMÉRICO 0,
  // que es falsy en JS. Si `flattenGameTree` alguna vez regresara a emitir parentId como number en
  // vez de string, `computeMoveTreeLayout` (gatea con `if (item.parentId)`) trataría al hijo directo
  // de la raíz como si no tuviera padre, y todo colapsaría en gridX=0 sobre la raíz.
  it('el hijo directo de la raíz (parentId=0) no colapsa en gridX=0, y una variación se apila sin pisar la línea principal', () => {
    const t = tree9()
    const a = t.addMove(blackMove(2, 2)) // id=1, hijo directo de la raíz (id=0)
    const b = t.addMove(whiteMove(6, 6)) // id=2, línea principal
    t.toParent() // cursor: b → a (API pública de navegación, no reasignar `current` a mano)
    const c = t.addMove(blackMove(4, 4)) // id=3, variación (vértice distinto de b)

    const layout = computeMoveTreeLayout(flattenGameTree(t), 'horizontal')
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))

    expect(byId.get(String(a.id))!.gridX).toBe(1) // NUNCA 0 — ese es el bug que este test caza
    expect(byId.get(String(b.id))!.gridX).toBe(2)
    expect(byId.get(String(c.id))!.gridX).toBe(2)
    expect(byId.get(String(b.id))!.gridY).not.toBe(byId.get(String(c.id))!.gridY) // rama apilada, no colapsada
  })
})

describe('gameTreeNodeLabel', () => {
  it('la raíz se etiqueta "Inicio"', () => {
    const t = tree9()
    expect(gameTreeNodeLabel(t.root, t.meta.boardSize)).toBe('Inicio')
  })

  it('un nodo de Negro se etiqueta "Negro — {coordenada GTP}"', () => {
    const t = tree9()
    const n = t.addMove(blackMove(2, 2))
    expect(gameTreeNodeLabel(n, t.meta.boardSize)).toBe('Negro — C7')
  })

  it('un nodo de Blanco se etiqueta "Blanco — {coordenada GTP}" (columna salta la "I")', () => {
    const t = tree9()
    t.addMove(blackMove(0, 0))
    const n = t.addMove(whiteMove(8, 8))
    expect(gameTreeNodeLabel(n, t.meta.boardSize)).toBe('Blanco — J1')
  })

  it('un pase se etiqueta "{Color} — pasa"', () => {
    const t = tree9()
    const n = t.addMove({ color: 'black', vertex: 'pass' })
    expect(gameTreeNodeLabel(n, t.meta.boardSize)).toBe('Negro — pasa')
  })
})
