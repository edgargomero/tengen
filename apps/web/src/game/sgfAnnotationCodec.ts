// Convierte las anotaciones autoradas de un nodo (comentario + marcas) a/desde propiedades SGF
// estándar FF[4] — puente entre `game/sgf.ts` (dominio puro, no sabe qué es una "anotación") y el
// editor de repaso (Fase 1, spec 2026-07-23-editor-repaso-design.md). Espeja `analysis/sgfAnalysisCodec.ts`
// pero vive en `game/` porque comentario/marcas son datos de DOMINIO (viven en el `GameNode`), no
// análisis regenerable. Reusa la codificación de vértices de 2 letras de `vertexToSgf`/`sgfToVertex`.
//
// El comentario se guarda CRUDO en `C[]`: @sabaki/sgf escapa `]`/`\` de forma idempotente al
// serializar y los des-escapa al parsear (verificado empíricamente, ver spec §Correcciones) — NO se
// escapa a mano acá. Las marcas mapean 1:1 a las propiedades estándar de tablero:
//   triangle→TR · square→SQ · circle→CR · cross→MA · label→LB (`vertice:etiqueta`).
import type { GameNode, Markup, MarkupType } from './gameTree'
import { sgfToVertex, vertexToSgf } from './sgf'

/** Marca → propiedad SGF. `Record<MarkupType,…>` es total sobre la unión (indexar nunca da undefined). */
const TYPE_TO_PROP: Record<MarkupType, string> = {
  triangle: 'TR',
  square: 'SQ',
  circle: 'CR',
  cross: 'MA',
  label: 'LB',
}

/** Orden canónico de emisión de las propiedades de MARCA (idempotencia). El comentario `C` va SIEMPRE
 *  primero (antes que estas); ver `encodeAnnotationForNode`. */
const MARKUP_PROP_ORDER = ['TR', 'SQ', 'CR', 'MA', 'LB'] as const

/** Propiedad SGF → tipo de marca, en el mismo orden canónico (para un decode determinista). */
const PROP_TO_TYPE: readonly [string, MarkupType][] = [
  ['TR', 'triangle'],
  ['SQ', 'square'],
  ['CR', 'circle'],
  ['MA', 'cross'],
  ['LB', 'label'],
]

/**
 * Arma las propiedades SGF de anotación de un nodo. Orden canónico FIJO `C → TR → SQ → CR → MA → LB`,
 * con los vértices ORDENADOS dentro de cada clave — así dos nodos con las mismas marcas emiten bytes
 * idénticos sin importar el orden en que se colocaron. Omite toda clave vacía (un nodo sin anotación
 * → `{}`, no escribe nada → SGF byte-idéntico al de hoy).
 */
export function encodeAnnotationForNode(node: Pick<GameNode, 'comment' | 'markup'>): Record<string, string[]> {
  const data: Record<string, string[]> = {}
  if (node.comment !== undefined && node.comment !== '') data.C = [node.comment]

  // Agrupa las marcas por propiedad SGF; un tipo puede tener varias casillas.
  const byProp: Record<string, string[]> = {}
  for (const m of node.markup ?? []) {
    const prop = TYPE_TO_PROP[m.type]
    const value = m.type === 'label' ? `${vertexToSgf(m.vertex)}:${m.label ?? ''}` : vertexToSgf(m.vertex)
    const bucket = byProp[prop] ?? []
    bucket.push(value)
    byProp[prop] = bucket
  }
  for (const prop of MARKUP_PROP_ORDER) {
    const values = byProp[prop]
    if (values && values.length > 0) data[prop] = values.slice().sort()
  }
  return data
}

/** Decodifica UN valor de marca. `null` si está malformado (coordenada de longitud ≠ 2, o `LB` sin `:`)
 *  — defensivo, nunca lanza (mismo criterio que `moveFromData`/`decodeAnalysisFromNodeData`). */
function decodeMarkupValue(type: MarkupType, raw: string): Markup | null {
  if (type === 'label') {
    const idx = raw.indexOf(':')
    if (idx < 0) return null
    const coord = raw.slice(0, idx)
    if (coord.length !== 2) return null
    return { type, vertex: sgfToVertex(coord), label: raw.slice(idx + 1) }
  }
  if (raw.length !== 2) return null
  return { type, vertex: sgfToVertex(raw) }
}

/**
 * Reconstruye `{ comment?, markup? }` desde las propiedades leídas de un nodo SGF. Inverso de
 * `encodeAnnotationForNode`; NUNCA lanza. `comment` presente si hay `C` (incluso vacío). `markup`
 * presente solo si hubo al menos una marca válida; los valores malformados se ignoran en silencio.
 */
export function decodeAnnotationFromNodeData(data: Record<string, string[]>): { comment?: string; markup?: Markup[] } {
  const result: { comment?: string; markup?: Markup[] } = {}

  const comment = data.C?.[0]
  if (comment !== undefined) result.comment = comment

  const markup: Markup[] = []
  for (const [prop, type] of PROP_TO_TYPE) {
    const values = data[prop]
    if (!values) continue
    for (const raw of values) {
      const m = decodeMarkupValue(type, raw)
      if (m) markup.push(m)
    }
  }
  if (markup.length > 0) result.markup = markup

  return result
}
