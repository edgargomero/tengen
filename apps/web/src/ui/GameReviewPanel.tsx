// Panel del review de fondo de "Modo Analizar" (Fase 3a, Task 10): progreso (`GameAnalysisProgressSummary`,
// portado) + lista de saltos grandes (`getReportTurningPoints`, ya filtrados/ordenados por
// `GameReview`/`gameReport.ts`). Presentación pura: no posee `GameTree`/`AnalysisStore`/`GameReview`
// — solo recibe datos ya calculados y navega vía `onSelectEntry` al hacer clic.
import type { GameAnalysisProgressSummary, MoveReportEntry } from '../analysis/gameReview'
import { summarizePointsLost } from '../analysis/vendor/web-katrain/analysisSummary'

interface GameReviewPanelProps {
  progress: GameAnalysisProgressSummary | null
  turningPoints: MoveReportEntry[]
  onSelectEntry(entry: MoveReportEntry): void
}

export function GameReviewPanel({ progress, turningPoints, onSelectEntry }: GameReviewPanelProps) {
  return (
    <div class="review-panel">
      <p class="review-progress">
        {progress === null ? 'Analizando partida…' : `Review: ${progress.captionLabel}`}
      </p>
      {turningPoints.length === 0 ? (
        <p class="review-empty">Sin saltos grandes detectados todavía.</p>
      ) : (
        <ul class="review-turning-points">
          {turningPoints.map((entry) => {
            const summary = summarizePointsLost(entry.pointsLost)
            return (
              <li key={entry.moveNumber}>
                <button type="button" class={`review-entry tone-${summary.tone}`} onClick={() => onSelectEntry(entry)}>
                  {entry.moveNumber}. {entry.move} — {summary.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
