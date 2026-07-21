// Configuración de una partida del "Modo Jugar" (Fase 2) + su validación/normalización pura.
// Sin UI, sin motor: solo reglas de negocio sobre los parámetros que el usuario elige antes de
// empezar. validateConfig() es el único punto donde se sanea la config (normaliza handicap 1→0,
// clampa visits, y rechaza combinaciones no soportadas).
import type { BoardSize, ClockConfig, NetworkId, RankLevel, Rules, StoneColor } from '@tengen/engine'

export interface GameConfig {
  boardSize: BoardSize
  komi: number
  rules: Rules
  /** 0 = sin handicap; 2..9 = piedras (solo 19×19). 1 se normaliza a 0 (solo komi, sin piedra). */
  handicap: number
  opponent: RankLevel
  /** Color CONCRETO que juega el humano (la IA juega el opuesto). Se resuelve UNA vez al empezar
   *  (ver `resolveHumanColor`, que colapsa la elección "nigiri" a negro/blanco) y viaja intacto por
   *  el SGF (`meta.humanColor` → `TGHC`), así una recarga NO re-sortea. Con handicap≥2 `validateConfig`
   *  lo fuerza a 'black' (el humano toma el handicap). Default histórico = 'black'. */
  humanColor: StoneColor
  /** Reloj de partida (tiempo principal + byoyomi japonés), opcional — ausente = "sin reloj" (el
   *  comportamiento de siempre). Ver spec 2026-07-16-reloj-partida-design.md. */
  clock?: ClockConfig
}

/** Elección de color en el formulario de nueva partida: negro/blanco fijos, o `nigiri` (al azar).
 *  `resolveHumanColor` la colapsa a un `StoneColor` concreto en el submit. */
export type HumanColorChoice = 'black' | 'white' | 'nigiri'

/** Colapsa la elección del formulario a un color concreto. El `nigiri` sortea con `rng` (inyectable
 *  para tests deterministas): `< 0.5 → black`, `>= 0.5 → white`. ÚNICO punto de aleatoriedad del
 *  feature; separado de la UI para poder testearlo puro. */
export function resolveHumanColor(choice: HumanColorChoice, rng: () => number = Math.random): StoneColor {
  if (choice === 'nigiri') return rng() < 0.5 ? 'black' : 'white'
  return choice
}

/** Color opuesto (helper trivial reutilizado por `PlayView` para derivar el color de la IA). */
export function oppositeColor(c: StoneColor): StoneColor {
  return c === 'black' ? 'white' : 'black'
}

/**
 * Devuelve una GameConfig normalizada (objeto nuevo, no muta la entrada) o lanza con un mensaje
 * claro si la configuración no es soportada. Normalizaciones aplicadas:
 *   - handicap 1 → 0 (handicap 1 en Go = "solo komi, sin piedra de ventaja"; sin piedras que colocar).
 *   - opponent kata con visits < 1 → visits 1 (Task 13a: el motor asume visits >= 1).
 * Rechazos (throw):
 *   - handicap no entero, negativo, o > 9.
 *   - M-4: handicap > 1 fuera de 19×19 (los hoshi de handicap solo están definidos en 19×19).
 *   - komi no finito (NaN / Infinity). Reverse komi (negativo) y komi 0 SON válidos.
 */
export function validateConfig(c: GameConfig): GameConfig {
  if (!Number.isFinite(c.komi)) {
    throw new Error(`komi debe ser finito (recibido: ${c.komi})`)
  }

  if (!Number.isInteger(c.handicap) || c.handicap < 0 || c.handicap > 9) {
    throw new Error(`handicap debe ser un entero entre 0 y 9 (recibido: ${c.handicap})`)
  }

  // handicap 1 = "solo komi, sin piedra": equivalente a 0 a efectos de colocación y turno.
  const handicap = c.handicap === 1 ? 0 : c.handicap

  // M-4: los hoshi de handicap solo están definidos en 19×19 (deuda del motor a nivel app).
  if (handicap > 1 && c.boardSize !== 19) {
    throw new Error(`handicap >1 solo soportado en 19×19 (boardSize: ${c.boardSize})`)
  }

  // Color del humano: con handicap≥2 queda FORZADO a negro (el humano toma las piedras de handicap =
  // Negro; el nigiri solo aplica a partidas igualadas). Sin handicap, se respeta la elección ya
  // resuelta (`?? 'black'` cubre datos legacy sin el campo — p.ej. un SGF viejo sin `TGHC`).
  const humanColor: StoneColor = handicap >= 2 ? 'black' : (c.humanColor ?? 'black')

  // Task 13a: el motor asume visits >= 1; clampamos en vez de lanzar (normalización silenciosa).
  const opponent: RankLevel =
    c.opponent.kind === 'kata' && c.opponent.visits < 1
      ? { kind: 'kata', visits: 1 }
      : c.opponent

  // Reloj (Fase reloj, 2026-07-16): a diferencia de visits, un reloj mal configurado NO se
  // normaliza en silencio — es una decisión explícita del usuario en el formulario, un valor
  // inválido ahí es un bug de UI, no algo a "arreglar" silenciosamente.
  if (c.clock !== undefined) {
    const { mainTimeMs, byoyomiPeriods, byoyomiPeriodMs } = c.clock
    if (!Number.isFinite(mainTimeMs) || mainTimeMs < 0) {
      throw new Error(`clock.mainTimeMs debe ser finito y >= 0 (recibido: ${mainTimeMs})`)
    }
    if (!Number.isInteger(byoyomiPeriods) || byoyomiPeriods < 0) {
      throw new Error(`clock.byoyomiPeriods debe ser un entero >= 0 (recibido: ${byoyomiPeriods})`)
    }
    if (!Number.isFinite(byoyomiPeriodMs) || byoyomiPeriodMs < 0) {
      throw new Error(`clock.byoyomiPeriodMs debe ser finito y >= 0 (recibido: ${byoyomiPeriodMs})`)
    }
    if (mainTimeMs === 0 && byoyomiPeriods === 0) {
      throw new Error('clock: mainTimeMs=0 y byoyomiPeriods=0 juntos perderían la partida al instante')
    }
  }

  return {
    boardSize: c.boardSize,
    komi: c.komi,
    rules: c.rules,
    handicap,
    opponent,
    humanColor,
    ...(c.clock !== undefined ? { clock: c.clock } : {}),
  }
}

/**
 * Red neuronal que sirve a un oponente. Human SL exige una red con `meta_input` (solo humanv0);
 * el modo kata usa la red principal b18.
 */
export function networkForOpponent(opponent: RankLevel): NetworkId {
  return opponent.kind === 'human' ? 'humanv0' : 'b18'
}
