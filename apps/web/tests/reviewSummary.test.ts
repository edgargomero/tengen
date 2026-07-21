import { describe, expect, it } from 'vitest'
import {
  PHASE_LABELS_ES,
  QUALITY_CATEGORIES,
  buildQualityHistogram,
  qualityCategoryForPointsLost,
  summarizePhasePrecision,
} from '../src/analysis/reviewSummary'
import { DEFAULT_EVAL_THRESHOLDS, getEvaluationClass } from '../src/analysis/vendor/web-katrain/nodeAnalysis'
import { getPointLossBucket, type GameReport, type MoveReportEntry } from '../src/analysis/vendor/web-katrain/gameReport'

// ─────────────────────────────────────────────────────────────────────────────
// #6 del backlog UX: superficie datos de review YA computados. El riesgo central es la
// ALINEACIÓN entre el clasificador del badge (`getEvaluationClass`) y el del histograma
// (`getPointLossBucket`→`evaluationClass`): son funciones DISTINTAS que solo coinciden por
// compartir thresholds. El test las cruza en cada frontera para blindar esa coincidencia.
// ─────────────────────────────────────────────────────────────────────────────

// Patrón `mkEntry` copiado de gameReport.test.ts:24 — solo los campos que summarizePhasePrecision lee.
function mkEntry(overrides: Partial<MoveReportEntry> = {}): MoveReportEntry {
  return {
    node: { move: null, parent: null },
    moveNumber: 1,
    player: 'black',
    move: 'D4',
    pointsLost: 0,
    pointsGained: 0,
    scoreBefore: 0,
    scoreAfter: 0,
    scoreDelta: 0,
    scoreSwing: 0,
    winRateBefore: 0.5,
    winRateAfter: 0.5,
    winRateDelta: 0,
    winRateSwing: 0,
    phase: 'opening',
    ...overrides,
  }
}

describe('qualityCategoryForPointsLost', () => {
  // Fronteras elegidas para caer inequívocamente dentro de cada bucket (umbrales [12,6,3,1.5,0.5,0]).
  const cases: Array<[number, string]> = [
    [0.4, 'Excelente'], //   bucket 5, < 0.5
    [0.8, 'Buena'], //       bucket 4, 0.5–1.5
    [2, 'Imprecisión'], //   bucket 3, 1.5–3
    [4, 'Error'], //         bucket 2, 3–6
    [8, 'Error grave'], //   bucket 1, 6–12
    [20, 'Blunder'], //      bucket 0, ≥ 12
  ]

  for (const [pointsLost, label] of cases) {
    it(`${pointsLost} pts perdidos → ${label}`, () => {
      expect(qualityCategoryForPointsLost(pointsLost).label).toBe(label)
    })
  }

  it('el índice del badge coincide con el bucket del histograma en cada frontera (guarda histograma↔badge)', () => {
    // getEvaluationClass (badge) y getPointLossBucket→evaluationClass (histograma) son funciones
    // distintas; este assert cruzado impide que diverjan sin que nadie lo note.
    for (const [pointsLost] of cases) {
      const badgeIndex = getEvaluationClass(pointsLost)
      const histogramBucket = getPointLossBucket(pointsLost, [...DEFAULT_EVAL_THRESHOLDS])
      expect(badgeIndex).toBe(histogramBucket)
      // …y ese índice es el que indexa QUALITY_CATEGORIES para el badge.
      expect(QUALITY_CATEGORIES[badgeIndex]!.label).toBe(qualityCategoryForPointsLost(pointsLost).label)
    }
  })

  it('tonos: buckets 0-2 danger, 3 warning, 4-5 success', () => {
    expect(QUALITY_CATEGORIES.map((c) => c.tone)).toEqual([
      'danger',
      'danger',
      'danger',
      'warning',
      'success',
      'success',
    ])
  })
})

describe('buildQualityHistogram', () => {
  it('mapea el histograma (worst-first) a las etiquetas correctas por jugador', () => {
    // histogram[bucket] = { black, white }; bucket 0 = peor (Blunder), bucket 5 = mejor (Excelente).
    const report = {
      histogram: [
        { black: 1, white: 0 }, // [0] Blunder
        { black: 0, white: 2 }, // [1] Error grave
        { black: 3, white: 0 }, // [2] Error
        { black: 0, white: 1 }, // [3] Imprecisión
        { black: 5, white: 4 }, // [4] Buena
        { black: 7, white: 6 }, // [5] Excelente
      ],
    } as unknown as GameReport

    const hist = buildQualityHistogram(report)

    // Worst-first, index-aligned con QUALITY_CATEGORIES.
    expect(hist.black.map((b) => [b.category.label, b.count])).toEqual([
      ['Blunder', 1],
      ['Error grave', 0],
      ['Error', 3],
      ['Imprecisión', 0],
      ['Buena', 5],
      ['Excelente', 7],
    ])
    expect(hist.white.map((b) => [b.category.label, b.count])).toEqual([
      ['Blunder', 0],
      ['Error grave', 2],
      ['Error', 0],
      ['Imprecisión', 1],
      ['Buena', 4],
      ['Excelente', 6],
    ])
  })
})

describe('summarizePhasePrecision', () => {
  it('agrupa por (jugador, fase) y calcula la media de puntos perdidos y el conteo', () => {
    const entries = [
      mkEntry({ player: 'black', phase: 'opening', pointsLost: 1 }),
      mkEntry({ player: 'black', phase: 'opening', pointsLost: 3 }), // media apertura Negro = 2
      mkEntry({ player: 'black', phase: 'middleGame', pointsLost: 10 }),
      mkEntry({ player: 'white', phase: 'endgame', pointsLost: 0.5 }),
      mkEntry({ player: 'white', phase: 'endgame', pointsLost: 1.5 }), // media yose Blanco = 1
    ]

    const precision = summarizePhasePrecision(entries)

    expect(precision.black.opening).toEqual({ meanPointsLost: 2, count: 2 })
    expect(precision.black.middleGame).toEqual({ meanPointsLost: 10, count: 1 })
    expect(precision.white.endgame).toEqual({ meanPointsLost: 1, count: 2 })
  })

  it('fase sin jugadas → count 0 y meanPointsLost 0, nunca NaN (guard de 0/0)', () => {
    const precision = summarizePhasePrecision([mkEntry({ player: 'black', phase: 'opening', pointsLost: 4 })])

    expect(precision.black.endgame).toEqual({ meanPointsLost: 0, count: 0 })
    expect(precision.white.opening).toEqual({ meanPointsLost: 0, count: 0 })
    expect(Number.isNaN(precision.white.middleGame.meanPointsLost)).toBe(false)
  })

  it('etiquetas ES de las fases', () => {
    expect(PHASE_LABELS_ES).toEqual({ opening: 'Apertura', middleGame: 'Medio', endgame: 'Yose' })
  })
})
