import { describe, expect, it } from 'vitest'
import { formatDuration, summarizeGameAnalysisProgress } from '../src/analysis/vendor/web-katrain/gameAnalysisProgress'

// ── formatDuration: 3 formatos, con y sin resto ─────────────────────────────────────────────

describe('formatDuration', () => {
  it('no finito o <=0 → null', () => {
    expect(formatDuration(NaN)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(-5)).toBeNull()
    expect(formatDuration(Infinity)).toBeNull()
  })

  it('segundos: redondea hacia arriba, mínimo 1s', () => {
    expect(formatDuration(500)).toBe('1s') // ceil(0.5s) = 1s, clamp a mínimo 1
    expect(formatDuration(1000)).toBe('1s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(59_000)).toBe('59s')
  })

  it('minutos: sin resto de segundos y con resto', () => {
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(90_000)).toBe('1m 30s')
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(59 * 60_000)).toBe('59m')
  })

  it('horas: sin resto de minutos y con resto', () => {
    expect(formatDuration(3_600_000)).toBe('1h')
    expect(formatDuration(3_600_000 + 5 * 60_000)).toBe('1h 5m')
    expect(formatDuration(2 * 3_600_000 + 30 * 60_000)).toBe('2h 30m')
  })
})

// ── summarizeGameAnalysisProgress ────────────────────────────────────────────────────────────

describe('summarizeGameAnalysisProgress', () => {
  it('total<=0 → null', () => {
    expect(summarizeGameAnalysisProgress({ done: 0, total: 0, startedAtMs: null, nowMs: 1000 })).toBeNull()
    expect(summarizeGameAnalysisProgress({ done: 0, total: -3, startedAtMs: null, nowMs: 1000 })).toBeNull()
  })

  it('done se clampea a total (nunca reporta más del 100%)', () => {
    const summary = summarizeGameAnalysisProgress({ done: 999, total: 10, startedAtMs: null, nowMs: 1000 })
    expect(summary).not.toBeNull()
    expect(summary!.countLabel).toBe('10/10')
    expect(summary!.percentLabel).toBe('100%')
  })

  it('ETA solo cuando 0<done<total Y startedAtMs es un número finito', () => {
    // done === 0: sin ETA aunque haya startedAtMs.
    expect(
      summarizeGameAnalysisProgress({ done: 0, total: 10, startedAtMs: 0, nowMs: 5000 })!.etaLabel
    ).toBeNull()
    // done === total: sin ETA (ya terminó).
    expect(
      summarizeGameAnalysisProgress({ done: 10, total: 10, startedAtMs: 0, nowMs: 5000 })!.etaLabel
    ).toBeNull()
    // startedAtMs null: sin ETA aunque 0<done<total.
    expect(
      summarizeGameAnalysisProgress({ done: 5, total: 10, startedAtMs: null, nowMs: 5000 })!.etaLabel
    ).toBeNull()
    // startedAtMs no finito (NaN): sin ETA.
    expect(
      summarizeGameAnalysisProgress({ done: 5, total: 10, startedAtMs: NaN, nowMs: 5000 })!.etaLabel
    ).toBeNull()
    // Caso con ETA real: 5/10 en 5000ms transcurridos → ritmo 1000ms/unidad → resta 5 unidades → 5000ms → "5s".
    expect(
      summarizeGameAnalysisProgress({ done: 5, total: 10, startedAtMs: 0, nowMs: 5000 })!.etaLabel
    ).toBe('5s')
  })

  it('labels exactos: countLabel, percentLabel, buttonLabel, captionLabel (con y sin ETA), title', () => {
    const withoutEta = summarizeGameAnalysisProgress({ done: 0, total: 4, startedAtMs: null, nowMs: 1000 })!
    expect(withoutEta.countLabel).toBe('0/4')
    expect(withoutEta.percentLabel).toBe('0%')
    expect(withoutEta.buttonLabel).toBe('0/4')
    expect(withoutEta.captionLabel).toBe('0/4 · 0%')
    expect(withoutEta.title).toBe('Game review progress: 0/4, 0%')
    expect(withoutEta.etaLabel).toBeNull()

    const withEta = summarizeGameAnalysisProgress({ done: 2, total: 4, startedAtMs: 0, nowMs: 4000 })!
    // 2/4 en 4000ms → ritmo 2000ms/unidad → resta 2 unidades → 4000ms → "4s".
    expect(withEta.countLabel).toBe('2/4')
    expect(withEta.percentLabel).toBe('50%')
    expect(withEta.buttonLabel).toBe('2/4')
    expect(withEta.etaLabel).toBe('4s')
    expect(withEta.captionLabel).toBe('2/4 · 50% · ETA 4s')
    expect(withEta.title).toBe('Game review progress: 2/4, 50%, ETA 4s')
  })

  it('done/total no finitos o negativos se tratan como 0 (finiteNonNegative)', () => {
    const summary = summarizeGameAnalysisProgress({ done: NaN, total: 10, startedAtMs: null, nowMs: 1000 })!
    expect(summary.countLabel).toBe('0/10')
  })
})
