// Deriva los datos del "resumen de review" de Modo Analizar (#6 del backlog UX): categorías de
// calidad de jugada agregadas por jugador + precisión por fase de partida. Archivo 100% NATIVO de
// tengen (mismo estatus que `overlays.ts`/`winrateGraphData.ts`): no copia lógica de ningún archivo
// vendor: solo CONSUME datos ya calculados por `computeGameReport` (Task 4 de Fase 3a) y el
// clasificador `getEvaluationClass` (portado). Sin cabecera MIT ni entrada en
// THIRD-PARTY-LICENSES/adaptaciones-upstream.md.
//
// ── Un solo clasificador de calidad: pérdida de puntos ──────────────────────────────────────────
// La base de "calidad" es SIEMPRE la pérdida de puntos (`pointsLost`), vía `getEvaluationClass`
// (6 buckets, `DEFAULT_EVAL_THRESHOLDS = [12,6,3,1.5,0.5,0]`), NO el rango de política
// (`MovePolicyCategory`, otra definición de "calidad" que confundiría). El agregado y el badge por
// jugada se derivan del MISMO clasificador para que sus colores/etiquetas nunca discrepen.
//
// ── Orden worst-first: NO es estético ───────────────────────────────────────────────────────────
// `QUALITY_CATEGORIES` está alineado POR ÍNDICE a los buckets de `getEvaluationClass`
// (índice 0 = peor, ≥12 pts perdidos; índice 5 = mejor, <0.5). `report.histogram` (Task 4) usa esos
// MISMOS índices (`getPointLossBucket` → `evaluationClass`, misma lógica que `getEvaluationClass`
// para `pointsLost >= 0`). Reordenar este array rompería en silencio la alineación con el
// histograma. La inversión "best-first" para mostrar (Excelente primero) vive SOLO en la capa de
// presentación (`GameReviewSummary`), nunca aquí.
import { getEvaluationClass } from './vendor/web-katrain/nodeAnalysis'
import type { GameReport, GameReportPhase, MoveReportEntry } from './vendor/web-katrain/gameReport'
import type { Player } from './vendor/web-katrain/types'

/** Reusa las clases `.tone-*` ya existentes (`app.css`). `'muted'` no hace falta: los buckets de
 * pérdida de puntos son finitos y siempre caen en uno de estos tres. */
export type QualityTone = 'success' | 'warning' | 'danger'

export type QualityCategory = {
  label: string
  /** Forma plural (el español no pluraliza uniforme). El resumen usa `label` para conteo 1, `plural` si no. */
  plural: string
  tone: QualityTone
}

/**
 * Alineado POR ÍNDICE a los buckets de `getEvaluationClass`/`DEFAULT_EVAL_THRESHOLDS`
 * (worst-first: índice 0 = peor). Etiquetas fácilmente ajustables. Tonos: buckets 0-2 → `danger`,
 * 3 → `warning`, 4-5 → `success`.
 */
export const QUALITY_CATEGORIES: QualityCategory[] = [
  { label: 'Blunder', plural: 'Blunders', tone: 'danger' }, //          [0] pérdida ≥ 12
  { label: 'Error grave', plural: 'Errores graves', tone: 'danger' }, // [1] pérdida 6–12
  { label: 'Error', plural: 'Errores', tone: 'danger' }, //             [2] pérdida 3–6
  { label: 'Imprecisión', plural: 'Imprecisiones', tone: 'warning' }, // [3] pérdida 1.5–3
  { label: 'Buena', plural: 'Buenas', tone: 'success' }, //             [4] pérdida 0.5–1.5
  { label: 'Excelente', plural: 'Excelentes', tone: 'success' }, //     [5] pérdida < 0.5
]

/**
 * Categoría de calidad de UNA jugada a partir de su pérdida de puntos. Envuelve `getEvaluationClass`
 * (que ya clampa el índice a `[0, 5]`), así que el fallback nunca se alcanza en la práctica — está
 * solo para satisfacer `noUncheckedIndexedAccess`.
 */
export function qualityCategoryForPointsLost(pointsLost: number): QualityCategory {
  const index = getEvaluationClass(pointsLost)
  return QUALITY_CATEGORIES[index] ?? QUALITY_CATEGORIES[QUALITY_CATEGORIES.length - 1]!
}

export type QualityHistogramBin = { category: QualityCategory; count: number }

/**
 * Zip DIRECTO de `report.histogram` (ya construido con los mismos umbrales) con las etiquetas —
 * cero reclasificación. Devuelve worst-first (index-aligned con `QUALITY_CATEGORIES`); la
 * presentación invierte + filtra ceros.
 */
export function buildQualityHistogram(report: GameReport): Record<Player, QualityHistogramBin[]> {
  const forPlayer = (player: Player): QualityHistogramBin[] =>
    QUALITY_CATEGORIES.map((category, i) => ({ category, count: report.histogram[i]?.[player] ?? 0 }))
  return { black: forPlayer('black'), white: forPlayer('white') }
}

export type PhasePrecision = { meanPointsLost: number; count: number }

/** Etiquetas ES de las fases (NO se toca el `getPhaseLabel` del vendor, en inglés por fidelidad de port). */
export const PHASE_LABELS_ES: Record<GameReportPhase, string> = {
  opening: 'Apertura',
  middleGame: 'Medio',
  endgame: 'Yose',
}

/**
 * Agrupa `report.moveEntries` por `(jugador, entry.phase)` en el cliente y devuelve la media de
 * puntos perdidos + el conteo por fase. NO recompone el reporte 3× (`computeGameReport` con
 * `phaseFilter`): el `phaseFilter` solo hace `continue` de las fases que no matchean ANTES de
 * acumular, así que agrupar aquí da EXACTAMENTE las mismas medias, más barato. Se confía en
 * `entry.phase` (ya calculado con los umbrales correctos por tamaño de tablero, `getPhaseThresholds`)
 * — nunca se recomputa la fase en el cliente. Fase sin jugadas → `{ meanPointsLost: 0, count: 0 }`
 * (nunca NaN de un `0/0`).
 */
export function summarizePhasePrecision(
  moveEntries: MoveReportEntry[]
): Record<Player, Record<GameReportPhase, PhasePrecision>> {
  const acc: Record<Player, Record<GameReportPhase, { total: number; count: number }>> = {
    black: { opening: { total: 0, count: 0 }, middleGame: { total: 0, count: 0 }, endgame: { total: 0, count: 0 } },
    white: { opening: { total: 0, count: 0 }, middleGame: { total: 0, count: 0 }, endgame: { total: 0, count: 0 } },
  }
  for (const entry of moveEntries) {
    const bucket = acc[entry.player][entry.phase]
    bucket.total += entry.pointsLost
    bucket.count += 1
  }
  const finalize = (player: Player): Record<GameReportPhase, PhasePrecision> => {
    const mean = (phase: GameReportPhase): PhasePrecision => {
      const { total, count } = acc[player][phase]
      return { meanPointsLost: count > 0 ? total / count : 0, count }
    }
    return { opening: mean('opening'), middleGame: mean('middleGame'), endgame: mean('endgame') }
  }
  return { black: finalize('black'), white: finalize('white') }
}
