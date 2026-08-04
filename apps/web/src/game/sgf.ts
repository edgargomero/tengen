// Export/import SGF del árbol de jugadas (Fase 2), sobre `@sabaki/sgf` (parse/stringify). Puro, Node.
//
// Import por defecto (`import sgf from '@sabaki/sgf'`): el paquete es CJS y sus named exports NO
// resuelven bajo Node ESM nativo; el `default` funciona en Node, Vitest y el build de browser.
//
// IDEMPOTENCIA DEL ROUND-TRIP: `exportSgf(importSgf(exportSgf(t))) === exportSgf(t)` (byte-idéntico).
// Se logra porque `exportSgf` es CANÓNICO: `importSgf` descarta el SgfNode y reconstruye nuestro
// GameTree, así que el orden de propiedades y el formato de cada valor los fija SIEMPRE el exporter.
//
// INVARIANTE DE HANDICAP: `HA[n]` ↔ `meta.handicap`; las `AB[..]` (piedras de handicap) se REGENERAN
// en el export desde `handicapVertices(boardSize, handicap)` y NUNCA se guardan ni se leen como
// jugadas. Al importar, los `AB` se ignoran (el handicap ya está en `HA`): así no se filtran a `moves`.
//
// SETUP (fase Aprender): la otra mitad del invariante — SIN `HA` (handicap 0/1), `AB`/`AW` del raíz
// son piedras COLOCADAS (`meta.setup`) y `PL` fija el turno inicial (`meta.initialTurn`). Tampoco son
// jugadas: viven en la meta y el export las emite tal cual (AB, AW, PL, tras RU/TGHC). Un tsumego
// estándar deja de importarse como tablero vacío.
import type { BoardSize, Move, Rules, StoneColor } from '@tengen/engine'
import sgf from '@sabaki/sgf'
import type { SgfNode } from '@sabaki/sgf'
import { GameTree, type GameNode } from './gameTree'
import { handicapVertices, type SetupStones } from './rules'

/** Vértice del motor {x,y} → coordenada SGF de 2 letras (columna=x primero, a=0). */
export function vertexToSgf(v: { x: number; y: number }): string {
  return String.fromCharCode(97 + v.x) + String.fromCharCode(97 + v.y)
}

/** Coordenada SGF de 2 letras → vértice del motor {x,y}. Inverso de `vertexToSgf`. */
export function sgfToVertex(s: string): { x: number; y: number } {
  return { x: s.charCodeAt(0) - 97, y: s.charCodeAt(1) - 97 }
}

function rulesToSgf(rules: Rules): string {
  return rules === 'chinese' ? 'Chinese' : 'Japanese'
}

function sgfToRules(value: string): Rules {
  return value === 'Japanese' ? 'japanese' : 'chinese'
}

/** Valida que un número de tablero parseado sea un BoardSize soportado. */
function asBoardSize(n: number): BoardSize {
  if (n === 9 || n === 13 || n === 19) return n
  throw new Error(`SZ no soportado: ${n} (se esperaba 9, 13 o 19)`)
}

/** Datos SGF de una jugada: `{ B|W: [coord] }`; el pase es `[''] `(valor vacío). */
function moveToData(move: Move): Record<string, string[]> {
  const key = move.color === 'black' ? 'B' : 'W'
  const value = move.vertex === 'pass' ? '' : vertexToSgf(move.vertex)
  return { [key]: [value] }
}

/** Extrae la jugada de un nodo SGF (B o W). null si el nodo no es una jugada.
 *
 * FIX 3 (fix wave post-Fase 2): trata como pase, además del valor vacío (FF[4]), cualquier
 * coordenada FUERA de rango para `boardSize` — cubre el pase legacy FF[3] (`tt`, que en 19×19 cae
 * en {x:19,y:19}) y cualquier otra coordenada off-board. Antes solo `''` contaba como pase: `tt` se
 * colaba como jugada fantasma que go-board descartaba en silencio pero que quedaba en el árbol, se
 * re-exportaba como `tt`, y rompía `isGameOverByTwoPasses` en partidas importadas de otros clientes. */
function moveFromData(data: Record<string, string[]>, boardSize: BoardSize): Move | null {
  const readColor = (key: string, color: StoneColor): Move | null => {
    const values = data[key]
    if (!values) return null
    const raw = values[0] ?? ''
    if (raw === '') return { color, vertex: 'pass' }
    const vertex = sgfToVertex(raw)
    const onBoard = vertex.x >= 0 && vertex.x < boardSize && vertex.y >= 0 && vertex.y < boardSize
    return { color, vertex: onBoard ? vertex : 'pass' }
  }
  return readColor('B', 'black') ?? readColor('W', 'white')
}

