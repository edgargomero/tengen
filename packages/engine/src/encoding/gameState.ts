// Reconstruye una posición de Go a partir de una `Position` pública (tras handicap, con historial)
// en la forma que consume el encoder V7 (`encoding/featuresV7.ts`): tablero actual, ko, jugador al
// turno, jugadas recientes en orden cronológico y los tableros de hace 1 y 2 turnos (planos 15/16).
//
// Archivo 100% de tengen (no adaptado de upstream). Usa `fastBoard` (vendorizado) como motor de
// reglas: `setBoardSize` + `playMove` sobre una `SimPosition`.

import type { Position, Vertex } from '../types'
import {
  setBoardSize,
  playMove,
  PASS_MOVE,
  BLACK,
  WHITE,
  type SimPosition,
  type StoneColor,
} from '../vendor/web-katrain/fastBoard'

type Player = 'black' | 'white'

export type GameState = {
  boardSize: number
  stones: Uint8Array
  koPoint: number
  currentPlayer: Player
  recentMoves: { move: number; player: Player }[] // cronológico, último = más reciente
  prevStones: Uint8Array // tablero de hace 1 turno (plano 15)
  prevPrevStones: Uint8Array // tablero de hace 2 turnos (plano 16)
  komi: number
  rules: 'chinese' | 'japanese'
}

const getOpponent = (p: Player): Player => (p === 'black' ? 'white' : 'black')

function vertexToIndex(v: Vertex, n: number): number {
  if (v === 'pass') return PASS_MOVE
  return v.y * n + v.x
}

// Piedras de handicap fijo para 19x19, en los hoshi estándar (0-indexado, líneas 3/9/15). El komi
// efectivo con la bonificación de handicap lo ajusta el llamador vía `pos.komi` — aquí solo se
// colocan piedras (negras). Handicap 1 = sin piedra (solo komi). Orden de colocación tipo GTP;
// la identidad exacta del vértice por orientación no está cubierta por el oráculo diferencial de
// Task 5 (usa handicap 0) — se validaría contra KataGo en Task 10 si se usan partidas con handicap.
function handicapPoints19(h: number): [number, number][] {
  const TR: [number, number] = [15, 3]
  const BL: [number, number] = [3, 15]
  const BR: [number, number] = [15, 15]
  const TL: [number, number] = [3, 3]
  const L: [number, number] = [3, 9]
  const R: [number, number] = [15, 9]
  const T: [number, number] = [9, 3]
  const B: [number, number] = [9, 15]
  const C: [number, number] = [9, 9]
  switch (h) {
    case 2:
      return [TR, BL]
    case 3:
      return [TR, BL, BR]
    case 4:
      return [TR, BL, BR, TL]
    case 5:
      return [TR, BL, BR, TL, C]
    case 6:
      return [TR, BL, BR, TL, L, R]
    case 7:
      return [TR, BL, BR, TL, L, R, C]
    case 8:
      return [TR, BL, BR, TL, L, R, T, B]
    default:
      // h === 9 (o más: se cubren los 9 hoshi como tope documentado)
      return [TR, BL, BR, TL, L, R, T, B, C]
  }
}

function placeHandicap(stones: Uint8Array, n: number, handicap: number): void {
  if (handicap <= 1) return // 0 = sin handicap; 1 = sin piedra (solo komi)
  if (n !== 19) {
    throw new Error(`handicap>1 solo soportado en 19x19 (recibido ${n}x${n}, handicap ${handicap})`)
  }
  for (const [x, y] of handicapPoints19(handicap)) {
    stones[y * n + x] = BLACK
  }
}

/**
 * Construye el `GameState` a partir de una `Position`. Coloca las piedras de handicap, aplica las
 * jugadas en orden con `playMove` (deja que un registro ilegal lance — no se traga la excepción,
 * ver `decisiones-adaptacion.md §7`), y captura los tableros de hace 1/2 turnos.
 *
 * Convenciones (documentadas en el reporte de Task 5):
 * - `prevStones`/`prevPrevStones` al inicio de la partida (menos de 1/2 jugadas): copias del tablero
 *   inicial (tras handicap). No repite el tablero actual como hace el fallback de web-katrain.
 * - `currentPlayer`: opuesto del color de la última jugada del registro; sin jugadas, White si hubo
 *   piedras de handicap (handicap ≥ 2), si no Black.
 * - `koPoint`: el que deja el último `playMove` (−1 si no hay jugadas).
 */
export function buildGameState(pos: Position): GameState {
  const n = pos.boardSize
  setBoardSize(n)
  const area = n * n

  const initial = new Uint8Array(area)
  placeHandicap(initial, n, pos.handicap)

  const simPos: SimPosition = { stones: initial, koPoint: -1 }
  const captureStack: number[] = []
  const recentMoves: { move: number; player: Player }[] = []

  // Buffers de historial: al inicio, copias del tablero inicial (tras handicap).
  let prevStones = initial.slice()
  let prevPrevStones = initial.slice()

  for (const mv of pos.moves) {
    const move = vertexToIndex(mv.vertex, n)
    const color: StoneColor = mv.color === 'black' ? BLACK : WHITE
    // Snapshot ANTES de aplicar esta jugada: el "hace 2 turnos" pasa a ser el viejo "hace 1 turno",
    // y "hace 1 turno" pasa a ser el tablero actual (aún sin la jugada nueva).
    prevPrevStones = prevStones
    prevStones = simPos.stones.slice()
    playMove(simPos, move, color, captureStack)
    recentMoves.push({ move, player: mv.color })
  }

  const lastMove = pos.moves.length > 0 ? pos.moves[pos.moves.length - 1] : undefined
  const currentPlayer: Player = lastMove
    ? getOpponent(lastMove.color)
    : pos.handicap >= 2
      ? 'white'
      : 'black'

  return {
    boardSize: n,
    stones: simPos.stones,
    koPoint: simPos.koPoint,
    currentPlayer,
    recentMoves,
    prevStones,
    prevPrevStones,
    komi: pos.komi,
    rules: pos.rules,
  }
}
