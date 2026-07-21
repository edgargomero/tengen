// Panel del review de fondo de "Modo Analizar" (Fase 3a, Task 10): progreso (`GameAnalysisProgressSummary`,
// portado) + lista de saltos grandes (`getReportTurningPoints`, ya filtrados/ordenados por
// `GameReview`/`gameReport.ts`). Presentación pura: no posee `GameTree`/`AnalysisStore`/`GameReview`
// — solo recibe datos ya calculados y navega vía `onSelectEntry` al hacer clic.
import type { GameAnalysisProgressSummary, MoveReportEntry } from '../analysis/gameReview'
import { qualityCategoryForPointsLost } from '../analysis/reviewSummary'

interface GameReviewPanelProps {
  progress: GameAnalysisProgressSummary | null
  turningPoints: MoveReportEntry[]
  /** Turning point más cercano antes/después de la posición actual (`undefined` = no hay en esa
   * dirección) — ya resuelto por el caller (`AnalyzeView`, que es quien conoce `tree`). */
  prevMistake?: MoveReportEntry
  nextMistake?: MoveReportEntry
  onSelectEntry(entry: MoveReportEntry): void
}

export function GameReviewPanel({
  progress,
  turningPoints,
  prevMistake,
  nextMistake,
  onSelectEntry,
}: GameReviewPanelProps) {
  return (
    <div class="review-panel">
      <p class="review-progress">
        {progress === null ? 'Analizando partida…' : `Review: ${progress.captionLabel}`}
      </p>
      <div class="play-nav">
        <button type="button" onClick={() => prevMistake && onSelectEntry(prevMistake)} disabled={!prevMistake}>
          ◀ Error anterior
        </button>
        <button type="button" onClick={() => nextMistake && onSelectEntry(nextMistake)} disabled={!nextMistake}>
          Error siguiente ▶
        </button>
      </div>
      {turningPoints.length === 0 ? (
        <p class="review-empty">Sin saltos grandes detectados todavía.</p>
      ) : (
        <ul class="review-turning-points">
          {turningPoints.map((entry) => {
            // El COLOR y la etiqueta salen del clasificador único de calidad (pérdida de puntos),
            // el mismo que alimenta el histograma agregado — nunca de `summarizePointsLost` (que
            // corta en 1.0, no en los buckets 0.5/1.5, y discreparía del agregado).
            const category = qualityCategoryForPointsLost(entry.pointsLost)
            // Los turning points se filtran por `scoreSwing`, NO por pérdida: un swing a favor del
            // que jugó llega con `pointsLost≈0` (categoría Excelente). Solo se muestra el número si
            // la pérdida es significativa (mismo umbral que "Best" de summarizePointsLost), para no
            // pintar "Excelente (−0.0)".
            const lost = entry.pointsLost >= 0.05 ? ` (−${entry.pointsLost.toFixed(1)})` : ''
            return (
              <li key={entry.moveNumber}>
                <button type="button" class={`review-entry tone-${category.tone}`} onClick={() => onSelectEntry(entry)}>
                  {entry.moveNumber}. {entry.move} — {category.label}
                  {lost}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
