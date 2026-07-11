/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/analysisSummary.ts (formatAnalysisWinRate/formatAnalysisScoreLead/
 * summarizePointsLost) Y src/utils/manualScore.ts (formatResultScoreLead — ver nota abajo).
 * Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 *
 * Decisión de adaptación: en el original, `formatAnalysisScoreLead` importa `formatResultScoreLead`
 * desde `manualScore.ts` (~100 líneas sobre puntaje manual desde ownership, ligado a Japanese
 * scoring). tengen NO usa esa vía (`Analysis.ownership` es siempre `undefined` hoy) y ese archivo
 * está fuera de alcance, así que NO se vendoriza completo: se porta SOLO `formatResultScoreLead`
 * (autocontenida, sin dependencias) dentro de este archivo, exportada por consistencia con el resto
 * de funciones de aquí.
 *
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */

// Origen: src/utils/manualScore.ts (formatResultScoreLead), NO de analysisSummary.ts.
export function formatResultScoreLead(scoreLead: number): string {
  const roundedScoreLead = Math.round(scoreLead * 10) / 10
  if (Object.is(roundedScoreLead, 0) || Object.is(roundedScoreLead, -0)) return 'Jigo'

  const leadingPlayer = roundedScoreLead > 0 ? 'B' : 'W'
  return `${leadingPlayer}+${Math.abs(roundedScoreLead).toFixed(1)}`
}

export function formatAnalysisWinRate(winRate: number | null | undefined): string {
  return typeof winRate === 'number' && Number.isFinite(winRate) ? `${(winRate * 100).toFixed(1)}%` : '-'
}

export function formatAnalysisScoreLead(scoreLead: number | null | undefined): string {
  return typeof scoreLead === 'number' && Number.isFinite(scoreLead) ? formatResultScoreLead(scoreLead) : '-'
}

export type PointsLostSummary = {
  label: string
  tone: 'success' | 'warning' | 'danger' | 'muted'
}

export function summarizePointsLost(pointsLost: number | null | undefined): PointsLostSummary {
  if (typeof pointsLost !== 'number' || !Number.isFinite(pointsLost)) {
    return { label: '-', tone: 'muted' }
  }

  const absolute = Math.abs(pointsLost)
  if (absolute < 0.05) return { label: 'Best', tone: 'success' }
  if (pointsLost < 0) return { label: `Gain ${absolute.toFixed(1)}`, tone: 'success' }
  if (pointsLost < 1) return { label: `Lost ${absolute.toFixed(1)}`, tone: 'warning' }
  return { label: `Lost ${absolute.toFixed(1)}`, tone: 'danger' }
}
