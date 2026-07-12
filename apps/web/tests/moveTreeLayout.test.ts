import { describe, expect, it } from 'vitest'
import { computeMoveTreeLayout, type MoveTreeLayoutItem } from '../src/ui/vendor/web-katrain/moveTreeLayout'

// Raíz → A (línea principal) → B; y una variación A → C. Mismos ids que produce
// `flattenGameTree` (string, ver landmine del id numérico de la raíz documentado en el plan).
const ITEMS: MoveTreeLayoutItem[] = [
  { id: '0', parentId: null, label: 'Inicio', player: null, isRoot: true, autoUndo: false },
  { id: '1', parentId: '0', label: 'Negro — A1', player: 'black', isRoot: false, autoUndo: false },
  { id: '2', parentId: '1', label: 'Blanco — B2', player: 'white', isRoot: false, autoUndo: false },
  { id: '3', parentId: '1', label: 'Blanco — C3', player: 'white', isRoot: false, autoUndo: false },
]

describe('computeMoveTreeLayout — horizontal', () => {
  it('coloca la línea principal en fila y apila la variación en una fila nueva', () => {
    const layout = computeMoveTreeLayout(ITEMS, 'horizontal')
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))

    expect(byId.get('0')).toMatchObject({ gridX: 0, gridY: 0, x: 18, y: 18 })
    expect(byId.get('1')).toMatchObject({ gridX: 1, gridY: 0, x: 40, y: 18 })
    expect(byId.get('2')).toMatchObject({ gridX: 2, gridY: 0, x: 62, y: 18 })
    expect(byId.get('3')).toMatchObject({ gridX: 2, gridY: 1, x: 62, y: 36 })
  })

  it('nunca colapsa la variación sobre la línea principal (gridY distinto)', () => {
    const layout = computeMoveTreeLayout(ITEMS, 'horizontal')
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    expect(byId.get('2')!.gridY).not.toBe(byId.get('3')!.gridY)
  })

  it('genera un edge por cada nodo no-raíz, con points en codo', () => {
    const layout = computeMoveTreeLayout(ITEMS, 'horizontal')
    expect(layout.edges).toHaveLength(3)
    const edgeTo3 = layout.edges.find((e) => e.toId === '3')
    expect(edgeTo3).toMatchObject({ fromId: '1', points: '40,18 40,36 62,36' })
  })

  it('width/height cubren el nodo más lejano en cada eje', () => {
    const layout = computeMoveTreeLayout(ITEMS, 'horizontal')
    expect(layout.width).toBe(88)
    expect(layout.height).toBe(62)
  })

  it('un item cuyo parentId no aparece antes en la lista se descarta (huérfano)', () => {
    const withOrphan: MoveTreeLayoutItem[] = [
      ...ITEMS,
      { id: '99', parentId: 'missing', label: 'huérfano', player: null, isRoot: false, autoUndo: false },
    ]
    const layout = computeMoveTreeLayout(withOrphan, 'horizontal')
    expect(layout.nodes.find((n) => n.id === '99')).toBeUndefined()
  })
})

describe('computeMoveTreeLayout — vertical', () => {
  it('invierte gridX/gridY en el cálculo de x/y', () => {
    const layout = computeMoveTreeLayout(ITEMS, 'vertical')
    const byId = new Map(layout.nodes.map((n) => [n.id, n]))
    expect(byId.get('1')).toMatchObject({ gridX: 1, gridY: 0, x: 18, y: 40 })
  })
})
