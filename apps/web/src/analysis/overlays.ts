// Traduce el `Analysis`/`GameNode` nativos de tengen a las primitivas visuales de
// `@sabaki/shudan` (heatMap/ghostStoneMap/lines) para el tablero de "Modo Analizar" (Fase 3a,
// Task 8). Archivo 100% NATIVO: no copia lógica de ningún archivo vendor propio — solo CONSUME lo
// ya portado en Tasks 3/4 (`getPlayedMoveQuality`, `PointsLostSummary['tone']`) y el puente de
// Task 5 (`adaptGameNode`). Sin cabecera MIT, sin entrada en THIRD-PARTY-LICENSES/
// adaptaciones-upstream.md (ver esas dos referencias para la lista de lo que SÍ es un port).
//
// ── FOOTGUN DE INDEXACIÓN (mismo patrón documentado en `apps/web/src/game/coords.ts`) ───────────
// Los `Map<T> = T[][]` de Shudan (`heatMap`/`ghostStoneMap`) se indexan **`grid[y][x]`**, NO
// `grid[x][y]`. `Vertex` de Shudan es la TUPLA `[x,y]` (usada solo por `LineMarker.v1/v2`, vía
// `engineToSabakiVertex` de `coords.ts` — nunca reimplementada aquí). Los tests de este archivo
// usan vértices ASIMÉTRICOS (x≠y) y verifican explícitamente que la celda transpuesta queda vacía.
//
// ── Tipo de retorno de las grillas: `(HeatVertex | null)[][]` / `(GhostStone | null)[][]` ───────
// El plan/brief abrevia `HeatVertex[][]`/`GhostStone[][]`, pero las celdas sin dato son `null`
// (Shudan acepta `Map<HeatVertex | null>`/`Map<GhostStone | null>` en sus props `heatMap`/
// `ghostStoneMap`) — bajo `strict`+`noUncheckedIndexedAccess` el tipo `T[][]` sin `| null` ni
// siquiera compilaría con celdas `null`. El tipo de esta función es el HONESTO (y el que Shudan
// espera directo, sin adaptar nada más en Task 9/10).
import type { Analysis, BoardSize, MoveAnalysis, StoneColor, Vertex as TengenVertex } from '@tengen/engine'
import type { GhostStone, HeatVertex, Marker } from '@sabaki/shudan'
import type { GameNode as TengenGameNode, GameTree } from '../game/gameTree'
import type { AnalysisStore } from './analysisStore'
import { colorToSign } from '../game/coords'
import { adaptGameNode } from './katrainAdapter'
import { qualityCategoryForPointsLost } from './reviewSummary'
import type { QualityTone } from './reviewSummary'
import { computeNodePointsLost } from './vendor/web-katrain/nodeAnalysis'
import { getPlayedMoveQuality } from './vendor/web-katrain/playedMoveQuality'
import type { PointsLostSummary } from './vendor/web-katrain/analysisSummary'

function emptyGrid<T>(boardSize: BoardSize): (T | null)[][] {
  return Array.from({ length: boardSize }, () => new Array<T | null>(boardSize).fill(null))
}

/**
 * Grilla de calor `[y][x]` sobre las candidatas de la posición ACTUAL (`analysis.moves`), NO sobre
 * la calidad de una jugada ya jugada (eso es `buildGhostStoneMap`).
 *
 * **Métrica elegida (decisión de esta tarea, el plan no la fija): `visits`.** Refleja el resultado
 * COMPLETO de la búsqueda MCTS (policy + value combinados), no solo la política cruda de la red —
 * es la señal más informativa de "dónde miró el motor". `topMoveMetric.ts` (Task 3) define un tipo
 * para métricas alternativas (`'policy'|'delta_score'|'delta_winrate'`) pensado para un selector de
 * usuario que Fase 3a no construye todavía; queda ported-but-unused a propósito, no se cablea aquí
 * (evitaría acoplar esta firma a una opción que nadie puede elegir desde la UI todavía).
 *
 * `text` queda `undefined` en todas las celdas: decisión de pulido visual de Task 10, no de esta
 * función de datos pura.
 */
