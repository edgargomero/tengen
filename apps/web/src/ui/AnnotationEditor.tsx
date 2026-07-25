// Editor de repaso de "Modo Analizar" (Fase 1): la paleta de marcas (● △ □ ○ ✕ A), el textarea de
// comentario, las ops de árbol (Borrar rama / Promover a principal / Pasar) y el comentario en modo
// lectura. Extraído de `AnalyzeView.tsx` (`ReadyAnalyzeView`) para poder testearlo sin arrastrar el
// motor (worker + ModelGate + Shudan). Presentación PURA — mismo patrón que
// `GuessMovePanel`/`GameReviewSummary`: no posee `GameTree`/`AnalysisStore`, solo recibe props ya
// calculadas por el contenedor y le devuelve eventos.
//
// Lo que se queda EN el contenedor (necesita Shudan): el clic-en-tablero → coloca piedra o marca
// según `editTool`, y el `illegalMoveHint`. Esa lógica ya está cubierta por `applyMarkToggle`
// (`markup.test.ts`) + gate manual, así que no baja a este componente.
//
// Del nodo del cursor se lee SOLO `node.comment` (edición + lectura) — así el test puede pasar un
// stub `{ comment }` en vez de construir un `GameTree` real.
import type { GameNode, MarkupType } from '../game/gameTree'
import type { StoneColor } from '@tengen/engine'

export interface AnnotationEditorProps {
  /** Nodo del cursor. Se lee únicamente `node.comment`. */
  node: GameNode
  /** true = editor abierto (paleta + comentario + ops); false = solo el comentario en modo lectura. */
  editing: boolean
  /** Sub-modo activo del editor: 'stone' juega piedra, un `MarkupType` coloca esa marca. */
  editTool: 'stone' | MarkupType
  /** Color al que le toca jugar en el cursor — para la línea "Modo edición: le toca a …". */
  turn: StoneColor
  /** true si el cursor está en la raíz: deshabilita "Borrar rama"/"Promover a principal" (no-op ahí). */
  atRoot: boolean
  /** Motor aún inicializando: deshabilita el toggle "Editar" (mismo criterio que "Analizar esta posición"). */
  booting: boolean
  onToggleEdit(): void
  onSelectTool(tool: 'stone' | MarkupType): void
  onCommentInput(value: string): void
  /** Se dispara en el blur/change del textarea — el contenedor lo usa para persistir a la nube (evita
   *  serializar el árbol entero en cada tecla; el `onCommentInput` en vivo es barato). */
  onCommentBlur(): void
  onDeleteBranch(): void
  onPromote(): void
  onPass(): void
}

/** Paleta del editor: 'stone' (jugar piedra) + los 5 `MarkupType`. Mismo orden/símbolos que la
 *  versión inline previa a la extracción. */
const TOOLS: { tool: 'stone' | MarkupType; label: string; title: string }[] = [
  { tool: 'stone', label: '● Piedra', title: 'Jugar piedra' },
  { tool: 'triangle', label: '△', title: 'Triángulo' },
  { tool: 'square', label: '□', title: 'Cuadrado' },
  { tool: 'circle', label: '○', title: 'Círculo' },
  { tool: 'cross', label: '✕', title: 'Cruz' },
  { tool: 'label', label: 'A', title: 'Etiqueta (A, B, C…)' },
]

export function AnnotationEditor({
  node,
  editing,
  editTool,
  turn,
  atRoot,
  booting,
  onToggleEdit,
  onSelectTool,
  onCommentInput,
  onCommentBlur,
  onDeleteBranch,
  onPromote,
  onPass,
}: AnnotationEditorProps) {
  return (
    <>
      <button type="button" onClick={onToggleEdit} disabled={booting}>
        {editing ? 'Dejar de editar' : 'Editar'}
      </button>
      {editing && (
        <div class="analyze-edit">
          <p class="analyze-editing">Modo edición: le toca a {turn === 'black' ? 'Negro' : 'Blanco'}</p>
          <div class="analyze-tools">
            {TOOLS.map((t) => (
              <button
                key={t.tool}
                type="button"
                class={editTool === t.tool ? 'active' : ''}
                onClick={() => onSelectTool(t.tool)}
                title={t.title}
              >
                {t.label}
              </button>
            ))}
          </div>
          <textarea
            class="analyze-comment-edit"
            value={node.comment ?? ''}
            placeholder="Comentario de esta jugada…"
            onInput={(e) => onCommentInput((e.currentTarget as HTMLTextAreaElement).value)}
            onChange={onCommentBlur}
          />
          <div class="analyze-tree-ops">
            <button type="button" onClick={onDeleteBranch} disabled={atRoot}>
              Borrar rama
            </button>
            <button type="button" onClick={onPromote} disabled={atRoot}>
              Promover a principal
            </button>
            <button type="button" onClick={onPass}>
              Pasar
            </button>
          </div>
        </div>
      )}
      {!editing && node.comment && <p class="analyze-comment">{node.comment}</p>}
    </>
  )
}
