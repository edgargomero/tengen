// Árbol de jugadas como grafo SVG (tipo Sabaki/Lizzie/KaTrain), solo para Modo Analizar. Misma
// interfaz de props que `GameTreePanel.tsx` (drop-in) — a diferencia de ese panel (lista de botones
// por línea recta + indentación por variación), acá cada nodo es un círculo posicionado por
// `computeMoveTreeLayout` (vendor/web-katrain, MIT) y las variaciones se ven como ramas separadas
// del grafo, no como listas anidadas.
//
// Reglas de implementación (evitan dos bugs silenciosos ya identificados en el diseño):
//   - SIN `useMemo` sobre `[tree]` para el layout: `GameTree` es mutable-con-cursor (`addMove` no
//     cambia la referencia), así que memoizar por `tree` congelaría el árbol tras la primera
//     variación jugada en el editor (Task 1 de este plan). Recalcular `flattenGameTree` +
//     `computeMoveTreeLayout` en cada render es O(n) sobre unos cientos de nodos como máximo —
//     trivial.
//   - `direction: 'horizontal'` fijo — es lo que da el aspecto "grafo de commits" pedido.
import { useEffect, useRef } from 'preact/hooks'
import type { GameNode, GameTree } from '../game/gameTree'
import { flattenGameTree } from './gameTreeGraphAdapter'
import { getMoveTreeKeyboardTarget, isMoveTreeKeyboardNavigationKey } from './vendor/web-katrain/moveTreeKeyboard'
import { computeMoveTreeLayout } from './vendor/web-katrain/moveTreeLayout'

interface GameTreeGraphProps {
  tree: GameTree
  onNavigate(node: GameNode): void
  /** Deshabilita clicks/teclado (p.ej. mientras la IA piensa) — mismo rol que en `GameTreePanel`. */
  disabled?: boolean
  /** Anotación opcional por nodo (p.ej. "esta posición tiene análisis cacheado"); solo se usa su
   * presencia (`!== undefined`), el contenido del string se ignora acá (canal visual: stroke). */
  annotationFor?(node: GameNode): string | undefined
}

/** `GameNode.id` (number) → `GameNode`, para resolver el nodo real detrás de cada `MoveTreeLayoutNode`
 * (que solo lleva `id: string`, ver `flattenGameTree`). Recorrido propio (no reusa el de
 * `flattenGameTree`: ese produce el array plano para el layout, este necesita los nodos en sí). */
function collectNodesById(tree: GameTree): Map<string, GameNode> {
  const byId = new Map<string, GameNode>()
  const stack: GameNode[] = [tree.root]
  while (stack.length > 0) {
    const node = stack.pop()!
    byId.set(String(node.id), node)
    for (const child of node.children) stack.push(child)
  }
  return byId
}

function nodeColorClass(player: 'black' | 'white' | null): string {
  if (player === 'black') return 'tree-graph-node-black'
  if (player === 'white') return 'tree-graph-node-white'
  return 'tree-graph-node-root'
}

export function GameTreeGraph({ tree, onNavigate, disabled = false, annotationFor }: GameTreeGraphProps) {
  const layout = computeMoveTreeLayout(flattenGameTree(tree), 'horizontal')
  const nodesById = collectNodesById(tree)
  const currentId = String(tree.current.id)

  const svgRef = useRef<SVGSVGElement | null>(null)
  // Cada `onNavigate` fuerza un re-render que reemplaza los nodos DOM del SVG (no hay keys estables
  // de elemento a través de renders distintos para el foco nativo) — sin esto, navegar con teclado
  // perdería el foco tras el primer paso.
  useEffect(() => {
    const el = svgRef.current?.querySelector<SVGElement>(`[data-node-id="${currentId}"]`)
    el?.focus()
  }, [currentId])

  function handleNodeClick(node: GameNode): void {
    if (disabled) return
    onNavigate(node)
  }

  function handleNodeKeyDown(evt: KeyboardEvent, node: GameNode): void {
    if (disabled) return
    if (!isMoveTreeKeyboardNavigationKey(evt.key)) return
    evt.preventDefault()
    const target = getMoveTreeKeyboardTarget({ node, root: tree.root, direction: 'horizontal', key: evt.key })
    if (target) onNavigate(target)
  }

  return (
    <div class={`tree-graph-container${disabled ? ' tree-graph-disabled' : ''}`}>
      <svg
        ref={svgRef}
        width={layout.width}
        height={layout.height}
        role="tree"
        aria-label="Árbol de jugadas"
        class="tree-graph-svg"
      >
        {layout.edges.map((edge) => (
          <polyline key={edge.id} points={edge.points} class="tree-graph-edge" fill="none" />
        ))}
        {layout.nodes.map((layoutNode) => {
          const node = nodesById.get(layoutNode.id)
          if (!node) return null
          const isCurrent = layoutNode.id === currentId
          const annotated = annotationFor?.(node) !== undefined
          return (
            <g key={layoutNode.id}>
              {isCurrent && (
                <circle
                  cx={layoutNode.x}
                  cy={layoutNode.y}
                  r={layout.radius + 3}
                  class="tree-graph-node-halo"
                  fill="none"
                />
              )}
              <circle
                cx={layoutNode.x}
                cy={layoutNode.y}
                r={layout.radius}
                class={`tree-graph-node ${nodeColorClass(layoutNode.player)}${annotated ? ' tree-graph-node-annotated' : ''}`}
                data-node-id={layoutNode.id}
                role="treeitem"
                aria-label={layoutNode.label}
                aria-selected={isCurrent}
                // OJO: `tabIndex` (camelCase) en un elemento SVG lo escribe Preact como atributo
                // LITERAL "tabIndex" — los atributos SVG son case-sensitive y el navegador solo
                // reconoce "tabindex" (minúscula) para el foco, así que el nodo quedaba
                // silenciosamente no-enfocable (verificado en Chrome real, no lo detecta tsc/tests).
                // `tabindex` (minúscula) es el fix documentado para este quirk de Preact + SVG.
                tabindex={isCurrent ? 0 : -1}
                onClick={() => handleNodeClick(node)}
                onKeyDown={(evt) => handleNodeKeyDown(evt, node)}
              >
                <title>{layoutNode.label}</title>
              </circle>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
