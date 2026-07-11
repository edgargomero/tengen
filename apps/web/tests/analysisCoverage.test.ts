import { describe, expect, it } from 'vitest'
import {
  isReportReadyAnalysis,
  summarizeAnalysisCoverage,
} from '../src/analysis/vendor/web-katrain/analysisCoverage'
import type { AnalysisResult, GameNode } from '../src/analysis/vendor/web-katrain/types'

function mkAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return { rootWinRate: 0.5, rootScoreLead: 1, moves: [], ...overrides }
}

describe('isReportReadyAnalysis', () => {
  it('sin analysis (undefined) → false', () => {
    expect(isReportReadyAnalysis(undefined)).toBe(false)
  })

  it('analysis null → false', () => {
    expect(isReportReadyAnalysis(null)).toBe(false)
  })

  it('rootScoreLead no finito (NaN) → false', () => {
    expect(isReportReadyAnalysis(mkAnalysis({ rootScoreLead: Number.NaN }))).toBe(false)
  })

  it('rootWinRate no finito (Infinity) → false', () => {
    expect(isReportReadyAnalysis(mkAnalysis({ rootWinRate: Number.POSITIVE_INFINITY }))).toBe(false)
  })

  it('moves.length > 0 → true (aunque no haya rootVisits)', () => {
    expect(
      isReportReadyAnalysis(
        mkAnalysis({ moves: [{ x: 0, y: 0, winRate: 0.5, scoreLead: 0, visits: 1, pointsLost: 0, order: 0 }] })
      )
    ).toBe(true)
  })

  it('sin moves pero rootVisits > 1 → true', () => {
    expect(isReportReadyAnalysis(mkAnalysis({ moves: [], rootVisits: 2 }))).toBe(true)
  })

  it('sin moves y rootVisits <= 1 → false', () => {
    expect(isReportReadyAnalysis(mkAnalysis({ moves: [], rootVisits: 1 }))).toBe(false)
  })

  it('sin moves y sin rootVisits → false', () => {
    expect(isReportReadyAnalysis(mkAnalysis({ moves: [] }))).toBe(false)
  })
})

describe('summarizeAnalysisCoverage', () => {
  it('0 nodos → tone empty, valueLabel "-", stateLabel "No line"', () => {
    const summary = summarizeAnalysisCoverage([])
    expect(summary).toEqual({
      analyzed: 0,
      total: 0,
      percent: 0,
      valueLabel: '-',
      stateLabel: 'No line',
      title: 'Analysis coverage is unavailable until a line is loaded.',
      tone: 'empty',
    })
  })

  it('nodos presentes pero ninguno analizado → tone empty, stateLabel "No analysis"', () => {
    const nodes: Array<Pick<GameNode, 'analysis'>> = [{ analysis: undefined }, { analysis: undefined }]
    const summary = summarizeAnalysisCoverage(nodes)
    expect(summary.tone).toBe('empty')
    expect(summary.stateLabel).toBe('No analysis')
    expect(summary.analyzed).toBe(0)
    expect(summary.total).toBe(2)
    expect(summary.valueLabel).toBe('0/2')
    expect(summary.title).toBe('Analysis coverage for the current line: 0/2 positions.')
  })

  it('todos analizados → tone complete, stateLabel "Complete"', () => {
    const nodes: Array<Pick<GameNode, 'analysis'>> = [{ analysis: mkAnalysis() }, { analysis: mkAnalysis() }]
    const summary = summarizeAnalysisCoverage(nodes)
    expect(summary.tone).toBe('complete')
    expect(summary.stateLabel).toBe('Complete')
    expect(summary.analyzed).toBe(2)
    expect(summary.total).toBe(2)
    expect(summary.percent).toBe(1)
    expect(summary.valueLabel).toBe('2/2')
  })

  it('algunos analizados → tone partial, stateLabel "Partial"', () => {
    const nodes: Array<Pick<GameNode, 'analysis'>> = [{ analysis: mkAnalysis() }, { analysis: undefined }]
    const summary = summarizeAnalysisCoverage(nodes)
    expect(summary.tone).toBe('partial')
    expect(summary.stateLabel).toBe('Partial')
    expect(summary.analyzed).toBe(1)
    expect(summary.total).toBe(2)
    expect(summary.percent).toBe(0.5)
    expect(summary.valueLabel).toBe('1/2')
  })

  it('isAnalyzed custom override sustituye el criterio por defecto (!!node.analysis)', () => {
    const nodes: Array<Pick<GameNode, 'analysis'>> = [{ analysis: mkAnalysis({ rootVisits: 1 }) }, { analysis: mkAnalysis({ rootVisits: 50 }) }]
    const summary = summarizeAnalysisCoverage(nodes, {
      isAnalyzed: (node) => (node.analysis?.rootVisits ?? 0) > 10,
    })
    expect(summary.analyzed).toBe(1)
    expect(summary.total).toBe(2)
    expect(summary.tone).toBe('partial')
  })
})
