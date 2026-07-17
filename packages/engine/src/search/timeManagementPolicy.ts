// Política de gestión de tiempo de la IA bajo reloj (Opción B del brainstorm: gestión adaptativa —
// corta antes por convergencia, extiende una vez en posiciones difíciles). Función PURA — nunca lee
// el reloj real (ni Date.now() ni performance.now()): recibe datos ya calculados y devuelve una
// decisión. Esto es DELIBERADO (spec 2026-07-16-reloj-partida-design.md §Determinismo y testing):
// separa "decidir" (determinista, testeable con fixtures escritos a mano) de "leer el reloj" (no
// determinista entre máquinas). NO agregar ninguna lectura de reloj real acá — el lector se inyecta
// en el caller (packages/engine/src/engine.ts), mismo patrón que `evaluatorFactory` en `LocalEngine`.
import type { ClockConfig, ClockState } from '../types'

/** Jugadas restantes asumidas para repartir el tiempo principal — constante FIJA y GLOBAL, no varía
 *  por tamaño de tablero ni por fase de la partida (v1, punto de partida no definitivo — ver spec
 *  §Fuera de alcance). Se autocorrige porque `mainTimeRemainingMs` decrece con el juego. */
const MOVES_LEFT_ESTIMATE = 40
const MIN_BUDGET_MS = 1000
/** Margen de seguridad en byoyomi: no confiar en que un chunk termine justo en el límite del período. */
const BYOYOMI_SAFETY_FACTOR = 0.85
/** ±2%: cuánto puede variar la participación de visitas de la jugada top entre 2 chunks para
 *  considerarla "convergida". */
const CONVERGENCE_VISIT_SHARE_DELTA = 0.02
/** No cortar por convergencia antes de usar al menos 25% del presupuesto — evita cortes prematuros
 *  con muy poca info. */
const CONVERGENCE_MIN_BUDGET_FRACTION = 0.25
/** Diferencia de winrate (escala 0-1) entre las 2 mejores jugadas por debajo de la cual se
 *  considera "posición difícil" y amerita extender el presupuesto. */
const VALUE_GAP_EPSILON = 0.05
const EXTENSION_MULTIPLIER = 1.5

/** Presupuesto base (ms) para la jugada actual, antes de convergencia/extensión. */
export function computeBaseBudgetMs(config: ClockConfig, state: ClockState): number {
  if (state.inByoyomi) return config.byoyomiPeriodMs * BYOYOMI_SAFETY_FACTOR
  return Math.max(state.mainTimeRemainingMs / MOVES_LEFT_ESTIMATE, MIN_BUDGET_MS)
}

export interface TimeManagementInput {
  /** Tiempo transcurrido desde que arrancó la búsqueda de ESTA jugada. */
  elapsedMsSoFar: number
  /** Presupuesto vigente (puede haber sido extendido una vez — ver `alreadyExtended`). */
  budgetMs: number
  /** Participación (0-1) de la jugada con más visitas, un valor por chunk transcurrido, en orden. */
  visitShareHistory: number[]
  /** Diferencia de winrate entre las 2 mejores jugadas en el chunk actual (1 si hay <2 candidatas). */
  valueGap: number
  /** true si esta jugada ya recibió una extensión (nunca se concede una segunda). */
  alreadyExtended: boolean
  /** true si el reloj está actualmente en byoyomi para esta jugada. */
  inByoyomi: boolean
  /** Duración configurada del período de byoyomi (solo relevante si `inByoyomi`). */
  byoyomiPeriodMs: number
  /** Períodos restantes en el pool de este color (solo relevante si `inByoyomi`). */
  byoyomiPeriodsRemaining: number
}

export type TimeManagementDecision = 'stop' | 'continue' | { extendTo: number }

export function timeManagementPolicy(input: TimeManagementInput): TimeManagementDecision {
  const {
    elapsedMsSoFar,
    budgetMs,
    visitShareHistory,
    valueGap,
    alreadyExtended,
    inByoyomi,
    byoyomiPeriodMs,
    byoyomiPeriodsRemaining,
  } = input

  if (elapsedMsSoFar < budgetMs) {
    const enoughHistory = visitShareHistory.length >= 2
    const usedEnoughBudget = elapsedMsSoFar >= budgetMs * CONVERGENCE_MIN_BUDGET_FRACTION
    if (enoughHistory && usedEnoughBudget) {
      const last = visitShareHistory[visitShareHistory.length - 1]!
      const prev = visitShareHistory[visitShareHistory.length - 2]!
      if (Math.abs(last - prev) <= CONVERGENCE_VISIT_SHARE_DELTA) return 'stop'
    }
    return 'continue'
  }

  if (!alreadyExtended && valueGap < VALUE_GAP_EPSILON) {
    if (inByoyomi) {
      // "Quemar un período extra" (spec): usar 2 períodos completos para esta jugada en vez del
      // multiplicador genérico — tope duro, nunca más de 2, clampeado por lo que realmente queda.
      const periods = Math.min(2, byoyomiPeriodsRemaining)
      return { extendTo: periods * byoyomiPeriodMs }
    }
    return { extendTo: budgetMs * EXTENSION_MULTIPLIER }
  }
  return 'stop'
}
