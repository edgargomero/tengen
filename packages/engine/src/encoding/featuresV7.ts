/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/engine/katago/featuresV7Fast.ts (`fillInputsV7Fast`). Licencia completa en
 * packages/engine/THIRD-PARTY-LICENSES.
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 *
 * FORK NCHW del encoder V7. Copia byte-a-byte del `fillInputsV7Fast` de `featuresV7Fast.ts` EXCEPTO:
 *   (a) indexador espacial → NCHW `c·N² + y·N + x` (los ONNX de tengen son `bin_input[b,22,N,N]`),
 *   (b) `BOARD_SIZE`/361 hardcodeado → `N = state.boardSize` parametrizado,
 *   (c) los mapas de libertades/área/escaleras se precomputan aquí llamando a `fastBoard` (en el
 *       oráculo NHWC llegan como argumentos; en producción es este encoder quien los calcula).
 * Todo lo demás (qué plano/qué global, gating de reglas, onda de komi, supresión de historial con
 * `conservativePassAndIsRoot`) es idéntico al original. Ver `decisiones-adaptacion.md §2`.
 *
 * IMPORTANTE: asume que `setBoardSize(state.boardSize)` ya está activo (las funciones de `fastBoard`
 * usan estado global de módulo dimensionado por tamaño de tablero). `buildGameState` lo garantiza.
 */

import {
  BLACK,
  WHITE,
  EMPTY,
  PASS_MOVE,
  computeLibertyMap,
  computeAreaMapV7KataGo,
  computeLadderFeaturesV7KataGo,
  computeLadderedStonesV7KataGo,
  type StoneColor,
} from '../vendor/web-katrain/fastBoard'
import type { GameState } from './gameState'

export const SPATIAL_CHANNELS_V7 = 22
export const GLOBAL_CHANNELS_V7 = 19

type Player = 'black' | 'white'
const getOpponent = (player: Player): Player => (player === 'black' ? 'white' : 'black')
const playerToColor = (p: Player): StoneColor => (p === 'black' ? BLACK : WHITE)