/** Piedras de setup del nodo raíz (AB/AW), para SGF SIN handicap. Expande listas comprimidas FF[4]
 * (`ab:cd` = rectángulo inclusivo, común en colecciones de tsumego) y descarta coordenadas fuera
 * del tablero. undefined si no hay ninguna piedra (la meta no gana la clave). */
function setupFromData(data: Record<string, string[]>, boardSize: BoardSize): SetupStones | undefined {
  const expand = (raw: string): { x: number; y: number }[] => {
    const [from, to] = raw.split(':')
    if (from === undefined || from.length < 2) return []
    const a = sgfToVertex(from)
    if (to === undefined) return [a]
    const b = sgfToVertex(to)
    const points: { x: number; y: number }[] = []
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
        points.push({ x, y })
      }
    }
    return points
  }
  const read = (key: string): { x: number; y: number }[] =>
    (data[key] ?? [])
      .flatMap(expand)
      .filter((v) => v.x >= 0 && v.x < boardSize && v.y >= 0 && v.y < boardSize)
  const black = read('AB')
  const white = read('AW')
  if (black.length === 0 && white.length === 0) return undefined
  return { black, white }
}

/** Callback opcional: datos extra a fusionar en las propiedades SGF de UN nodo (p.ej. análisis
 * cacheado — ver `analysis/sgfAnalysisCodec.ts`). `undefined` = sin datos extra para ese nodo. */
type ExtraDataGetter = (node: GameNode) => Record<string, string[]> | undefined

/** Construye el SgfNode de un GameNode y sus descendientes. `extraRootData` sólo aplica a la raíz;
 * `getExtraData` se consulta para CUALQUIER nodo (incluida la raíz, fusionado DESPUÉS del resto —
 * nunca pisa GM/FF/SZ/.../B/W, que van primero por orden de inserción). */
function toSgfNode(node: GameNode, getExtraData?: ExtraDataGetter, extraRootData?: Record<string, string[]>): SgfNode {
  const data: Record<string, string[]> = node.move ? moveToData(node.move) : { ...extraRootData }
  const extra = getExtraData?.(node)
  if (extra) Object.assign(data, extra)
  return {
    id: node.id,
    data,
    parentId: node.parent ? node.parent.id : null,
    children: node.children.map((child) => toSgfNode(child, getExtraData)),
  }
}

/**
 * Serializa el árbol completo a SGF. Orden de propiedades de la raíz FIJO (idempotencia):
 * GM, FF, SZ, KM, RU, [TGHC], [HA, AB], [RE], [getExtraData]. `stringify([root])` envuelve en `(;...)`.
 *
 * `getExtraData` (opcional): por cada nodo, propiedades adicionales a fusionar — el árbol NO sabe
 * qué significan (p.ej. análisis del motor cacheado); es el mecanismo genérico que usa Fase 6 sin
 * que este archivo importe `Analysis`/`AnalysisStore`. Sin este argumento, comportamiento IDÉNTICO
 * a antes (todos los callers existentes — `game/persistence.ts`, `PlayView.tsx` — no lo pasan).
 */
export function exportSgf(tree: GameTree, getExtraData?: ExtraDataGetter): string {
  const { boardSize, komi, rules, handicap, humanColor, result } = tree.meta
  // Orden de inserción = orden de emisión de stringify (itera `for id in data`): mantenerlo estable.
  const rootData: Record<string, string[]> = {
    GM: ['1'],
    FF: ['4'],
    SZ: [String(boardSize)],
    KM: [String(komi)],
    RU: [rulesToSgf(rules)],
  }
  // Color del humano: propiedad propia TG-prefijada (mismo criterio que `TGBP`/`TGBT` del reloj), en
  // posición FIJA tras RU. Se escribe SOLO cuando el humano es Blanco: el default Negro no emite nada,
  // así los SGF de partidas Negro quedan byte-idénticos a los de siempre (no rompe idempotencia ni
  // round-trips existentes). `humanColor==='white'` nunca coexiste con handicap≥2 (validateConfig lo
  // fuerza a negro), pero el orden es determinista igual.
  if (humanColor === 'white') rootData.TGHC = ['white']
  if (handicap >= 2) {
    rootData.HA = [String(handicap)]
    rootData.AB = handicapVertices(boardSize, handicap).map(([x, y]) => vertexToSgf({ x, y }))
  } else {
    // Setup (fase Aprender): AB/AW/PL solo existen SIN handicap — con HA≥2 la clave AB ya es del
    // handicap (regenerada arriba) y el import de un SGF así descarta setup/initialTurn igual.
    const { setup, initialTurn } = tree.meta
    if (setup && setup.black.length > 0) rootData.AB = setup.black.map(vertexToSgf)
    if (setup && setup.white.length > 0) rootData.AW = setup.white.map(vertexToSgf)
    if (initialTurn !== undefined) rootData.PL = [initialTurn === 'black' ? 'B' : 'W']
  }
  if (result !== undefined) rootData.RE = [result]

  return sgf.stringify([toSgfNode(tree.root, getExtraData, rootData)])
}

