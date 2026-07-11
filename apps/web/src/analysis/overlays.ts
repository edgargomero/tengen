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
import type { Analysis, BoardSize, MoveAnalysis, Vertex as TengenVertex } from '@tengen/engine'
import type { GhostStone, HeatVertex, LineMarker, Vertex as ShudanVertex } from '@sabaki/shudan'
import type { GameNode as TengenGameNode, GameTree } from '../game/gameTree'
import type { AnalysisStore } from './analysisStore'
import { colorToSign, engineToSabakiVertex } from '../game/coords'
import { adaptGameNode } from './katrainAdapter'
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
 * Líneas de la variación principal de UNA candidata (`topMove.pv`), típicamente `analysis.moves[0]`
 * — Task 9/10 decide cuál candidata pasar, esta función solo dibuja la que le dan.
 *
 * Trunca la secuencia en el primer elemento inválido — sea un `'pass'` (un pase no tiene casilla,
 * la PV no puede continuar más allá) o un vértice fuera de `[0,boardSize)` (protección defensiva
 * contra datos corruptos del motor) — de forma INCLUSIVA (el elemento inválido mismo no se dibuja,
 * ni nada después). Si la secuencia útil resultante tiene menos de 2 vértices, no hay nada que
 * conectar → `[]`.
 */
export function buildPvLines(topMove: MoveAnalysis, boardSize: BoardSize): LineMarker[] {
  const sequence = buildPvSequence(topMove)

  const usable: { x: number; y: number }[] = []
  for (const v of sequence) {
    if (v === 'pass' || !isOnBoard(v, boardSize)) break
    usable.push(v)
  }

  if (usable.length < 2) return []

  const sabakiVertices: ShudanVertex[] = usable.map(engineToSabakiVertex)
  const lines: LineMarker[] = []
  for (let i = 0; i < sabakiVertices.length - 1; i++) {
    lines.push({ v1: sabakiVertices[i]!, v2: sabakiVertices[i + 1]!, type: 'line' })
  }
  return lines
}
