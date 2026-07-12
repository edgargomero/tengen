/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/moveTreeKeyboard.ts. Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 *
 * ── Cambios de adaptación ──────────────────────────────────────────────────────────────────────
 * Ninguno de lógica: `MoveTreeKeyboardNode<T> = {parent?: T | null; children: T[]}` es genérico y el
 * `GameNode` real de tengen (`apps/web/src/game/gameTree.ts:31-36`) ya lo satisface
 * estructuralmente sin adaptar un solo campo. Único cambio: un `!` en `mainLineLeaf` (línea marcada
 * abajo), exigido por `noUncheckedIndexedAccess` (tengen lo activa, upstream no) — la propia
 * condición del `while` ya garantiza que el acceso no es `undefined`.
 *
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */
import type { MoveTreeLayoutDirection } from './moveTreeLayout'

export type MoveTreeKeyboardNavigationKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End'

export type MoveTreeKeyboardNode<T> = {
  parent?: T | null
  children: T[]
}

export function isMoveTreeKeyboardNavigationKey(key: string): key is MoveTreeKeyboardNavigationKey {
  return (
    key === 'ArrowLeft' ||
    key === 'ArrowRight' ||
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'Home' ||
    key === 'End'
  )
}

function sibling<T extends MoveTreeKeyboardNode<T>>(node: T, offset: -1 | 1): T | null {
  const siblings = node.parent?.children
  if (!siblings) return null
  const index = siblings.indexOf(node)
  if (index < 0) return null
  return siblings[index + offset] ?? null
}

function mainLineLeaf<T extends MoveTreeKeyboardNode<T>>(node: T): T | null {
  let current = node
  let moved = false
  while (current.children[0]) {
    current = current.children[0]! // noUncheckedIndexedAccess: ya probado truthy por el `while`
    moved = true
  }
  return moved ? current : null
}

export function getMoveTreeKeyboardTarget<T extends MoveTreeKeyboardNode<T>>(args: {
  node: T
  root: T
  direction: MoveTreeLayoutDirection
  key: MoveTreeKeyboardNavigationKey
}): T | null {
  const { node, root, direction, key } = args
  if (key === 'Home') return node === root ? null : root
  if (key === 'End') return mainLineLeaf(node)

  const parent = node.parent ?? null
  const child = node.children[0] ?? null
  const previousSibling = sibling(node, -1)
  const nextSibling = sibling(node, 1)

  if (direction === 'vertical') {
    if (key === 'ArrowUp') return parent
    if (key === 'ArrowDown') return child
    if (key === 'ArrowLeft') return previousSibling
    if (key === 'ArrowRight') return nextSibling
    return null
  }

  if (key === 'ArrowLeft') return parent
  if (key === 'ArrowRight') return child
  if (key === 'ArrowUp') return previousSibling
  if (key === 'ArrowDown') return nextSibling
  return null
}