export function fillFeaturesV7NCHW(args: {
  state: GameState
  conservativePassAndIsRoot?: boolean
  outSpatial: Float32Array // len N²·22, NCHW: c·N² + y·N + x
  outGlobal: Float32Array // len 19
}): void {
  const { state } = args
  const N = state.boardSize
  const idx = (x: number, y: number, c: number) => c * N * N + y * N + x

  const stones = state.stones
  const koPoint = state.koPoint
  const rules = state.rules
  const komi = state.komi
  const pla = state.currentPlayer
  const opp = getOpponent(pla)
  const plaColor = playerToColor(pla)
  const oppColor = playerToColor(opp)

  // (c) Mapas precomputados con fastBoard (en el oráculo NHWC llegan como argumentos).
  const libs = computeLibertyMap(stones)
  const areaMap = rules === 'chinese' ? computeAreaMapV7KataGo(stones) : null
  const { ladderedStones, ladderWorkingMoves } = computeLadderFeaturesV7KataGo({
    stones,
    koPoint,
    currentPlayer: plaColor,
  })
  // Planos 15/16: escaleras sobre los tableros de hace 1 y 2 turnos. GameState no lleva el koPoint
  // histórico → se usa -1 (ver limitación en el reporte; el gate real de esto es `kata-raw-nn`/Task 10).
  const prevLaddered = computeLadderedStonesV7KataGo({ stones: state.prevStones, koPoint: -1 })
  const prevPrevLaddered = computeLadderedStonesV7KataGo({ stones: state.prevPrevStones, koPoint: -1 })

  const recentMoves = state.recentMoves

  const spatial = args.outSpatial
  const global = args.outGlobal
  spatial.fill(0)
  global.fill(0)

  // Plano 0 (máscara "on-board"): en NCHW ocupa exactamente los índices [0, N²).
  for (let pos = 0; pos < N * N; pos++) spatial[idx(pos % N, (pos / N) | 0, 0)] = 1.0

  if (koPoint >= 0 && koPoint < N * N) {
    const x = koPoint % N
    const y = (koPoint / N) | 0
    spatial[idx(x, y, 6)] = 1.0
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const pos = y * N + x
      const v = stones[pos] as StoneColor
      if (v === EMPTY) continue
      if (v === plaColor) spatial[idx(x, y, 1)] = 1.0
      else if (v === oppColor) spatial[idx(x, y, 2)] = 1.0

      const l = libs[pos]!
      if (l === 1) spatial[idx(x, y, 3)] = 1.0
      else if (l === 2) spatial[idx(x, y, 4)] = 1.0
      else if (l === 3) spatial[idx(x, y, 5)] = 1.0
    }
  }

  // Planos 14-17 (escaleras). Los mapas siempre existen aquí, así que el bloque siempre se ejecuta
  // (equivalente al `if (ladderedStones || ...)` del oráculo, siempre verdadero cuando se pasan los 4).
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const pos = y * N + x
      if (ladderedStones[pos]) spatial[idx(x, y, 14)] = 1.0
      if (prevLaddered[pos]) spatial[idx(x, y, 15)] = 1.0
      if (prevPrevLaddered[pos]) spatial[idx(x, y, 16)] = 1.0
      if (ladderWorkingMoves[pos]) spatial[idx(x, y, 17)] = 1.0
    }
  }

  if (rules === 'chinese' && areaMap) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const pos = y * N + x
        const v = areaMap[pos] as StoneColor
        if (v === plaColor) spatial[idx(x, y, 18)] = 1.0
        else if (v === oppColor) spatial[idx(x, y, 19)] = 1.0
      }
    }
  }

  // KataGo conservativePassAndIsRoot: si un pase ahora terminaría la partida, se suprimen las
  // features de historial y también el global de "el pase acabaría la fase".
  const lastMove = recentMoves.length > 0 ? recentMoves[recentMoves.length - 1] : null
  const passWouldEndGame = lastMove?.move === PASS_MOVE
  const suppressHistory = args.conservativePassAndIsRoot === true && passWouldEndGame

  const historyPlanes = [9, 10, 11, 12, 13] as const
  const passGlobals = [0, 1, 2, 3, 4] as const
  const expectedPlayers: Player[] = [opp, pla, opp, pla, opp]
  if (!suppressHistory) {
    for (let i = 0; i < 5; i++) {
      const m = recentMoves[recentMoves.length - 1 - i]
      if (!m) break
      if (m.player !== expectedPlayers[i]) break
      if (m.move === PASS_MOVE) {
        global[passGlobals[i]!] = 1.0
      } else {
        const x = m.move % N
        const y = (m.move / N) | 0
        spatial[idx(x, y, historyPlanes[i]!)] = 1.0
      }
    }
  }

  const selfKomi = pla === 'white' ? komi : -komi
  global[5] = selfKomi / 20.0

  if (rules === 'japanese') {
    // KataGo "Japanese": territory scoring + seki tax. (GameState.rules ⊂ {chinese, japanese};
    // el oráculo también gatea 'korean' igual, pero tengen no lo emite en v1.)
    global[9] = 1.0 // scoring: territory
    global[10] = 1.0 // tax: seki
  }

  global[14] = !suppressHistory && passWouldEndGame ? 1.0 : 0.0

  if (rules === 'chinese') {
    const boardAreaIsEven = (N * N) % 2 === 0
    const drawableKomisAreEven = boardAreaIsEven

    let komiFloor: number
    if (drawableKomisAreEven) komiFloor = Math.floor(selfKomi / 2.0) * 2.0
    else komiFloor = Math.floor((selfKomi - 1.0) / 2.0) * 2.0 + 1.0

    let delta = selfKomi - komiFloor
    if (delta < 0.0) delta = 0.0
    if (delta > 2.0) delta = 2.0

    let wave: number
    if (delta < 0.5) wave = delta
    else if (delta < 1.5) wave = 1.0 - delta
    else wave = delta - 2.0
    global[18] = wave
  }
}