export function buildHeatMap(analysis: Analysis, boardSize: BoardSize): (HeatVertex | null)[][] {
  const grid = emptyGrid<HeatVertex>(boardSize)
  // maxVisits considera TODAS las candidatas (incluida la de pase, si existe) — normaliza contra el
  // esfuerzo de búsqueda real del motor, no solo contra las candidatas que terminan dibujadas.
  const maxVisits = analysis.moves.reduce((max, m) => Math.max(max, m.visits), 0)

  for (const candidate of analysis.moves) {
    if (candidate.vertex === 'pass') continue // un pase no tiene casilla — se omite del heatmap.
    // maxVisits===0 (todas las candidatas con 0 visits, p.ej. sin búsqueda real) → strength 0, no
    // NaN de una división 0/0.
    const strength = maxVisits > 0 ? candidate.visits / maxVisits : 0
    const row = grid[candidate.vertex.y]
    if (row) row[candidate.vertex.x] = { strength }
  }

  return grid
}

/**
 * Mapeo `PointsLostSummary['tone']` (Task 4, 3 niveles con datos + `'muted'` sin-datos) →
 * `GhostStone['type']` de Shudan (4 niveles: `good`/`interesting`/`doubtful`/`bad`, convención SGF
 * clásica GB/IT/DO/BM). Decisión de esta tarea (el plan no la fija): `success→'good'`,
 * `warning→'doubtful'`, `danger→'bad'`; `muted` no tiene tono asociado con calidad real → `null`
 * (SIN ghost stone, nunca un `GhostStone` con `type` inventado). `'interesting'` de Shudan queda
 * SIN USAR: ningún tono del vendor mapea limpio a él, e inventar un umbral nuevo solo para llenarlo
 * sería arbitrario. Exportada (en vez de mantenerla privada) para poder testear el mapeo de forma
 * exhaustiva y aislada — un `'muted'` real solo es alcanzable en la práctica vía datos corruptos del
 * motor (ver `buildGhostStoneMap` más abajo), así que el test de integración no puede ejercitar esa
 * rama de forma determinista sin esta función expuesta.
 */
export function toneToGhostType(tone: PointsLostSummary['tone']): GhostStone['type'] | null {
  switch (tone) {
    case 'success':
      return 'good'
    case 'warning':
      return 'doubtful'
    case 'danger':
      return 'bad'
    case 'muted':
      return null
  }
}

/**
 * Grilla `[y][x]` con la CALIDAD de la jugada que llegó a `node` (no las candidatas de la posición
 * actual — eso es `buildHeatMap`). Todo `null` salvo, a lo sumo, la casilla de `node.move`.
 *
 * `boardSize` se recibe explícito (en vez de leer `tree.meta.boardSize`) por consistencia de firma
 * con `buildHeatMap`/`buildPvLines` — las tres funciones de este archivo comparten la misma forma.
 */
export function buildGhostStoneMap(node: TengenGameNode, tree: GameTree, store: AnalysisStore, boardSize: BoardSize): (GhostStone | null)[][] {
  const grid = emptyGrid<GhostStone>(boardSize)
  const move = node.move
  if (!move || move.vertex === 'pass') return grid // raíz, o un pase: ninguno tiene casilla.

  const adapted = adaptGameNode(node, tree, store)
  const quality = getPlayedMoveQuality(adapted, boardSize)
  if (!quality) return grid // sin datos suficientes (p.ej. el padre nunca se analizó) — sin lanzar.

  const type = toneToGhostType(quality.tone)
  if (type === null) return grid // tone 'muted': sin ghost stone, no se inventa un type.

  const row = grid[move.vertex.y]
  if (row) row[move.vertex.x] = { sign: colorToSign(move.color), type }
  return grid
}

/**
 * Grilla `[y][x]` con una burbuja "-X.X" (marker `label`) sobre la piedra que llegó a `node`,
 * indicando cuántos puntos costó esa jugada (#9 del backlog UX). Todo `null` salvo, a lo sumo, la
 * casilla de `node.move`. Espeja `buildGhostStoneMap` (misma firma, mismos guards) — se dibuja sobre
 * la MISMA piedra que el ghost stone de calidad, y se actualiza al navegar.
 *
 * Gateada por `minPointsLost` (0.5 por defecto) y SOLO pérdidas: una jugada trivial o una ganancia no
 * dibuja nada (no se ensucia el tablero con "-0.0" ni con "Best"). Usa el `computeNodePointsLost`
 * *lenient* (con fallback a `candidate.pointsLost`) — INTENCIONAL: coincide con el ghost stone de
 * calidad sobre el que se apoya, aunque pueda mostrar un número donde el `computePointsLostStrict`
 * del reporte agregado devolvería `null`. La burbuja concuerda con SU PROPIO ghost stone, no con el
 * panel — no es una discrepancia.
 */
