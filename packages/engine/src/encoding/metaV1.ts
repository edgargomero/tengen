/*
 * meta_input[1,192] de Human SL — encoding original de tengen (no viene de web-katrain).
 *
 * Layout e índices tomados de `docs/research/fase-engine/fuentes.md §2`, que a su vez destila
 * `sgfmetadata.cpp`/`sgfmetadata.py` de KataGo (AGPL). Este archivo es una reimplementación
 * INDEPENDIENTE a partir de esa especificación en español — no se copió ni se tradujo código de
 * `sgfmetadata.py`/`.cpp`. El golden de validación (`tests/fixtures/meta/*.json`) se generó
 * ejecutando el `sgfmetadata.py` real de katago-onnx como herramienta local (igual que
 * `scripts/convert-humanv0.py`), nunca se copió su código aquí.
 *
 * Perfil fijo implementado: `preaz_<rank>` (el que usan los configs oficiales de KataGo para
 * humanSLProfile) — ambos jugadores humanos, mismo rango, "rated" desconocido, byo-yomi
 * 1200s + 30s × 5 períodos, fuente KGS, fecha 2016-09-01 (pre-AlphaZero).
 */

import { HUMAN_RANKS, type HumanRank } from '../types'

export const META_CHANNELS = 192

const RANK_START = 6
const RANK_LEN_PER_PLAYER = 34
const RATED_IDX = 74
const TC_BYOYOMI_IDX = 79
const MAIN_TIME_IDX = 82
const PERIOD_TIME_IDX = 83
const BYOYOMI_PERIODS_IDX = 84
const CANADIAN_MOVES_IDX = 85
const BOARD_AREA_IDX = 86
const DATE_START = 87
const DATE_LEN = 32
const SOURCE_START = 151
const SOURCE_KGS = 2 // 0=KataGo selfplay, 1=OGS, 2=KGS, 3=Fox, 4=Tygem, 5=GoGoD, 6=Go4Go

// Perfil `preaz_`: valores fijos del time control y la fecha (fuentes.md §2).
const PREAZ_MAIN_TIME_SECONDS = 1200
const PREAZ_PERIOD_TIME_SECONDS = 30
const PREAZ_BYOYOMI_PERIODS = 5
const PREAZ_CANADIAN_MOVES = 0 // no aplica a byo-yomi, pero la fórmula [85] se calcula igual
const PREAZ_DATE_DAYS = daysSinceEpoch(2016, 9, 1)

/** Días entre 1970-01-01 y la fecha dada, en UTC (mismo epoch que usa KataGo). */
function daysSinceEpoch(year: number, month1to12: number, day: number): number {
  const ms = Date.UTC(year, month1to12 - 1, day) - Date.UTC(1970, 0, 1)
  return ms / 86_400_000
}

/**
 * `inverseRank`: 9d=1, 8d=2, …, 1d=9, 1k=10, 2k=11, …, 20k=29 (sgfmetadata.cpp:292).
 * `HUMAN_RANKS` está ordenado 20k…9d (29 valores), así que el rango inverso es
 * `HUMAN_RANKS.length - índice`.
 */
export function inverseRank(rank: HumanRank): number {
  const idx = HUMAN_RANKS.indexOf(rank)
  if (idx < 0) throw new Error(`rango humano desconocido: ${String(rank)}`)
  return HUMAN_RANKS.length - idx
}

/**
 * Rellena `out` (Float32Array de largo `META_CHANNELS`) con el `meta_input` del perfil `preaz_<rank>`
 * para un tablero de área `boardArea` (p.ej. 361 para 19×19). Ver layout completo en
 * `docs/research/fase-engine/fuentes.md §2`.
 */
export function fillMetaV1(args: { rank: HumanRank; boardArea: number; out: Float32Array }): void {
  const { rank, boardArea, out } = args
  if (out.length !== META_CHANNELS) {
    throw new Error(`fillMetaV1: out debe tener largo ${META_CHANNELS}, recibió ${out.length}`)
  }
  out.fill(0)

  // [0,1]: pla/opp humano — perfil preaz_ es humano vs humano.
  out[0] = 1
  out[1] = 1
  // [2..5]: unranked / rank desconocido — ambos false en preaz_, quedan en 0.

  // [6..39] / [40..73]: termómetro de rango, mismo rango para pla y opp.
  const invRank = Math.min(inverseRank(rank), RANK_LEN_PER_PLAYER)
  for (let i = 0; i < invRank; i++) {
    out[RANK_START + i] = 1
    out[RANK_START + RANK_LEN_PER_PLAYER + i] = 1
  }

  // [74]: rated desconocido → 0.5.
  out[RATED_IDX] = 0.5

  // [75..81]: time control one-hot — byo-yomi.
  out[TC_BYOYOMI_IDX] = 1

  // [82..85]: parámetros de tiempo (se calculan siempre, sin importar el tipo de time control).
  out[MAIN_TIME_IDX] = 0.4 * (Math.log(PREAZ_MAIN_TIME_SECONDS + 60) - 6.5)
  out[PERIOD_TIME_IDX] = 0.3 * (Math.log(PREAZ_PERIOD_TIME_SECONDS + 1) - 3.0)
  out[BYOYOMI_PERIODS_IDX] = 0.5 * (Math.log(PREAZ_BYOYOMI_PERIODS + 2) - 1.5)
  out[CANADIAN_MOVES_IDX] = 0.25 * (Math.log(PREAZ_CANADIAN_MOVES + 2) - 1.5)

  // [86]: tamaño de tablero relativo a 19×19.
  out[BOARD_AREA_IDX] = 0.5 * Math.log(boardArea / 361)

  // [87..150]: fecha como 32 pares (cos, sin), período inicial 7 días × 80000^(1/31) por paso.
  const factor = Math.pow(80_000, 1 / (DATE_LEN - 1))
  const twoPi = 2 * Math.PI
  let period = 7.0
  for (let i = 0; i < DATE_LEN; i++) {
    const numRevolutions = PREAZ_DATE_DAYS / period
    out[DATE_START + i * 2] = Math.cos(numRevolutions * twoPi)
    out[DATE_START + i * 2 + 1] = Math.sin(numRevolutions * twoPi)
    period *= factor
  }

  // [151..166]: source one-hot — KGS.
  out[SOURCE_START + SOURCE_KGS] = 1

  // [167..191]: reservado, queda en 0.
}
