import { describe, expect, it } from 'vitest'
import { smoothAnalysisGraphValues } from '../src/analysis/vendor/web-katrain/analysisSmoothing'

describe('smoothAnalysisGraphValues', () => {
  it('el primer valor no cambia (no hay previous)', () => {
    expect(smoothAnalysisGraphValues([10, 20])).toEqual([10, 15])
  })

  it('promedio simple entre valores consecutivos', () => {
    expect(smoothAnalysisGraphValues([0, 10, 20, 30])).toEqual([0, 5, 15, 25])
  })

  it('array vacío → array vacío', () => {
    expect(smoothAnalysisGraphValues([])).toEqual([])
  })

  it('un solo valor → se devuelve sin cambios', () => {
    expect(smoothAnalysisGraphValues([42])).toEqual([42])
  })

  it('valor actual no finito (NaN) se devuelve sin promediar', () => {
    expect(smoothAnalysisGraphValues([10, Number.NaN, 30])).toEqual([10, Number.NaN, 30])
  })

  it('previous no finito (NaN) se devuelve sin promediar', () => {
    const result = smoothAnalysisGraphValues([Number.NaN, 10])
    expect(result[0]).toBeNaN()
    expect(result[1]).toBe(10)
  })

  it('valores negativos se promedian igual', () => {
    expect(smoothAnalysisGraphValues([-10, -20, 0])).toEqual([-10, -15, -10])
  })
})
