import { describe, expect, it } from 'vitest'
import {
  getMoveTreeKeyboardTarget,
  isMoveTreeKeyboardNavigationKey,
  type MoveTreeKeyboardNode,
} from '../src/ui/vendor/web-katrain/moveTreeKeyboard'

interface FakeNode extends MoveTreeKeyboardNode<FakeNode> {
  id: string
}

// root → A → B ; A → C (variación, B/C hermanos bajo A). Misma forma que `GameNode` de tengen
// (`{parent, children}`), que satisface `MoveTreeKeyboardNode<T>` estructuralmente sin adaptar nada.
function buildTree(): { root: FakeNode; a: FakeNode; b: FakeNode; c: FakeNode } {
  const root: FakeNode = { id: 'root', parent: null, children: [] }
  const a: FakeNode = { id: 'A', parent: root, children: [] }
  root.children = [a]
  const b: FakeNode = { id: 'B', parent: a, children: [] }
  const c: FakeNode = { id: 'C', parent: a, children: [] }
  a.children = [b, c]
  return { root, a, b, c }
}

describe('isMoveTreeKeyboardNavigationKey', () => {
  it('acepta las 6 teclas de navegación', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(isMoveTreeKeyboardNavigationKey(key)).toBe(true)
    }
  })

  it('rechaza cualquier otra tecla', () => {
    expect(isMoveTreeKeyboardNavigationKey('Enter')).toBe(false)
    expect(isMoveTreeKeyboardNavigationKey('a')).toBe(false)
  })
})

describe('getMoveTreeKeyboardTarget — horizontal (única dirección que usa tengen)', () => {
  it('ArrowLeft va al padre', () => {
    const { root, a, b } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: b, root, direction: 'horizontal', key: 'ArrowLeft' })).toBe(a)
  })

  it('ArrowRight va al primer hijo (línea principal)', () => {
    const { root, a, b } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: a, root, direction: 'horizontal', key: 'ArrowRight' })).toBe(b)
  })

  it('ArrowRight en una hoja no mueve (null)', () => {
    const { root, b } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: b, root, direction: 'horizontal', key: 'ArrowRight' })).toBeNull()
  })

  it('ArrowDown va al hermano siguiente (la variación)', () => {
    const { root, b, c } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: b, root, direction: 'horizontal', key: 'ArrowDown' })).toBe(c)
  })

  it('ArrowUp va al hermano anterior', () => {
    const { root, b, c } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: c, root, direction: 'horizontal', key: 'ArrowUp' })).toBe(b)
  })

  it('ArrowUp/ArrowDown en la raíz (sin hermanos) da null', () => {
    const { root } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: root, root, direction: 'horizontal', key: 'ArrowUp' })).toBeNull()
    expect(getMoveTreeKeyboardTarget({ node: root, root, direction: 'horizontal', key: 'ArrowDown' })).toBeNull()
  })

  it('ArrowLeft en la raíz da null (sin padre)', () => {
    const { root } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: root, root, direction: 'horizontal', key: 'ArrowLeft' })).toBeNull()
  })

  it('Home vuelve a la raíz, salvo que ya esté en ella (null)', () => {
    const { root, c } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: c, root, direction: 'horizontal', key: 'Home' })).toBe(root)
    expect(getMoveTreeKeyboardTarget({ node: root, root, direction: 'horizontal', key: 'Home' })).toBeNull()
  })

  it('End va a la hoja de la línea principal (children[0] en cada paso), nunca a una variación', () => {
    const { root, b } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: root, root, direction: 'horizontal', key: 'End' })).toBe(b)
  })

  it('End en la propia hoja de la línea principal da null (no se movió)', () => {
    const { root, b } = buildTree()
    expect(getMoveTreeKeyboardTarget({ node: b, root, direction: 'horizontal', key: 'End' })).toBeNull()
  })
})
