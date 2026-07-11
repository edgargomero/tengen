/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/analysisCoverage.ts. Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 * Verbatim salvo el import de tipos, que apunta al `types.ts` TRIMMED de este mismo directorio
 * en vez del `types.ts` completo del original.
 * Verificación de dependencia (hallazgo 3 del plan de Fase 3a): este archivo NO depende de
 * `branchNavigation.ts` — su único import es `type { GameNode } from '../types'` en el original
 * (`./types` aquí). No hace falta adaptar ninguna noción de "rama activa".
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */
import type { GameNode } from './types'

export type AnalysisCoverageTone = 'empty' | 'partial' | 'complete'

export interface AnalysisCoverageSummary {
  analyzed: number
  total: number
  percent: number
  valueLabel: string
  stateLabel: string
  title: string
  tone: AnalysisCoverageTone
}

export function isReportReadyAnalysis(analysis: GameNode['analysis']): boolean {
  if (!analysis) return false
  if (!Number.isFinite(analysis.rootScoreLead) || !Number.isFinite(analysis.rootWinRate)) return false
  if (analysis.moves.length > 0) return true
  return typeof analysis.rootVisits === 'number' && Number.isFinite(analysis.rootVisits) && analysis.rootVisits > 1
}

export function summarizeAnalysisCoverage(
  nodes: readonly Pick<GameNode, 'analysis'>[],
  options: { isAnalyzed?: (node: Pick<GameNode, 'analysis'>) => boolean } = {}
): AnalysisCoverageSummary {
  const total = nodes.length
  const isAnalyzed = options.isAnalyzed ?? ((node: Pick<GameNode, 'analysis'>) => !!node.analysis)
  const analyzed = nodes.reduce((count, node) => count + (isAnalyzed(node) ? 1 : 0), 0)
  const percent = total > 0 ? analyzed / total : 0
  const tone: AnalysisCoverageTone =
    total === 0 || analyzed === 0 ? 'empty' : analyzed === total ? 'complete' : 'partial'
  const stateLabel =
    total === 0 ? 'No line' : analyzed === 0 ? 'No analysis' : analyzed === total ? 'Complete' : 'Partial'

  return {
    analyzed,
    total,
    percent,
    valueLabel: total > 0 ? `${analyzed}/${total}` : '-',
    stateLabel,
    title:
      total > 0
        ? `Analysis coverage for the current line: ${analyzed}/${total} positions.`
        : 'Analysis coverage is unavailable until a line is loaded.',
    tone,
  }
}
