// Presentación del reloj de partida, compartida por Jugar (vs IA) y Online. Solo display: quien
// decide un timeout es siempre el ticker local (Jugar) o el Durable Object (Online).
import { applyElapsed } from '@tengen/engine/clock'
import type { ClockConfig, ClockState } from '@tengen/engine/types'

/** `mm:ss`, siempre 2 dígitos en ambos campos (`5:07` se ve como `05:07`). */
export function formatClockMs(ms: number): string {
  const totalSeconds = Math.max(Math.ceil(ms / 1000), 0)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export interface DisplayedClock {
  ms: number
  periodsRemaining: number
  inByoyomi: boolean
}

/** Lo que se muestra de un reloj tras `elapsedMs` de turno vivo (misma lógica que `applyElapsed`:
 * cruce de tiempo principal a byoyomi y períodos completos consumidos). Pura; nunca muta `state`. */
export function displayClock(state: ClockState, config: ClockConfig, elapsedMs: number): DisplayedClock {
  if (elapsedMs <= 0) {
    return {
      ms: state.inByoyomi ? config.byoyomiPeriodMs : state.mainTimeRemainingMs,
      periodsRemaining: state.byoyomiPeriodsRemaining,
      inByoyomi: state.inByoyomi,
    }
  }
  const { state: rolled } = applyElapsed(state, config, elapsedMs)
  if (!rolled.inByoyomi) {
    return { ms: rolled.mainTimeRemainingMs, periodsRemaining: rolled.byoyomiPeriodsRemaining, inByoyomi: false }
  }
  const period = config.byoyomiPeriodMs
  if (config.byoyomiPeriods === 0 || period <= 0) {
    return { ms: 0, periodsRemaining: rolled.byoyomiPeriodsRemaining, inByoyomi: false }
  }
  const inByoyomi = state.inByoyomi ? elapsedMs : elapsedMs - state.mainTimeRemainingMs
  const msInPeriod = period - (inByoyomi % period)
  return { ms: Math.max(msInPeriod, 0), periodsRemaining: rolled.byoyomiPeriodsRemaining, inByoyomi: true }
}
