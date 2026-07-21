// Resumen agregado del review de fondo de "Modo Analizar" (#6 del backlog UX): dos líneas compactas
// por jugador — histograma de calidad de jugada (best-first, con color por tono) y precisión media
// por fase de partida. Presentación PURA (modelo: `WinrateGraphPanel.tsx`): no posee
// `GameTree`/`AnalysisStore`/`GameReview` — recibe los datos ya derivados por `reviewSummary.ts`
// (`buildQualityHistogram`/`summarizePhasePrecision`) desde `AnalyzeView`.
import type { GameReportPhase } from '../analysis/vendor/web-katrain/gameReport'
import type { Player } from '../analysis/vendor/web-katrain/types'
import { PHASE_LABELS_ES } from '../analysis/reviewSummary'
import type { PhasePrecision, QualityHistogramBin } from '../analysis/reviewSummary'

interface GameReviewSummaryProps {
  qualityHistogram: Record<Player, QualityHistogramBin[]>
  phasePrecision: Record<Player, Record<GameReportPhase, PhasePrecision>>
}

const PLAYER_LABELS: Record<Player, string> = { black: 'Negro', white: 'Blanco' }
const PHASE_ORDER: GameReportPhase[] = ['opening', 'middleGame', 'endgame']

export function GameReviewSummary({ qualityHistogram, phasePrecision }: GameReviewSummaryProps) {
  const players: Player[] = ['black', 'white']
  const movesOf = (player: Player): number => qualityHistogram[player].reduce((sum, bin) => sum + bin.count, 0)

  // Nada que mostrar si ninguno de los dos jugadores tiene jugadas analizadas todavía.
  if (players.every((player) => movesOf(player) === 0)) return null

  return (
    <div class="review-summary">
      {players.map((player) => {
        if (movesOf(player) === 0) return null
        // Histograma best-first (Excelente primero) + sin buckets vacíos: la inversión de la
        // representación worst-first (index-aligned) vive aquí, en la capa de presentación.
        const quality = [...qualityHistogram[player]].reverse().filter((bin) => bin.count > 0)
        const phases = PHASE_ORDER.map((phase) => ({ phase, ...phasePrecision[player][phase] })).filter(
          (entry) => entry.count > 0,
        )
        return (
          <div class="review-summary-player" key={player}>
            <p class="review-summary-quality">
              <strong>{PLAYER_LABELS[player]}:</strong>{' '}
              {quality.map((bin, i) => (
                <span key={bin.category.label}>
                  {i > 0 ? ' · ' : ''}
                  <span class={`review-quality-badge tone-${bin.category.tone}`}>
                    {bin.count} {bin.count === 1 ? bin.category.label : bin.category.plural}
                  </span>
                </span>
              ))}
            </p>
            {phases.length > 0 && (
              <p class="review-summary-phases">
                {phases.map((entry) => `${PHASE_LABELS_ES[entry.phase]} ${entry.meanPointsLost.toFixed(1)}`).join(' · ')}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
