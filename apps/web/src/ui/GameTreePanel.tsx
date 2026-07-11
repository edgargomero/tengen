// Panel de árbol de jugadas con variaciones (Fase 2, Task 5). Componente enfocado: SOLO lee `tree`
// y renderiza; el estado del árbol (cursor, mutaciones) vive en `PlayView`, que le pasa `onNavigate`
// para reaccionar a un clic navegando el cursor y forzando el repintado (`bump`).
//
// Recorrido: mientras un nodo tenga EXACTAMENTE un hijo, la cadena se pinta como una sola fila de
// jugadas numeradas (así una partida sin variaciones se ve como una lista simple). En el primer nodo
// con MÁS de un hijo (punto de ramificación), cada hijo abre su propia sub-línea indentada — eso es
// la variación. El nodo que corresponde al cursor actual (`tree.current`) queda resaltado.
import type { BoardSize, Vertex } from '@tengen/engine'
import type { GameNode, GameTree } from '../game/gameTree'

interface GameTreePanelProps {
  tree: GameTree
  onNavigate(node: GameNode): void
  /** Deshabilita todos los nodos (p.ej. mientras la IA piensa), igual que los botones de
   * navegación de `PlayView`; `onNavigate` ya no-opea con `busy`, esto es solo el reflejo visual. */
  disabled?: boolean
}

/** Letras GTP (sin "I", convención de Go) para la columna de un vértice. */
const GTP_COLUMNS = 'ABCDEFGHJKLMNOPQRST'

/** Coordenada legible tipo GTP: columna por letra, fila numerada desde ABAJO (1 = fila y=boardSize-1). */
function vertexLabel(vertex: Vertex, boardSize: BoardSize): string {
  if (vertex === 'pass') return 'pasa'
  const col = GTP_COLUMNS.charAt(vertex.x) || '?'
  const row = boardSize - vertex.y
  return `${col}${row}`
}

/** Etiqueta de un nodo-jugada: ●/○ (Negro/Blanco) + coordenada. La raíz se etiqueta "Inicio". */
function moveLabel(node: GameNode, boardSize: BoardSize): string {
  if (!node.move) return 'Inicio'
  const stone = node.move.color === 'black' ? '●' : '○'
  return `${stone} ${vertexLabel(node.move.vertex, boardSize)}`
}

function moveTitle(node: GameNode, boardSize: BoardSize): string | undefined {
  if (!node.move) return undefined
  const color = node.move.color === 'black' ? 'Negro' : 'Blanco'
  return `${color} — ${vertexLabel(node.move.vertex, boardSize)}`
}

/** Recorre en línea recta mientras cada nodo tenga EXACTAMENTE un hijo. Devuelve la cadena completa
 * (incluye `node`); el último elemento es una hoja o un punto de ramificación (>1 hijo). */
function straightLine(node: GameNode): GameNode[] {
  const line: GameNode[] = [node]
  let n = node
  while (n.children.length === 1) {
    const next = n.children[0]
    if (!next) break
    n = next
    line.push(n)
  }
  return line
}

interface BranchProps {
  node: GameNode
  moveNumber: number
  boardSize: BoardSize
  currentId: number
  disabled: boolean
  onNavigate(node: GameNode): void
}

function Branch({ node, moveNumber, boardSize, currentId, disabled, onNavigate }: BranchProps) {
  const line = straightLine(node)
  const tail = line[line.length - 1] ?? node
  return (
    <div class="tree-branch">
      <div class="tree-line">
        {line.map((n, i) => (
          <button
            key={n.id}
            type="button"
            class={`tree-node${n.id === currentId ? ' tree-node-current' : ''}`}
            title={moveTitle(n, boardSize)}
            disabled={disabled}
            onClick={() => onNavigate(n)}
          >
            {moveNumber + i}. {moveLabel(n, boardSize)}
          </button>
        ))}
      </div>
      {tail.children.length > 1 && (
        <div class="tree-variations">
          {tail.children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              moveNumber={moveNumber + line.length}
              boardSize={boardSize}
              currentId={currentId}
              disabled={disabled}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function GameTreePanel({ tree, onNavigate, disabled = false }: GameTreePanelProps) {
  const { root, meta, current } = tree
  return (
    <div class="tree-panel">
      <button
        type="button"
        class={`tree-node${current.id === root.id ? ' tree-node-current' : ''}`}
        disabled={disabled}
        onClick={() => onNavigate(root)}
      >
        Inicio
      </button>
      {root.children.length > 0 ? (
        <div class="tree-variations">
          {root.children.map((child) => (
            <Branch
              key={child.id}
              node={child}
              moveNumber={1}
              boardSize={meta.boardSize}
              currentId={current.id}
              disabled={disabled}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : (
        <p class="tree-empty">Sin jugadas todavía.</p>
      )}
    </div>
  )
}