/**
 * Parsea SGF a un GameTree. Asume el formato que produce `exportSgf` (game-info en la raíz). Mapea
 * SZ/KM/RU/HA/RE/TGHC; los AB del raíz se IGNORAN (handicap ya en HA). Lanza si el SGF es inválido (el
 * caller de persistencia lo envuelve en try/catch). El cursor queda en la raíz.
 *
 * `onNodeData` (opcional): se invoca UNA vez por cada `GameNode` creado (incluida la raíz, PRIMERO)
 * con ese nodo (ya con `.id` asignado) y el `data` crudo parseado de su nodo SGF — el mecanismo
 * simétrico de `getExtraData` en `exportSgf`. NO se invoca para un "nodo sin jugada" transparente
 * (no crea un `GameNode` propio). Sin este argumento, comportamiento IDÉNTICO a antes.
 */
export function importSgf(
  source: string,
  onNodeData?: (node: GameNode, data: Record<string, string[]>) => void,
): GameTree {
  const roots = sgf.parse(source)
  const root = roots[0]
  if (!root) throw new Error('SGF sin nodo raíz')

  const { data } = root
  const boardSize = asBoardSize(parseInt(data.SZ?.[0] ?? '19', 10))
  const komiRaw = parseFloat(data.KM?.[0] ?? '0')
  const komi = Number.isFinite(komiRaw) ? komiRaw : 0
  const rules = sgfToRules(data.RU?.[0] ?? 'Chinese')
  const handicapRaw = parseInt(data.HA?.[0] ?? '0', 10)
  const handicapParsed = Number.isFinite(handicapRaw) ? handicapRaw : 0
  // FIX 6 (fix wave post-Fase 2): HA[1] normalizado a 0, misma regla que `validateConfig` (handicap
  // 1 en Go = "solo komi, sin piedra de ventaja"). Sin esto, `tree.meta.handicap` quedaba en 1
  // mientras `importedConfig` (validado en `PlayView.handleImportFile`) ya lo normalizaba a 0 —
  // árbol y config desincronizados toda la sesión (`positionAt()` emitiría `handicap:1` al motor,
  // un valor que el flujo normal —validateConfig antes de fromConfig— nunca produce). No rompe la
  // idempotencia de Task 2: `exportSgf` nunca emite HA[1] (sólo escribe HA si handicap>=2).
  const handicap = handicapParsed === 1 ? 0 : handicapParsed

  // Color del humano: `TGHC[white]` (lo escribe `exportSgf` solo para partidas de Blanco). Cualquier
  // otra cosa (ausente, o un valor inesperado) → 'black', el default de siempre. Nunca lanza.
  const humanColor: StoneColor = data.TGHC?.[0] === 'white' ? 'white' : 'black'

  // Setup (fase Aprender): SOLO sin handicap — con HA≥2 los AB son las piedras de handicap (se
  // ignoran; el export las regenera) y PL no aplica. `PL[B]`/`PL[W]` (acepta minúscula); cualquier
  // otro valor se descarta en silencio.
  const setup = handicap < 2 ? setupFromData(data, boardSize) : undefined
  const plRaw = handicap < 2 ? data.PL?.[0]?.toUpperCase() : undefined
  const initialTurn: StoneColor | undefined = plRaw === 'B' ? 'black' : plRaw === 'W' ? 'white' : undefined

  const tree = new GameTree({
    boardSize,
    komi,
    rules,
    handicap,
    humanColor,
    ...(setup !== undefined ? { setup } : {}),
    ...(initialTurn !== undefined ? { initialTurn } : {}),
    ...(data.RE?.[0] !== undefined ? { result: data.RE[0] } : {}),
  })
  onNodeData?.(tree.root, data)

  // Los hijos de la raíz son las jugadas (la raíz sólo lleva game-info + AB, que se ignoran).
  const attach = (sgfNode: SgfNode, parent: GameNode): void => {
    for (const child of sgfNode.children) {
      const move = moveFromData(child.data, boardSize)
      if (move) {
        const node = tree.appendChild(parent, move)
        onNodeData?.(node, child.data)
        attach(child, node)
      } else {
        // Nodo sin jugada (raro en nuestro formato): transparente, cuelga sus hijos del mismo padre.
        attach(child, parent)
      }
    }
  }
  attach(root, tree.root)

  return tree
}
