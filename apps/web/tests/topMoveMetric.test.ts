import { describe, expect, it } from 'vitest'
import {
  POLICY_HEATMAP_METRIC_OPTIONS,
  POLICY_HEATMAP_METRIC_SELECT_OPTIONS,
  TOP_MOVE_METRIC_OPTIONS,
  TOP_MOVE_METRIC_SELECT_OPTIONS,
  getPolicyHeatmapMetricLabel,
  getTopMoveMetricLabel,
  nextPolicyHeatmapMetric,
  nextTopMoveMetric,
} from '../src/analysis/vendor/web-katrain/topMoveMetric'

describe('option lists', () => {
  it('TOP_MOVE_METRIC_OPTIONS tiene 6 entradas', () => {
    expect(TOP_MOVE_METRIC_OPTIONS).toHaveLength(6)
  })

  it('TOP_MOVE_METRIC_SELECT_OPTIONS tiene 6 entradas', () => {
    expect(TOP_MOVE_METRIC_SELECT_OPTIONS).toHaveLength(6)
  })

  it('POLICY_HEATMAP_METRIC_OPTIONS tiene 3 entradas', () => {
    expect(POLICY_HEATMAP_METRIC_OPTIONS).toHaveLength(3)
  })

  it('POLICY_HEATMAP_METRIC_SELECT_OPTIONS tiene 3 entradas', () => {
    expect(POLICY_HEATMAP_METRIC_SELECT_OPTIONS).toHaveLength(3)
  })
})

describe('getTopMoveMetricLabel', () => {
  it('long (por defecto) devuelve el label largo', () => {
    expect(getTopMoveMetricLabel('top_move_visits')).toBe('Visits')
    expect(getTopMoveMetricLabel('top_move_delta_score')).toBe('Delta score')
  })

  it('short devuelve el shortLabel', () => {
    expect(getTopMoveMetricLabel('top_move_delta_score', 'short')).toBe('Delta')
    expect(getTopMoveMetricLabel('top_move_delta_winrate', 'short')).toBe('Delta win')
  })

  it('métrica desconocida usa el fallback al primer elemento', () => {
    expect(getTopMoveMetricLabel('nope' as never)).toBe(TOP_MOVE_METRIC_OPTIONS[0]!.label)
    expect(getTopMoveMetricLabel('nope' as never, 'short')).toBe(TOP_MOVE_METRIC_OPTIONS[0]!.shortLabel)
  })
})

describe('nextTopMoveMetric', () => {
  it('avanza al siguiente elemento de la lista', () => {
    expect(nextTopMoveMetric('top_move_delta_score')).toBe('top_move_visits')
  })

  it('wrap-around: desde el último vuelve al primero', () => {
    const last = TOP_MOVE_METRIC_OPTIONS[TOP_MOVE_METRIC_OPTIONS.length - 1]!.value
    expect(nextTopMoveMetric(last)).toBe(TOP_MOVE_METRIC_OPTIONS[0]!.value)
  })

  it('recorre las 6 opciones y vuelve al punto de partida', () => {
    let metric = TOP_MOVE_METRIC_OPTIONS[0]!.value
    for (let i = 0; i < TOP_MOVE_METRIC_OPTIONS.length; i++) metric = nextTopMoveMetric(metric)
    expect(metric).toBe(TOP_MOVE_METRIC_OPTIONS[0]!.value)
  })
})

describe('getPolicyHeatmapMetricLabel', () => {
  it('long (por defecto) devuelve el label largo', () => {
    expect(getPolicyHeatmapMetricLabel('policy')).toBe('Move probability')
  })

  it('short devuelve el shortLabel', () => {
    expect(getPolicyHeatmapMetricLabel('delta_score', 'short')).toBe('Score')
  })

  it('undefined usa el fallback al primer elemento', () => {
    expect(getPolicyHeatmapMetricLabel(undefined)).toBe(POLICY_HEATMAP_METRIC_OPTIONS[0]!.label)
  })
})

describe('nextPolicyHeatmapMetric', () => {
  it('avanza al siguiente elemento de la lista', () => {
    expect(nextPolicyHeatmapMetric('policy')).toBe('delta_score')
  })

  it('wrap-around: desde el último vuelve al primero', () => {
    const last = POLICY_HEATMAP_METRIC_OPTIONS[POLICY_HEATMAP_METRIC_OPTIONS.length - 1]!.value
    expect(nextPolicyHeatmapMetric(last)).toBe(POLICY_HEATMAP_METRIC_OPTIONS[0]!.value)
  })

  it('undefined hace findIndex=-1 y avanza a la opción 0 (mismo fallback que el original)', () => {
    expect(nextPolicyHeatmapMetric(undefined)).toBe(POLICY_HEATMAP_METRIC_OPTIONS[0]!.value)
  })
})
