// Fase Aprender T5: refutación del motor ante una jugada fuera del árbol de solución.
//
// Reutiliza `ReviewScheduler.analyzePosition` con `priority:'interactive'` — NUNCA
// `EngineManager.analyze` directo, por el mismo criterio documentado en la cabecera de
// `analysis/guessAgainstEngine.ts`: el scheduler ya resuelve "visitas alcanzadas → completar" y la
// contención con cualquier análisis de fondo. Todos los análisis van bajo `group:'learn'`: la vista
// llama `scheduler.cancelGroup(LEARN_ANALYSIS_GROUP)` al cambiar de ejercicio o desmontar.
//
// VEREDICTO HONESTO: en puntos (misma matemática que `computeNodePointsLost` del vendor:
// pointsLost = signo(mover) × (scoreLead_antes − scoreLead_después), scoreLead siempre en
// perspectiva de Negro) y NUNCA `success` — sin ownership no se puede afirmar "el grupo muere/vive",
// solo cuánto costó la jugada según el motor.
import type { Position, StoneColor, Vertex } from '@tengen/engine'
import type { ReviewScheduler } from '../analysis/reviewScheduler'

export const LEARN_ANALYSIS_GROUP = 'learn'

/** Calibrado en T7 con motor real (Chrome/WebGPU, M1): a ~2.6 visitas/s, 64 visitas costaban
 *  ~25 s por análisis (~50 s el primer veredicto, que necesita baseline + posición nueva). Con 32
 *  (el mínimo real: CHUNK=32) y el baseline precalentado al montar (ver ExercisePlayer), el caso
 *  típico queda en UN análisis de ~12 s. Los gaps de un tsumego real son de 8–19 pts (medidos en
 *  el spot-check), así que el ruido de 32 visitas no cambia el veredicto warning/danger. */
export const REFUTE_VISITS = 32

/** Umbral de puntos para pasar de `warning` a `danger`. Se calibra en T7 con motor real. */
export const REFUTE_DANGER_POINTS = 6

/** Lo único que esta función necesita del scheduler (inyección estructural, testeable con mock). */
export type RefutationScheduler = Pick<ReviewScheduler, 'analyzePosition'>

export interface Refutation {
  /** Puntos que costó la jugada según el motor (positivo = perdió puntos quien jugó). */
  pointsLost: number
  /** scoreLead del baseline (posición previa) — la vista lo cachea por nodo para no re-analizar. */
  baselineScoreLead: number
  /** Mejor respuesta del rival tras la jugada (candidata más visitada); null si no hay candidatas. */
  bestReply: Vertex | null
  /** Nunca 'success': sin ownership el veredicto se limita a puntos. */
  verdict: { label: string; tone: 'warning' | 'danger' }
}

function formatPoints(p: number): string {
  const rounded = Math.round(p * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function verdictFor(pointsLost: number): Refutation['verdict'] {
  if (pointsLost >= REFUTE_DANGER_POINTS) {
    return {
      tone: 'danger',
      label: `Fuera de la solución: el motor castiga esa jugada — regala ~${formatPoints(pointsLost)} puntos.`,
    }
  }
  if (pointsLost >= 0.5) {
    return {
      tone: 'warning',
      label: `No es la línea de la solución: según el motor, esa jugada regala ~${formatPoints(pointsLost)} puntos.`,
    }
  }
  return {
    tone: 'warning',
    label: 'El motor no castiga esa jugada, pero no es la línea de la solución del ejercicio.',
  }
}

/**
 * Refuta una jugada fuera del árbol: baseline de la posición previa (o `cachedBaseline` si la vista
 * ya lo tiene para este nodo) + análisis tras la jugada → puntos perdidos + mejor respuesta del
 * rival. Puede rechazar si el análisis se cancela (cancelGroup/dispose): el caller decide si eso es
 * ruido (cambio de ejercicio) o error.
 */
export async function refuteOutOfTree(args: {
  scheduler: RefutationScheduler
  posBefore: Position
  posAfter: Position
  playedColor: StoneColor
  visits?: number
  cachedBaseline?: number
}): Promise<Refutation> {
  const visits = args.visits ?? REFUTE_VISITS
  const baselineScoreLead =
    args.cachedBaseline ??
    (
      await args.scheduler.analyzePosition({
        pos: args.posBefore,
        visits,
        priority: 'interactive',
        group: LEARN_ANALYSIS_GROUP,
      })
    ).scoreLead

  const after = await args.scheduler.analyzePosition({
    pos: args.posAfter,
    visits,
    priority: 'interactive',
    group: LEARN_ANALYSIS_GROUP,
  })

  const sign = args.playedColor === 'black' ? 1 : -1
  const pointsLost = sign * (baselineScoreLead - after.scoreLead)

  const best =
    after.moves.length > 0
      ? after.moves.reduce((top, candidate) => (candidate.visits > top.visits ? candidate : top))
      : null

  return {
    pointsLost,
    baselineScoreLead,
    bestReply: best ? best.vertex : null,
    verdict: verdictFor(pointsLost),
  }
}
