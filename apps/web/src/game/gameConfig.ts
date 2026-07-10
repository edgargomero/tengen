// Configuración de una partida del "Modo Jugar" (Fase 2) + su validación/normalización pura.
// Sin UI, sin motor: solo reglas de negocio sobre los parámetros que el usuario elige antes de
// empezar. validateConfig() es el único punto donde se sanea la config (normaliza handicap 1→0,
// clampa visits, y rechaza combinaciones no soportadas).
import type { BoardSize, NetworkId, RankLevel, Rules } from '@tengen/engine'

export interface GameConfig {
  boardSize: BoardSize
  komi: number
  rules: Rules
  /** 0 = sin handicap; 2..9 = piedras (solo 19×19). 1 se normaliza a 0 (solo komi, sin piedra). */
  handicap: number
  opponent: RankLevel
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

  // Task 13a: el motor asume visits >= 1; clampamos en vez de lanzar (normalización silenciosa).
  const opponent: RankLevel =
    c.opponent.kind === 'kata' && c.opponent.visits < 1
      ? { kind: 'kata', visits: 1 }
      : c.opponent

  return { boardSize: c.boardSize, komi: c.komi, rules: c.rules, handicap, opponent }
}

/**
 * Red neuronal que sirve a un oponente. Human SL exige una red con `meta_input` (solo humanv0);
 * el modo kata usa la red principal b18.
 */
export function networkForOpponent(opponent: RankLevel): NetworkId {
  return opponent.kind === 'human' ? 'humanv0' : 'b18'
}
