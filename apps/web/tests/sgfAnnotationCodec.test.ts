import { describe, expect, it } from 'vitest'
import { GameTree, type GameNode, type Markup } from '../src/game/gameTree'
import { decodeAnnotationFromNodeData, encodeAnnotationForNode } from '../src/game/sgfAnnotationCodec'
import { exportSgf, importSgf } from '../src/game/sgf'

// ─────────────────────────────────────────────────────────────────────────────
// Codec de anotaciones (Fase 1, editor de repaso): comentario (C[]) + marcas
// (TR/SQ/CR/MA/LB) por nodo. Espeja `sgfAnalysisCodec.test.ts`. La idempotencia
// byte-idéntica se prueba por la ruta REAL de @sabaki/sgf (que es quien escapa
// ]/\ en C[]), no solo encode/decode aislados.
// ─────────────────────────────────────────────────────────────────────────────

const M = (type: Markup['type'], x: number, y: number, label?: string): Markup =>
  label !== undefined ? { type, vertex: { x, y }, label } : { type, vertex: { x, y } }

function tree9(): GameTree {
  return new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0, humanColor: 'black' })
}

/** Import que decodifica anotaciones a `node.comment`/`node.markup` — mismo cableado que usará
 *  `AnalyzeView` en el `onNodeData` de `importSgf`. */
function importWithAnnotations(text: string): GameTree {
  return importSgf(text, (node, data) => {
    const { comment, markup } = decodeAnnotationFromNodeData(data)
    if (comment !== undefined) node.comment = comment
    if (markup !== undefined) node.markup = markup
  })
}

describe('encodeAnnotationForNode — orden canónico y omisión de vacíos', () => {
  it('un nodo sin anotación → objeto vacío (no emite ninguna propiedad)', () => {
    expect(encodeAnnotationForNode({})).toEqual({})
  })

  it('emite C/TR/SQ/CR/MA/LB en ORDEN canónico fijo, sin importar el orden del array markup', () => {
    const data = encodeAnnotationForNode({
      comment: 'hola',
      markup: [M('label', 4, 4, 'A'), M('cross', 1, 1), M('triangle', 2, 2), M('square', 3, 3), M('circle', 0, 0)],
    })
    expect(Object.keys(data)).toEqual(['C', 'TR', 'SQ', 'CR', 'MA', 'LB'])
  })

  it('ordena los vértices DENTRO de cada clave (idempotencia), sin repetir la clave por marca', () => {
    const data = encodeAnnotationForNode({
      markup: [M('triangle', 6, 6), M('triangle', 2, 2), M('triangle', 4, 0)],
    })
    // {x:2,y:2}='cc', {x:4,y:0}='ea', {x:6,y:6}='gg' — ordenados lexicográficamente
    expect(data.TR).toEqual(['cc', 'ea', 'gg'])
  })

  it('LB codifica "vertice:etiqueta"', () => {
    const data = encodeAnnotationForNode({ markup: [M('label', 4, 4, 'A'), M('label', 0, 0, 'B')] })
    // {x:0,y:0}='aa', {x:4,y:4}='ee'
    expect(data.LB).toEqual(['aa:B', 'ee:A'])
  })
})

describe('encode → decode round-trip (nivel codec, sin SGF)', () => {
  it('los 5 tipos de marca round-tripean', () => {
    const markup = [M('triangle', 1, 2), M('square', 3, 4), M('circle', 5, 6), M('cross', 7, 8), M('label', 0, 1, 'A')]
    const decoded = decodeAnnotationFromNodeData(encodeAnnotationForNode({ markup }))
    // El decode no garantiza el orden del array de entrada, así que comparamos por conjunto.
    expect(decoded.markup).toHaveLength(5)
    expect(decoded.markup).toEqual(
      expect.arrayContaining([
        { type: 'triangle', vertex: { x: 1, y: 2 } },
        { type: 'square', vertex: { x: 3, y: 4 } },
        { type: 'circle', vertex: { x: 5, y: 6 } },
        { type: 'cross', vertex: { x: 7, y: 8 } },
        { type: 'label', vertex: { x: 0, y: 1 }, label: 'A' },
      ]),
    )
  })

  it('un comentario round-tripea a nivel codec', () => {
    const decoded = decodeAnnotationFromNodeData(encodeAnnotationForNode({ comment: 'buena jugada' }))
    expect(decoded.comment).toBe('buena jugada')
  })
})

