// Adaptador nativo entre el `GameTree` de tengen y el layout portado de web-katrain
// (`vendor/web-katrain/moveTreeLayout.ts`, MIT). Reemplaza `flattenMoveTree`/`moveTreeNodeLabel` del
// vendor (excluidos, ver cabecera de ese archivo): esas dos funciones leen campos del `GameNode` de
// web-katrain (`gameState.board`, `properties.AB/AW/AE`) que el `GameNode` de tengen no tiene.
import type { BoardSize, Vertex } from '@tengen/engine'
import type { GameNode, GameTree } from '../game/gameTree'
import type { MoveTreeLayoutItem } from './vendor/web-katrain/moveTreeLayout'

/** Letras GTP (sin "I", convención de Go) — MISMA tabla que la función privada `vertexLabel` de
 * `GameTreePanel.tsx` y `formatVertexLabel` de `AnalyzeView.tsx`. Duplicado a propósito (esos
 * archivos no la exportan, mismo criterio ya aceptado para `VERTEX_SIZE`/`errorMessage`): si el
 * formato GTP cambia, actualizar los 3 sitios. */
const GTP_COLUMNS = 'ABCDEFGHJKLMNOPQRST'

function vertexLabel(vertex: Vertex, boardSize: BoardSize): string {
  if (vertex === 'pass') return 'pasa'
  const col = GTP_COLUMNS.charAt(vertex.x) || '?'
  const row = boardSize - vertex.y
  return `${col}${row}`
}

/** Etiqueta completa de un nodo, para el `<title>`/`aria-label` del árbol visual — a diferencia de
 * `GameTreePanel.tsx` (botones con texto ●/○ + coordenada visibles), los nodos del árbol SVG son
 * demasiado chicos (`NODE_RADIUS=6`) para texto legible dentro del círculo. */
export function gameTreeNodeLabel(node: GameNode, boardSize: BoardSize): string {
  if (!node.move) return 'Inicio'
  const color = node.move.color === 'black' ? 'Negro' : 'Blanco'
  return `${color} — ${vertexLabel(node.move.vertex, boardSize)}`
}

/**
 * Aplana el árbol a la forma que espera `computeMoveTreeLayout` (recorrido DFS pre-order idéntico a
 * `flattenMoveTree` del vendor, vía pila con hijos empujados en orden inverso).
 *
 * `id`/`parentId` se emiten como STRING, nunca `number` — landmine verificado con test dedicado en
 * `gameTreeGraphAdapter.test.ts`: `computeMoveTreeLayout` gatea con `if (item.parentId)`, y la raíz
 * de tengen tiene `id=0` (falsy en JS). Con `parentId` numérico, el hijo directo de la raíz
 * (`parentId: 0`) se leería como "sin padre" y colapsaría en `gridX=0`, encima de la raíz. Con
 * `parentId: "0"` (string) es truthy y el layout posiciona la línea principal correctamente.
 */
export function flattenGameTree(tree: GameTree): MoveTreeLayoutItem[] {
  const items: MoveTreeLayoutItem[] = []
  const stack: GameNode[] = [tree.root]
  while (stack.length > 0) {
    const node = stack.pop()!
    items.push({
      id: String(node.id),
      parentId: node.parent ? String(node.parent.id) : null,
      label: gameTreeNodeLabel(node, tree.meta.boardSize),
      player: node.move?.color ?? null,
      isRoot: node.parent === null,
      autoUndo: false,
    })
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!)
  }
  return items
}
