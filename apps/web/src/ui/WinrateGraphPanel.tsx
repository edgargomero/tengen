// Gráfico de winrate de "Modo Analizar" (Fase 3a, Task 10). Presentación pura: SVG minimal sin
// librería nueva, sobre datos ya calculados por `winrateGraphData.ts` (Task 8). No posee `GameTree`
// ni `AnalysisStore` — solo recibe `points` y navega vía `onSelectPoint` al hacer clic.
//
// Decisión de alcance deliberada: grafica SOLO `winrate` (perspectiva Negro, eje Y 0..1, línea de
// referencia en 50%). `WinrateGraphPoint.scoreLead` está disponible en los mismos datos pero NO se
// grafica — el panel de texto winrate/score de Task 9 ya muestra el score de la posición actual;
// graficar ambas series es una mejora futura razonable, no pedida por el plan ("gráfico de
// winrate", singular).
import type { WinrateGraphPoint } from '../analysis/winrateGraphData'

interface WinrateGraphPanelProps {
  points: WinrateGraphPoint[]
  /** Longitud total de `tree.mainLine()` — fija el dominio del eje X aunque el review de fondo
   * todavía no haya analizado todas las jugadas (efecto "se va llenando" mientras progresa). */
  totalMoves: number
  currentNodeId: number
  onSelectPoint(point: WinrateGraphPoint): void
}

const WIDTH = 300
const HEIGHT = 100

export function WinrateGraphPanel({ points, totalMoves, currentNodeId, onSelectPoint }: WinrateGraphPanelProps) {
  if (points.length === 0) {
    return (
      <div class="review-graph">
        <p class="review-graph-empty">Sin datos de winrate todavía.</p>
      </div>
    )
  }

  const maxMove = Math.max(totalMoves, 1)
  const x = (moveNumber: number): number => (moveNumber / maxMove) * WIDTH
  const y = (winrate: number): number => HEIGHT - winrate * HEIGHT // Negro 100% → arriba, 0% → abajo

  const polylinePoints = points.map((p) => `${x(p.moveNumber)},${y(p.winrate)}`).join(' ')

  return (
    <div class="review-graph">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} class="review-graph-svg" role="img" aria-label="Gráfico de winrate">
        <line x1={0} y1={HEIGHT / 2} x2={WIDTH} y2={HEIGHT / 2} class="review-graph-midline" />
        <polyline points={polylinePoints} class="review-graph-line" fill="none" />
        {points.map((p) => (
          <circle
            key={p.nodeId}
            cx={x(p.moveNumber)}
            cy={y(p.winrate)}
            r={p.nodeId === currentNodeId ? 3 : 1.5}
            class={p.nodeId === currentNodeId ? 'review-graph-point-current' : 'review-graph-point'}
            onClick={() => onSelectPoint(p)}
          />
        ))}
      </svg>
    </div>
  )
}