describe('decodeAnnotationFromNodeData — defensivo, nunca lanza', () => {
  it('data vacía → sin comment ni markup', () => {
    expect(decodeAnnotationFromNodeData({})).toEqual({})
  })

  it('coordenada de longitud inválida en TR se ignora, las válidas se conservan', () => {
    const decoded = decodeAnnotationFromNodeData({ TR: ['cc', 'x', 'gg'] })
    expect(decoded.markup).toEqual([
      { type: 'triangle', vertex: { x: 2, y: 2 } },
      { type: 'triangle', vertex: { x: 6, y: 6 } },
    ])
  })

  it('LB sin ":" se ignora; con ":" se parte en el PRIMER ":"', () => {
    const decoded = decodeAnnotationFromNodeData({ LB: ['ee', 'aa:A:B'] })
    expect(decoded.markup).toEqual([{ type: 'label', vertex: { x: 0, y: 0 }, label: 'A:B' }])
  })

  it('un comentario vacío C[] decodifica a string vacío (presente, no ausente)', () => {
    expect(decodeAnnotationFromNodeData({ C: [''] })).toEqual({ comment: '' })
  })
})

describe('idempotencia byte-idéntica por la ruta real de @sabaki/sgf', () => {
  it('comentario con ] \\ backslash-final y newline sobrevive round-trip exacto', () => {
    const nasty = 'corchete ] backslash \\ termina en \\\ndos lineas'
    const t = tree9()
    const n1 = t.addMove({ color: 'black', vertex: { x: 2, y: 2 } })
    n1.comment = nasty

    const s1 = exportSgf(t, encodeAnnotationForNode)
    const reimported = importWithAnnotations(s1)
    // valor preservado
    expect(reimported.mainLine()[0]!.comment).toBe(nasty)
    // byte-idéntico
    const s2 = exportSgf(reimported, encodeAnnotationForNode)
    expect(s2).toBe(s1)
  })

  it('árbol con comentarios + marcas en varias ramas: exportSgf(importSgf(exportSgf(t))) byte-idéntico', () => {
    const t = tree9()
    const n1 = t.addMove({ color: 'black', vertex: { x: 3, y: 3 } })
    n1.comment = 'apertura'
    n1.markup = [M('triangle', 3, 3), M('label', 5, 5, 'A')]
    t.addMove({ color: 'white', vertex: { x: 5, y: 5 } })
    t.toRoot()
    const alt = t.addMove({ color: 'black', vertex: { x: 6, y: 6 } }) // variación
    alt.comment = 'y si acá?'
    alt.markup = [M('square', 6, 6), M('circle', 2, 2), M('cross', 1, 7)]

    const s1 = exportSgf(t, encodeAnnotationForNode)
    const s2 = exportSgf(importWithAnnotations(s1), encodeAnnotationForNode)
    expect(s2).toBe(s1)
  })

  it('marcas y comentario se RESTAURAN al reimportar (no solo bytes: los campos del nodo)', () => {
    const t = tree9()
    const n1 = t.addMove({ color: 'black', vertex: { x: 3, y: 3 } })
    n1.comment = 'apertura'
    n1.markup = [M('triangle', 3, 3), M('label', 5, 5, 'A')]

    const reimported = importWithAnnotations(exportSgf(t, encodeAnnotationForNode))
    const restored = reimported.mainLine()[0]!
    expect(restored.comment).toBe('apertura')
    expect(restored.markup).toEqual(
      expect.arrayContaining([
        { type: 'triangle', vertex: { x: 3, y: 3 } },
        { type: 'label', vertex: { x: 5, y: 5 }, label: 'A' },
      ]),
    )
  })

  it('un SGF SIN anotaciones exporta byte-idéntico con o sin el getExtraData de anotaciones (sin regresión)', () => {
    const t = tree9()
    t.addMove({ color: 'black', vertex: { x: 2, y: 2 } })
    t.addMove({ color: 'white', vertex: { x: 6, y: 6 } })
    expect(exportSgf(t, encodeAnnotationForNode)).toBe(exportSgf(t))
  })
})