/** Umbral mínimo de pérdida (en puntos) para dibujar la burbuja #9 — compartido por el label y su
 * color, para que ambos aparezcan/desaparezcan en lockstep (nunca color sin número ni al revés). */
export const POINTS_LOST_BUBBLE_MIN = 0.5

/**
 * Núcleo compartido de #9: la pérdida de puntos de la jugada que llegó a `node`, ya gateada, con su
 * vértice. `null` si no hay burbuja que dibujar (raíz/pase, padre sin analizar, ganancia, o pérdida
 * por debajo del umbral). Usa el `computeNodePointsLost` *lenient* — ver nota en `buildPointsLostLabelMap`.
 */
function playedMovePointsLost(
  node: TengenGameNode,
  tree: GameTree,
  store: AnalysisStore,
  minPointsLost: number,
): { vertex: { x: number; y: number }; pointsLost: number } | null {
  const move = node.move
  if (!move || move.vertex === 'pass') return null // raíz, o un pase: ninguno tiene casilla.
  const pointsLost = computeNodePointsLost(adaptGameNode(node, tree, store))
  if (pointsLost === null || !Number.isFinite(pointsLost) || pointsLost < minPointsLost) return null
  return { vertex: move.vertex, pointsLost }
}

export function buildPointsLostLabelMap(
  node: TengenGameNode,
  tree: GameTree,
  store: AnalysisStore,
  boardSize: BoardSize,
  minPointsLost = POINTS_LOST_BUBBLE_MIN,
): (Marker | null)[][] {
  const grid = emptyGrid<Marker>(boardSize)
  const bubble = playedMovePointsLost(node, tree, store, minPointsLost)
  if (!bubble) return grid

  const row = grid[bubble.vertex.y]
  if (row) row[bubble.vertex.x] = { type: 'label', label: `-${bubble.pointsLost.toFixed(1)}` }
  return grid
}

/**
 * Tono de calidad (`success`/`warning`/`danger`) de la burbuja #9 del nodo actual, o `null` si no
 * hay burbuja. Gateado IDÉNTICAMENTE a `buildPointsLostLabelMap` (mismo `playedMovePointsLost`,
 * mismo umbral por defecto), así que el color y el número nunca se desincronizan. Lo consume
 * `AnalyzeView` para pintar el pill del tono sobre la piedra jugada (Shudan no colorea markers por sí
 * solo). Reusa el MISMO clasificador de 6 buckets que el badge del panel y el histograma agregado.
 */
export function pointsLostBubbleTone(
  node: TengenGameNode,
  tree: GameTree,
  store: AnalysisStore,
  minPointsLost = POINTS_LOST_BUBBLE_MIN,
): QualityTone | null {
  const bubble = playedMovePointsLost(node, tree, store, minPointsLost)
  return bubble ? qualityCategoryForPointsLost(bubble.pointsLost).tone : null
}

/** ¿Son el mismo vértice? Comparación local (mismo patrón que `gameTree.ts`, no exportado de ahí). */
function sameVertex(a: TengenVertex, b: TengenVertex): boolean {
  if (a === 'pass' || b === 'pass') return a === b
  return a.x === b.x && a.y === b.y
}

/** Vértice real (no-pase) dentro de los límites `[0,boardSize)` en ambos ejes. */
function isOnBoard(v: { x: number; y: number }, boardSize: BoardSize): boolean {
  return v.x >= 0 && v.x < boardSize && v.y >= 0 && v.y < boardSize
}

/**
 * Concatena `topMove.vertex` con `topMove.pv`, colapsando un duplicado consecutivo si `pv[0]` YA
 * era `topMove.vertex` — funciona correctamente sin importar cuál de las dos convenciones use el
 * motor (no está verificado si `pv[0]` incluye la jugada de `topMove` o empieza en la continuación).
 */
function buildPvSequence(topMove: MoveAnalysis): TengenVertex[] {
  const seq = [topMove.vertex, ...topMove.pv]
  const deduped: TengenVertex[] = []
  for (const v of seq) {
    const prev = deduped[deduped.length - 1]
    if (prev !== undefined && sameVertex(prev, v)) continue
    deduped.push(v)
  }
  return deduped
}

