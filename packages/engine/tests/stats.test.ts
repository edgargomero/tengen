import { describe, expect, it } from 'vitest'
import { summarize } from '../src/bench/stats'

describe('summarize', () => {
  it('calcula mediana, percentiles e inf/s con batch 1', () => {
    const s = summarize([100, 110, 90, 105, 95], 1)
    expect(s.runs).toBe(5)
    expect(s.medianMs).toBe(100)
    // percentiles con interpolación lineal: idx p10 = 0.4 → 90+0.4·5; idx p90 = 3.6 → 105+0.6·5
    expect(s.p10Ms).toBeCloseTo(92, 6)
    expect(s.p90Ms).toBeCloseTo(108, 6)
    expect(s.infPerSec).toBeCloseTo(10, 5)
  })
  it('escala inf/s por el batch', () => {
    const s = summarize([200, 200, 200], 8)
    expect(s.infPerSec).toBeCloseTo(40, 5)
  })
  it('mediana de cantidad par promedia los centrales', () => {
    const s = summarize([10, 20, 30, 40], 1)
    expect(s.medianMs).toBe(25)
  })
  it('rechaza entradas vacías', () => {
    expect(() => summarize([], 1)).toThrow()
  })
})
