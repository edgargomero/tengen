/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/moveTreeLayout.ts. Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 *
 * ── Cambios de adaptación (árbol visual de Modo Analizar) ────────────────────────────────────────
 * 1. `import type { GameNode, Player } from '../types'` → `type Player = 'black' | 'white'` local.
 *    Este archivo no necesita `GameNode` en absoluto (solo lo usaban las dos funciones excluidas,
 *    ver abajo); `Player` se redeclara localmente en vez de importar del `types.ts` trimmed de
 *    `apps/web/src/analysis/vendor/web-katrain/` — ese directorio es de otro dominio (análisis de
 *    posición), no del árbol visual de UI.
 * 2. `computeMoveTreeLayout` y todos los tipos (`MoveTreeLayoutItem`/`Node`/`Edge`/`Layout`/
 *    `Direction`) y constantes (`NODE_RADIUS`/`X_STEP`/`Y_STEP`/`MARGIN`) se portan VERBATIM.
 *
 * ── Exclusiones deliberadas (YAGNI, mismo criterio que `branchNavigation.ts` en
 *    `playedMoveQuality.ts` de `apps/web/src/analysis/vendor/web-katrain/`) ───────────────────────
 * - `flattenMoveTree`/`moveTreeNodeLabel`: acoplados al `GameNode` de web-katrain (leen
 *   `node.gameState.board.length`, `node.properties.AB/AW/AE`, campos que el `GameNode` de tengen
 *   no tiene). Reemplazados por un adaptador nativo: `flattenGameTree`/`gameTreeNodeLabel` en
 *   `apps/web/src/ui/gameTreeGraphAdapter.ts`.
 * - `getVisibleMoveTreeItems`/`getMoveTreeMinimapTransform`/`getMoveTreeMinimapViewportRect`/
 *   `getMoveTreeMinimapKeyboardScroll`/`shouldShowMoveTreeMinimap`/`MOVE_TREE_LAYOUT_WORKER_THRESHOLD`
 *   (minimapa + culling + umbral de worker): un panel de árbol con scroll normal y árboles de a lo
 *   sumo unos pocos cientos de nodos no los necesita.
 *
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */
type Player = 'black' | 'white'

export type MoveTreeLayoutItem = {
  id: string
  parentId: string | null
  label: string
  player: Player | null
  isRoot: boolean
  autoUndo: boolean
}

export type MoveTreeLayoutNode = MoveTreeLayoutItem & {
  gridX: number
  gridY: number
  x: number
  y: number
}

export type MoveTreeLayoutEdge = {
  id: string
  fromId: string
  toId: string
  points: string
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type MoveTreeLayout = {
  nodes: MoveTreeLayoutNode[]
  edges: MoveTreeLayoutEdge[]
  width: number
  height: number
  radius: number
  xStep: number
  yStep: number
  margin: number
}

export type MoveTreeLayoutDirection = 'horizontal' | 'vertical'

const NODE_RADIUS = 6
const X_STEP = 22
const Y_STEP = 18
const MARGIN = 12

export function computeMoveTreeLayout(
  items: MoveTreeLayoutItem[],
  direction: MoveTreeLayoutDirection = 'horizontal',
): MoveTreeLayout {
  const grid = new Map<string, { x: number; y: number }>()
  const nextY = new Map<number, number>()
  const getNextY = (x: number) => nextY.get(x) ?? 0
  const nodes: MoveTreeLayoutNode[] = []
  let maxX = 0
  let maxY = 0

  for (const item of items) {
    let gridX = 0
    let gridY = 0

    if (item.parentId) {
      const parentPos = grid.get(item.parentId)
      if (!parentPos) continue
      gridX = parentPos.x + 1
      gridY = Math.max(getNextY(gridX), parentPos.y)
      nextY.set(gridX, gridY + 1)
      nextY.set(gridX - 1, Math.max(nextY.get(gridX) ?? 0, getNextY(gridX - 1)))
    }

    grid.set(item.id, { x: gridX, y: gridY })
    maxX = Math.max(maxX, gridX)
    maxY = Math.max(maxY, gridY)
    nodes.push({
      ...item,
      gridX,
      gridY,
      x: MARGIN + (direction === 'horizontal' ? gridX * X_STEP : gridY * Y_STEP) + NODE_RADIUS,
      y: MARGIN + (direction === 'horizontal' ? gridY * Y_STEP : gridX * X_STEP) + NODE_RADIUS,
    })
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges: MoveTreeLayoutEdge[] = []
  for (const node of nodes) {
    if (!node.parentId) continue
    const parent = nodeById.get(node.parentId)
    if (!parent) continue
    const minX = Math.min(parent.x, node.x)
    const maxXEdge = Math.max(parent.x, node.x)
    const minY = Math.min(parent.y, node.y)
    const maxYEdge = Math.max(parent.y, node.y)
    edges.push({
      id: `${parent.id}->${node.id}`,
      fromId: parent.id,
      toId: node.id,
      points:
        direction === 'horizontal'
          ? `${parent.x},${parent.y} ${parent.x},${node.y} ${node.x},${node.y}`
          : `${parent.x},${parent.y} ${node.x},${parent.y} ${node.x},${node.y}`,
      minX,
      maxX: maxXEdge,
      minY,
      maxY: maxYEdge,
    })
  }

  return {
    nodes,
    edges,
    width: MARGIN * 2 + (direction === 'horizontal' ? maxX * X_STEP : maxY * Y_STEP) + NODE_RADIUS * 2 + 8,
    height: MARGIN * 2 + (direction === 'horizontal' ? maxY * Y_STEP : maxX * X_STEP) + NODE_RADIUS * 2 + 8,
    radius: NODE_RADIUS,
    xStep: direction === 'horizontal' ? X_STEP : Y_STEP,
    yStep: direction === 'horizontal' ? Y_STEP : X_STEP,
    margin: MARGIN,
  }
}