/**
 * Ghost stones NUMERADOS de la variación principal de UNA candidata (`topMove.pv`), típicamente
 * `analysis.moves[0]` — Task 9/10 decide cuál candidata pasar, esta función solo dibuja la que le dan.
 *
 * Reemplaza el intento anterior de dibujar la PV como polilínea conectada (`LineMarker`, ver git
 * history): un PV real de MCTS salta por el tablero sin localidad espacial (jugada táctica en una
 * zona, respuesta del rival en otra, varios movimientos después) — conectar esos puntos con líneas
 * rectas produce un cruce ilegible de segmentos, no una "variación" reconocible (bug reportado por
 * Edgar; confirmado con datos reales del motor: un PV válido de 11 vértices, sin repetidos ni fuera
 * de rango, ya se ve como un enredo al dibujarlo como polilínea). Reemplazado por el patrón estándar
 * de KataGo/Lizzie/KaTrain: cada vértice se dibuja como una piedra fantasma que alterna color desde
 * `toMoveColor` (el jugador al turno en la posición analizada), con una etiqueta 1,2,3… — sin líneas.
 *
 * Trunca la secuencia en el primer elemento inválido — sea un `'pass'` (un pase no tiene casilla) o
 * un vértice fuera de `[0,boardSize)` (protección defensiva contra datos corruptos del motor) — de
 * forma INCLUSIVA (el elemento inválido mismo no se dibuja, ni nada después).
 */
export function buildPvOverlay(
  topMove: MoveAnalysis,
  boardSize: BoardSize,
  toMoveColor: StoneColor,
): { ghostStoneMap: (GhostStone | null)[][]; markerMap: (Marker | null)[][] } {
  const sequence = buildPvSequence(topMove)

  const usable: { x: number; y: number }[] = []
  for (const v of sequence) {
    if (v === 'pass' || !isOnBoard(v, boardSize)) break
    usable.push(v)
  }

  const ghostStoneMap = emptyGrid<GhostStone>(boardSize)
  const markerMap = emptyGrid<Marker>(boardSize)
  let sign = colorToSign(toMoveColor)
  for (let i = 0; i < usable.length; i++) {
    const v = usable[i]!
    const gRow = ghostStoneMap[v.y]
    if (gRow) gRow[v.x] = { sign, faint: true }
    const mRow = markerMap[v.y]
    if (mRow) mRow[v.x] = { type: 'label', label: String(i + 1) }
    sign = sign === 1 ? -1 : 1
  }

  return { ghostStoneMap, markerMap }
}

/**
 * Combina el ghost stone de "calidad de la última jugada" (`buildGhostStoneMap`) con el de la
 * variación principal (`buildPvOverlay`) en una sola grilla — Shudan solo acepta un `ghostStoneMap`
 * por tablero. Colisión en la misma casilla es un caso de borde teórico (el PV recorre casillas
 * VACÍAS; la última jugada ya ocupa la suya con una piedra real, no con un ghost stone) — de darse,
 * gana `played` (un hecho ya sucedido) sobre `pv` (una predicción hipotética).
 */
export function mergeGhostStoneMaps(
  played: (GhostStone | null)[][],
  pv: (GhostStone | null)[][] | undefined,
  boardSize: BoardSize,
): (GhostStone | null)[][] {
  if (!pv) return played
  const merged = emptyGrid<GhostStone>(boardSize)
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const mRow = merged[y]
      if (mRow) mRow[x] = played[y]?.[x] ?? pv[y]?.[x] ?? null
    }
  }
  return merged
}

/**
 * Combina la burbuja de "pérdida de puntos" de la última jugada (`buildPointsLostLabelMap`) con los
 * markers numerados de la variación principal (`buildPvOverlay`) en un solo `markerMap` — Shudan solo
 * acepta uno por tablero. Espejo de `mergeGhostStoneMaps`: en colisión gana `played` (un hecho ya
 * sucedido) sobre `pv` (una predicción). En la práctica no colisionan (el PV recorre casillas VACÍAS;
 * la última jugada ya ocupa la suya con una piedra real).
 */
export function mergeMarkerMaps(
  played: (Marker | null)[][],
  pv: (Marker | null)[][] | undefined,
  boardSize: BoardSize,
): (Marker | null)[][] {
  if (!pv) return played
  const merged = emptyGrid<Marker>(boardSize)
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const mRow = merged[y]
      if (mRow) mRow[x] = played[y]?.[x] ?? pv[y]?.[x] ?? null
    }
  }
  return merged
}
