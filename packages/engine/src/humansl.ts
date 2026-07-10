// Archivo 100% de tengen (no adaptado de upstream). Lógica de selección de jugada de la red
// Human SL: temperatura por rango + muestreo de la policy humana sobre casillas legales + guarda
// de pase. Contrato de valores/decisiones: `fuentes.md §5`. Esta task NO ejecuta la red ONNX ni
// construye `meta_input` — eso es Task 12 (`LocalEngine`); acá solo se testea la lógica de
// muestreo con una policy sintética (`Float32Array` a mano).

import type { HumanRank, Move } from './types'
import { HUMAN_RANKS } from './types'
import type { GameState } from './encoding/gameState'
import { EMPTY } from './vendor/web-katrain/fastBoard'

// v1: temperatura fija por rango, calibrable. `fuentes.md §5` documenta que KataGo usa
// temperaturas que DECAEN durante la partida con halflife (5k 0.85→0.70, 9d 0.70→0.25); tengen v1
// usa una temperatura fija por rango (sin decaimiento por número de jugada) para simplificar el
// primer corte. La interpolación fina tipo PiklLambda/decay-por-jugada queda para calibración
// post-v1, cuando haya partidas reales con las que comparar.
const TEMP_20K = 0.85 // fuentes §5: kyu ≈ 0.85→0.70
const TEMP_9D = 0.3 // fuentes §5: dan alto ≈ 0.25–0.30

/** Temperatura de muestreo para un rango dado: interpolación lineal, decreciente de kyu a dan. */
export function rankTemperature(rank: HumanRank): number {
  const idx = HUMAN_RANKS.indexOf(rank) // 0 ('20k', más débil) .. 28 ('9d', más fuerte)
  return TEMP_20K - (TEMP_20K - TEMP_9D) * (idx / (HUMAN_RANKS.length - 1))
}

/**
 * Elige la jugada de la red Human SL para un rango dado, muestreando con temperatura sobre la
 * policy humana restringida a casillas legales (v1).
 *
 * Guarda de pase (`humanSLChosenMoveIgnorePass=true`, `fuentes.md §5`): `policyPass` se ignora
 * deliberadamente. En tengen el pase lo decide la lógica de fin de partida (comparación de score,
 * reglas de dos pases consecutivos, etc.), no la policy de la red humana — así que Human SL nunca
 * "decide" pasar por sí sola. Solo se devuelve pase si el tablero no tiene ninguna casilla
 * candidata (tablero lleno), como salvaguarda para no lanzar con un candidato inexistente.
 */
export function sampleHumanMove(args: {
  policy: Float32Array
  policyPass: number
  state: GameState
  rank: HumanRank
  rng: () => number
}): Move {
  const { policy, state, rank, rng } = args
  const N = state.boardSize
  const temp = rankTemperature(rank)

  // Máscara legal v1: vacía y no es el punto de ko. NO chequea suicidio (raro; la policy humana ya
  // le da probabilidad ≈0) — si se observa un problema en la práctica, refinar con
  // `computeLibertyMap` de fastBoard para excluir jugadas de suicidio real.
  const candidates: number[] = []
  const area = N * N
  for (let i = 0; i < area; i++) {
    if (state.stones[i] === EMPTY && i !== state.koPoint) candidates.push(i)
  }

  if (candidates.length === 0) {
    // Tablero lleno: no hay dónde jugar. `policyPass` se ignora igual (ver comentario de arriba).
    return { color: state.currentPlayer, vertex: 'pass' }
  }

  // Softmax con temperatura sobre las candidatas (estabilizado restando el máximo).
  let maxLogit = -Infinity
  for (const i of candidates) {
    const v = policy[i]! / temp
    if (v > maxLogit) maxLogit = v
  }
  const weights = new Float64Array(candidates.length)
  let total = 0
  for (let k = 0; k < candidates.length; k++) {
    const i = candidates[k]!
    const w = Math.exp(policy[i]! / temp - maxLogit)
    weights[k] = w
    total += w
  }

  const r = rng()
  let cdf = 0
  let chosen = candidates[candidates.length - 1]! // fallback si rng()===1.0 (o error de redondeo)
  for (let k = 0; k < candidates.length; k++) {
    cdf += weights[k]! / total
    if (r < cdf) {
      chosen = candidates[k]!
      break
    }
  }

  return { color: state.currentPlayer, vertex: { x: chosen % N, y: Math.floor(chosen / N) } }
}
