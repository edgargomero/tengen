// Convierte el reloj de una partida (config fija + estado vivo por color) a/desde propiedades
// SGF — puente entre `game/sgf.ts` (dominio puro, no sabe qué es un "reloj") y
// `GameTree.meta.clock` (game/gameTree.ts). Usa propiedades ESTÁNDAR de SGF (FF[4]) donde existen
// (TM, BL, WL, OB, OW); solo agrega dos propias (prefijo TG, mismo criterio que
// `analysis/sgfAnalysisCodec.ts`) para la config de byoyomi, que el estándar solo cubre como texto
// libre (OT) sin estructura parseable.
//
// La config (TM/TGBP/TGBT) va en la RAÍZ; el estado vivo (BL/WL/OB/OW) va en el nodo ACTUAL al
// momento de guardar — en Modo Jugar el cursor vivo siempre está en el tip de la partida (ver
// `GameTree.isAtLiveTip`), así que no hace falta reconstruir el reloj navegando variaciones (fuera
// de alcance, ver spec 2026-07-16-reloj-partida-design.md §Alcance).
import type { ClockConfig, ClockState } from '@tengen/engine'

const MAIN_TIME_PROP = 'TM'
const BYOYOMI_PERIODS_PROP = 'TGBP'
const BYOYOMI_PERIOD_SECONDS_PROP = 'TGBT'
const BLACK_TIME_LEFT_PROP = 'BL'
const WHITE_TIME_LEFT_PROP = 'WL'
const BLACK_PERIODS_LEFT_PROP = 'OB'
const WHITE_PERIODS_LEFT_PROP = 'OW'

/** Config de reloj (raíz) → propiedades SGF. */
export function encodeClockConfig(config: ClockConfig): Record<string, string[]> {
  return {
    [MAIN_TIME_PROP]: [String(Math.round(config.mainTimeMs / 1000))],
    [BYOYOMI_PERIODS_PROP]: [String(config.byoyomiPeriods)],
    [BYOYOMI_PERIOD_SECONDS_PROP]: [String(Math.round(config.byoyomiPeriodMs / 1000))],
  }
}

/** Propiedades SGF (de la raíz) → config de reloj. `null` si faltan o son inválidas (nunca lanza). */
export function decodeClockConfig(data: Record<string, string[]>): ClockConfig | null {
  const mainTimeSec = parseFloat(data[MAIN_TIME_PROP]?.[0] ?? '')
  const periods = parseInt(data[BYOYOMI_PERIODS_PROP]?.[0] ?? '', 10)
  const periodSec = parseFloat(data[BYOYOMI_PERIOD_SECONDS_PROP]?.[0] ?? '')
  if (!Number.isFinite(mainTimeSec) || !Number.isFinite(periods) || !Number.isFinite(periodSec)) return null
  if (mainTimeSec < 0 || periods < 0 || periodSec < 0) return null
  return { mainTimeMs: mainTimeSec * 1000, byoyomiPeriods: periods, byoyomiPeriodMs: periodSec * 1000 }
}

/** Estado vivo del reloj (nodo actual) → propiedades SGF. */
export function encodeClockState(state: { black: ClockState; white: ClockState }): Record<string, string[]> {
  return {
    [BLACK_TIME_LEFT_PROP]: [(state.black.mainTimeRemainingMs / 1000).toFixed(1)],
    [WHITE_TIME_LEFT_PROP]: [(state.white.mainTimeRemainingMs / 1000).toFixed(1)],
    [BLACK_PERIODS_LEFT_PROP]: [String(state.black.byoyomiPeriodsRemaining)],
    [WHITE_PERIODS_LEFT_PROP]: [String(state.white.byoyomiPeriodsRemaining)],
  }
}

/**
 * Propiedades SGF → estado vivo del reloj. `null` si faltan o son inválidas (nunca lanza).
 * `inByoyomi` se DERIVA (`mainTimeRemainingMs <= 0`) — no es una propiedad separada: una vez que el
 * tiempo principal llega a 0 siempre se está en byoyomi, no hay estado intermedio ambiguo.
 */
export function decodeClockState(data: Record<string, string[]>): { black: ClockState; white: ClockState } | null {
  const blackMainSec = parseFloat(data[BLACK_TIME_LEFT_PROP]?.[0] ?? '')
  const whiteMainSec = parseFloat(data[WHITE_TIME_LEFT_PROP]?.[0] ?? '')
  const blackPeriods = parseInt(data[BLACK_PERIODS_LEFT_PROP]?.[0] ?? '', 10)
  const whitePeriods = parseInt(data[WHITE_PERIODS_LEFT_PROP]?.[0] ?? '', 10)
  if (![blackMainSec, whiteMainSec, blackPeriods, whitePeriods].every((n) => Number.isFinite(n))) return null
  if (blackMainSec < 0 || whiteMainSec < 0 || blackPeriods < 0 || whitePeriods < 0) return null
  return {
    black: {
      mainTimeRemainingMs: blackMainSec * 1000,
      byoyomiPeriodsRemaining: blackPeriods,
      inByoyomi: blackMainSec <= 0,
    },
    white: {
      mainTimeRemainingMs: whiteMainSec * 1000,
      byoyomiPeriodsRemaining: whitePeriods,
      inByoyomi: whiteMainSec <= 0,
    },
  }
}
