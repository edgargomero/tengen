// @vitest-environment jsdom
//
// Test de componente de un presentacional YA EXISTENTE (no la extracción nueva): prueba que el harness
// jsdom generaliza más allá de `AnnotationEditor`. `GameReviewSummary` es presentación pura — recibe el
// histograma de calidad + precisión por fase ya derivados y los pinta. Cubre dos aristas: el retorno
// `null` cuando no hay jugadas, y el orden best-first con singular/plural correcto.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import { GameReviewSummary } from '../src/ui/GameReviewSummary'
import { QUALITY_CATEGORIES } from '../src/analysis/reviewSummary'
import type { PhasePrecision, QualityHistogramBin } from '../src/analysis/reviewSummary'
import type { Player } from '../src/analysis/vendor/web-katrain/types'
import type { GameReportPhase } from '../src/analysis/vendor/web-katrain/gameReport'

afterEach(cleanup)

/** Histograma index-aligned a `QUALITY_CATEGORIES` (worst-first: [0]=Blunder … [5]=Excelente). */
function histogram(counts: number[]): QualityHistogramBin[] {
  return QUALITY_CATEGORIES.map((category, i) => ({ category, count: counts[i] ?? 0 }))
}

const NO_PHASES: Record<GameReportPhase, PhasePrecision> = {
  opening: { meanPointsLost: 0, count: 0 },
  middleGame: { meanPointsLost: 0, count: 0 },
  endgame: { meanPointsLost: 0, count: 0 },
}

const emptyPhases: Record<Player, Record<GameReportPhase, PhasePrecision>> = {
  black: NO_PHASES,
  white: NO_PHASES,
}

describe('GameReviewSummary', () => {
  it('no renderiza nada si ningún jugador tiene jugadas analizadas', () => {
    const { container } = render(
      <GameReviewSummary
        qualityHistogram={{ black: histogram([]), white: histogram([]) }}
        phasePrecision={emptyPhases}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('pinta el jugador y sus categorías best-first, con singular/plural correcto', () => {
    // Negro: 1 Blunder (índice 0) + 2 Excelentes (índice 5); Blanco sin jugadas.
    render(
      <GameReviewSummary
        qualityHistogram={{ black: histogram([1, 0, 0, 0, 0, 2]), white: histogram([]) }}
        phasePrecision={emptyPhases}
      />,
    )
    expect(screen.getByText('Negro:')).toBeInTheDocument()
    expect(screen.getByText('2 Excelentes')).toBeInTheDocument() // plural
    expect(screen.getByText('1 Blunder')).toBeInTheDocument() // singular
    // Blanco (0 jugadas) se filtra entero.
    expect(screen.queryByText('Blanco:')).not.toBeInTheDocument()
  })
})
