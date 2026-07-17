// Reloj de partida (tiempo principal + byoyomi japonés) — módulo de dominio puro, sin dependencias
// de browser ni de red. Vive en packages/engine (no en apps/web) para que el futuro Durable Object
// de PvP lo reuse sin reescribir esta semántica — ver spec 2026-07-16-reloj-partida-design.md.
//
// Semántica de byoyomi japonés: mientras mainTimeRemainingMs > 0, cada jugada descuenta del pozo
// principal. Al agotarse, entra en byoyomi: cada jugada dispone de byoyomiPeriodMs. Si se juega
// DENTRO del período, se recicla completo (nunca se acumula ni se pierde). Si se EXCEDE, se
// consumen tantos períodos completos como quepan en el tiempo transcurrido — regla GENERAL, no un
// caso especial de "un período": es la misma fórmula que ejercita la extensión de la IA a 2
// períodos (ver packages/engine/src/search/timeManagementPolicy.ts).
import type { ClockConfig, ClockState } from '../types'

export interface ApplyElapsedResult {
  state: ClockState
  timedOut: boolean
}

/**
 * Estado inicial del reloj de un color al arrancar la partida, derivado de la config. Si
 * `mainTimeMs === 0`, arranca directo en byoyomi (partida "byoyomi desde la primera jugada").
 */
export function initialClockState(config: ClockConfig): ClockState {
  return {
    mainTimeRemainingMs: config.mainTimeMs,
    byoyomiPeriodsRemaining: config.byoyomiPeriods,
    inByoyomi: config.mainTimeMs <= 0,
  }
}

/**
 * Aplica `elapsedMs` transcurridos jugando UNA jugada al reloj de un color. No muta `state`:
 * devuelve el estado siguiente. `timedOut: true` si se consumieron más períodos de byoyomi de los
 * que quedaban (agotó el reloj) — o si no hay byoyomi configurado y el tiempo principal ya se agotó.
 */
export function applyElapsed(state: ClockState, config: ClockConfig, elapsedMs: number): ApplyElapsedResult {
  if (!state.inByoyomi) {
    const remaining = state.mainTimeRemainingMs - elapsedMs
    if (remaining > 0) {
      return { state: { ...state, mainTimeRemainingMs: remaining }, timedOut: false }
    }
    // Tiempo principal agotado en esta jugada: el excedente (-remaining) se resuelve como tiempo
    // YA transcurrido en byoyomi — arranca en él con lo que sobró de exceso.
    return applyElapsed(
      { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: state.byoyomiPeriodsRemaining, inByoyomi: true },
      config,
      -remaining,
    )
  }

  if (config.byoyomiPeriods === 0 || config.byoyomiPeriodMs <= 0) {
    // Sin byoyomi configurado ("solo tiempo principal"): cualquier tiempo en este estado es tiempo
    // de más → derrota inmediata por tiempo.
    return { state, timedOut: true }
  }

  const periodsConsumed = Math.floor(elapsedMs / config.byoyomiPeriodMs)
  if (periodsConsumed >= state.byoyomiPeriodsRemaining) {
    return { state: { ...state, byoyomiPeriodsRemaining: 0 }, timedOut: true }
  }
  return {
    state: {
      mainTimeRemainingMs: 0,
      byoyomiPeriodsRemaining: state.byoyomiPeriodsRemaining - periodsConsumed,
      inByoyomi: true,
    },
    timedOut: false,
  }
}
