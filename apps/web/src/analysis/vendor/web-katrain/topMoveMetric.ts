/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/topMoveMetric.ts. Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 * Adaptación (hallazgo 18 del plan, mismo patrón que evalV8.ts/featuresV7Fast.ts del motor:
 * "imports resueltos a defs locales"): `TopMoveMetric`/`PolicyHeatmapMetric` en el original son
 * `GameSettings['trainerTopMovesShow']`/`GameSettings['analysisPolicyMetric']`; tengen no tiene
 * `GameSettings`, así que aquí son uniones literales locales con los mismos valores exactos del
 * vendor. Resto del archivo verbatim. No depende de `types.ts` de este directorio.
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */

export type TopMoveMetric =
  | 'top_move_score'
  | 'top_move_delta_score'
  | 'top_move_winrate'
  | 'top_move_delta_winrate'
  | 'top_move_visits'
  | 'top_move_nothing'

export type PolicyHeatmapMetric = 'policy' | 'delta_score' | 'delta_winrate'

export const TOP_MOVE_METRIC_OPTIONS: Array<{ value: TopMoveMetric; label: string; shortLabel: string }> = [
  { value: 'top_move_delta_score', label: 'Delta score', shortLabel: 'Delta' },
  { value: 'top_move_visits', label: 'Visits', shortLabel: 'Visits' },
  { value: 'top_move_score', label: 'Score', shortLabel: 'Score' },
  { value: 'top_move_winrate', label: 'Winrate', shortLabel: 'Win' },
  { value: 'top_move_delta_winrate', label: 'Delta winrate', shortLabel: 'Delta win' },
  { value: 'top_move_nothing', label: 'Nothing', shortLabel: 'Off' },
]

export const TOP_MOVE_METRIC_SELECT_OPTIONS: Array<{ value: TopMoveMetric; label: string }> = [
  { value: 'top_move_delta_score', label: 'Delta Score (points lost)' },
  { value: 'top_move_visits', label: 'Visits' },
  { value: 'top_move_score', label: 'Score' },
  { value: 'top_move_winrate', label: 'Winrate' },
  { value: 'top_move_delta_winrate', label: 'Delta Winrate' },
  { value: 'top_move_nothing', label: 'Nothing' },
]

export const POLICY_HEATMAP_METRIC_OPTIONS: Array<{ value: PolicyHeatmapMetric; label: string; shortLabel: string }> = [
  { value: 'policy', label: 'Move probability', shortLabel: 'Prob.' },
  { value: 'delta_score', label: 'Score change', shortLabel: 'Score' },
  { value: 'delta_winrate', label: 'Win-rate change', shortLabel: 'Win rate' },
]

export const POLICY_HEATMAP_METRIC_SELECT_OPTIONS: Array<{ value: PolicyHeatmapMetric; label: string }> = [
  { value: 'policy', label: 'Move Probability' },
  { value: 'delta_score', label: 'Score Change' },
  { value: 'delta_winrate', label: 'Win-rate Change' },
]

export function getTopMoveMetricLabel(metric: TopMoveMetric, variant: 'long' | 'short' = 'long'): string {
  const option = TOP_MOVE_METRIC_OPTIONS.find((item) => item.value === metric) ?? TOP_MOVE_METRIC_OPTIONS[0]!
  return variant === 'short' ? option.shortLabel : option.label
}

export function nextTopMoveMetric(metric: TopMoveMetric): TopMoveMetric {
  const index = TOP_MOVE_METRIC_OPTIONS.findIndex((item) => item.value === metric)
  return TOP_MOVE_METRIC_OPTIONS[(index + 1) % TOP_MOVE_METRIC_OPTIONS.length]!.value
}

export function getPolicyHeatmapMetricLabel(
  metric: PolicyHeatmapMetric | undefined,
  variant: 'long' | 'short' = 'long'
): string {
  const option = POLICY_HEATMAP_METRIC_OPTIONS.find((item) => item.value === metric) ?? POLICY_HEATMAP_METRIC_OPTIONS[0]!
  return variant === 'short' ? option.shortLabel : option.label
}

export function nextPolicyHeatmapMetric(metric: PolicyHeatmapMetric | undefined): PolicyHeatmapMetric {
  const index = POLICY_HEATMAP_METRIC_OPTIONS.findIndex((item) => item.value === metric)
  return POLICY_HEATMAP_METRIC_OPTIONS[(index + 1) % POLICY_HEATMAP_METRIC_OPTIONS.length]!.value
}
