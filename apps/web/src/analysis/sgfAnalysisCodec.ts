// Convierte un `Analysis` cacheado (AnalysisStore) a/desde propiedades SGF propias de tengen —
// puente entre `game/sgf.ts` (dominio puro, no sabe qué es un "análisis") y el cache de análisis
// (Fase 6, spec 2026-07-15-analisis-persistido-sgf-design.md). Sin JSON: reusa la codificación de
// vértices de 2 letras que ya usa `vertexToSgf`/`sgfToVertex` — evita el escapeo que exigiría
// embeber JSON en el valor de una propiedad SGF (game/sgf.ts no lo maneja hoy).
//
// Solo se persiste winrate/scoreLead/visits a nivel raíz + la candidata más visitada (vértice +
// su pv completo, concatenados en UNA sola propiedad — el primer vértice de la secuencia ES la
// propia candidata) — NO las demás candidatas (arman el heatmap completo, que solo hace falta para
// la posición que se está mirando en ese momento; ver spec §Alcance) ni `ownership` (sin uso hoy).
import type { Analysis, MoveAnalysis, Vertex } from '@tengen/engine'
import { sgfToVertex, vertexToSgf } from '../game/sgf'

const WINRATE_PROP = 'TGW'
const SCORE_PROP = 'TGS'
const VISITS_PROP = 'TGN'
// Primer vértice = la propia candidata top; el resto = su continuación (`MoveAnalysis.pv`).
const TOP_PV_PROP = 'TGP'

/** "Candidata con más visitas" — mismo criterio que ya usa `AnalyzeView.tsx` para elegir `topMove`
 * (`reduce` por visitas, sin asumir `analysis.moves` pre-ordenado por el motor). */
function topCandidate(analysis: Analysis): MoveAnalysis | undefined {
  if (analysis.moves.length === 0) return undefined
  return analysis.moves.reduce((best, m) => (m.visits > best.visits ? m : best), analysis.moves[0]!)
}

/** Trunca en el primer pase o vértice fuera de tablero (mismo criterio que YA aplica
 * `buildPvSequence`/`overlays.ts` al DIBUJAR el pv) — nunca se inventa una codificación de "pase"
 * dentro de la secuencia concatenada. */
function truncateAtPass(sequence: Vertex[]): { x: number; y: number }[] {
  const usable: { x: number; y: number }[] = []
  for (const v of sequence) {
    if (v === 'pass') break
    usable.push(v)
  }
  return usable
}

/** Arma las propiedades SGF para un `Analysis` cacheado. Siempre incluye winrate/scoreLead/visits;
 * la secuencia (`TGP`) se omite si no hay candidata, o si la candidata top es un pase. */
export function encodeAnalysisForNode(analysis: Analysis): Record<string, string[]> {
  const data: Record<string, string[]> = {
    [WINRATE_PROP]: [analysis.winrate.toFixed(4)],
    [SCORE_PROP]: [analysis.scoreLead.toFixed(2)],
    [VISITS_PROP]: [String(analysis.visits)],
  }
  const top = topCandidate(analysis)
  if (top) {
    const sequence = truncateAtPass([top.vertex, ...top.pv])
    if (sequence.length > 0) {
      data[TOP_PV_PROP] = [sequence.map((v) => vertexToSgf(v)).join('')]
    }
  }
  return data
}

/**
 * Reconstruye un `Analysis` "degradado" (cero o un candidato en `moves`) desde las propiedades
 * leídas de un nodo SGF. `null` si el nodo no tenía winrate/scoreLead/visits válidos (nunca se
 * analizó, o datos corruptos/incompletos) — nunca lanza.
 */
export function decodeAnalysisFromNodeData(data: Record<string, string[]>): Analysis | null {
  const winrate = parseFloat(data[WINRATE_PROP]?.[0] ?? '')
  const scoreLead = parseFloat(data[SCORE_PROP]?.[0] ?? '')
  const visits = parseInt(data[VISITS_PROP]?.[0] ?? '', 10)
  if (!Number.isFinite(winrate) || !Number.isFinite(scoreLead) || !Number.isFinite(visits)) return null

  const moves: MoveAnalysis[] = []
  const pvRaw = data[TOP_PV_PROP]?.[0]
  if (pvRaw !== undefined && pvRaw.length >= 2 && pvRaw.length % 2 === 0) {
    const vertices: Vertex[] = []
    for (let i = 0; i < pvRaw.length; i += 2) vertices.push(sgfToVertex(pvRaw.slice(i, i + 2)))
    const [vertex, ...pv] = vertices
    moves.push({ vertex: vertex!, visits, winrate, scoreLead, prior: 0, pv })
  }

  return { winrate, scoreLead, scoreStdev: 0, visits, moves }
}
