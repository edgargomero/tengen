import { describe, expect, it } from 'vitest'
import {
  formatAnalysisScoreLead,
  formatAnalysisWinRate,
  formatResultScoreLead,
  summarizePointsLost,
} from '../src/analysis/vendor/web-katrain/analysisSummary'

describe('formatAnalysisWinRate', () => {
  it('null → "-"', () => {
    expect(formatAnalysisWinRate(null)).toBe('-')
  })

  it('undefined → "-"', () => {
    expect(formatAnalysisWinRate(undefined)).toBe('-')
  })

  it('NaN → "-"', () => {
    expect(formatAnalysisWinRate(Number.NaN)).toBe('-')
  })

  it('0.5 → "50.0%"', () => {
    expect(formatAnalysisWinRate(0.5)).toBe('50.0%')
  })

  it('0.6789 → "67.9%" (redondeo a 1 decimal)', () => {
    expect(formatAnalysisWinRate(0.6789)).toBe('67.9%')
  })

  it('0 → "0.0%"', () => {
    expect(formatAnalysisWinRate(0)).toBe('0.0%')
  })
})

describe('formatAnalysisScoreLead', () => {
  it('null → "-"', () => {
    expect(formatAnalysisScoreLead(null)).toBe('-')
  })

  it('undefined → "-"', () => {
    expect(formatAnalysisScoreLead(undefined)).toBe('-')
  })

  it('Infinity → "-"', () => {
    expect(formatAnalysisScoreLead(Number.POSITIVE_INFINITY)).toBe('-')
  })

  it('delega en formatResultScoreLead para un número finito', () => {
    expect(formatAnalysisScoreLead(4.5)).toBe('B+4.5')
    expect(formatAnalysisScoreLead(-4.5)).toBe('W+4.5')
  })
})

describe('formatResultScoreLead', () => {
  it('0 exacto → "Jigo"', () => {
    expect(formatResultScoreLead(0)).toBe('Jigo')
  })

  it('-0 → "Jigo"', () => {
    expect(formatResultScoreLead(-0)).toBe('Jigo')
  })

  it('redondea a -0 (ej. -0.02) → "Jigo"', () => {
    expect(formatResultScoreLead(-0.02)).toBe('Jigo')
  })

  it('positivo → "B+<abs>"', () => {
    expect(formatResultScoreLead(5.5)).toBe('B+5.5')
  })

  it('negativo → "W+<abs>"', () => {
    expect(formatResultScoreLead(-5.5)).toBe('W+5.5')
  })

  it('redondea a 1 decimal antes de formatear', () => {
    expect(formatResultScoreLead(5.44)).toBe('B+5.4')
    expect(formatResultScoreLead(5.46)).toBe('B+5.5')
  })
})

describe('summarizePointsLost', () => {
  it('null → label "-", tone muted', () => {
    expect(summarizePointsLost(null)).toEqual({ label: '-', tone: 'muted' })
  })

  it('undefined → label "-", tone muted', () => {
    expect(summarizePointsLost(undefined)).toEqual({ label: '-', tone: 'muted' })
  })

  it('NaN → label "-", tone muted', () => {
    expect(summarizePointsLost(Number.NaN)).toEqual({ label: '-', tone: 'muted' })
  })

  it('|pointsLost| < 0.05 → "Best", tone success', () => {
    expect(summarizePointsLost(0.04)).toEqual({ label: 'Best', tone: 'success' })
    expect(summarizePointsLost(-0.04)).toEqual({ label: 'Best', tone: 'success' })
  })

  it('pointsLost negativo (ganancia), fuera del umbral Best → "Gain <abs>", tone success', () => {
    expect(summarizePointsLost(-2)).toEqual({ label: 'Gain 2.0', tone: 'success' })
  })

  it('0 < pointsLost < 1 → "Lost <abs>", tone warning', () => {
    expect(summarizePointsLost(0.5)).toEqual({ label: 'Lost 0.5', tone: 'warning' })
  })

  it('pointsLost >= 1 → "Lost <abs>", tone danger', () => {
    expect(summarizePointsLost(1)).toEqual({ label: 'Lost 1.0', tone: 'danger' })
    expect(summarizePointsLost(10)).toEqual({ label: 'Lost 10.0', tone: 'danger' })
  })
})
