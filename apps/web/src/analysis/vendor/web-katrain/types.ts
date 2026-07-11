/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/types.ts. Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 * Subconjunto TRIMMED: solo los campos que los archivos portados de analysis/vendor/web-katrain/
 * realmente leen (ver docs/research/fase-engine/adaptaciones-upstream.md para el detalle
 * campo-por-campo). El `GameSettings` completo, `BoardState`, temas de UI, etc. del original NO
 * se portan — tengen no tiene ese modelo de configuración.
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */

export type Player = 'black' | 'white'

export interface Move {
  x: number
  y: number
  player: Player
}

export interface CandidateMove {
  x: number
  y: number
  winRate: number // 0-1
  scoreLead: number
  visits: number
  pointsLost: number // relativo a la evaluación de la raíz (KaTrain-like)
  order: number // 0 = mejor jugada
  prior?: number // probabilidad de policy (0..1)
  pv?: string[] // variación principal, coords GTP (Task 4: gameReport.ts lee `top?.pv` verbatim)
}

export interface AnalysisResult {
  rootWinRate: number
  rootScoreLead: number
  rootVisits?: number
  moves: CandidateMove[]
}

export interface GameNode {
  move: Move | null
  parent: GameNode | null
  analysis?: AnalysisResult | null
}
