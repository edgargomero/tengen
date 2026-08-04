// Regresión directa de `buildGameState` (Task 5, post-review): asegura que `stones`/`prevStones`/
// `prevPrevStones` capturan EXACTAMENTE S_k / S_{k-1} / S_{k-2} respectivamente, sin pasar por el
// encoder V7. El diff diferencial de `featuresV7.test.ts` alimenta al fork y al oráculo con los
// MISMOS mapas derivados de `state.prevStones`/`prevPrevStones`, así que un off-by-one en
// `buildGameState` pasaría el diff igual de "mal" en ambos lados (ver hallazgo del reviewer). Este
// archivo asserta el contenido crudo del historial contra una secuencia de jugadas donde S_k,
// S_{k-1} y S_{k-2} difieren en vértices identificables, para que un off-by-one falle en voz alta.

import { describe, expect, it } from 'vitest'
import { setBoardSize, BLACK, WHITE, EMPTY } from '../src/vendor/web-katrain/fastBoard'
import { buildGameState } from '../src/encoding/gameState'
import type { Move, Position } from '../src/types'

const N = 9
const idx = (x: number, y: number): number => y * N + x

// Tres jugadas en vértices distintos y fáciles de identificar, sin capturas entre ellas (colores
// alternos, posiciones separadas). Tras aplicarlas: k=3.
//   A = (2,2) negro  — última jugada (move k)
//   B = (1,1) blanco — penúltima (move k-1)
//   C = (0,0) negro  — antepenúltima (move k-2)
const A: Move = { color: 'black', vertex: { x: 2, y: 2 } }
const B: Move = { color: 'white', vertex: { x: 1, y: 1 } }
const C: Move = { color: 'black', vertex: { x: 0, y: 0 } }

function basePosition(moves: Move[]): Position {
  return { boardSize: N, komi: 7.5, rules: 'chinese', handicap: 0, moves }
}

describe('buildGameState: historial S_k / S_{k-1} / S_{k-2}', () => {
  it('trío A(k)/B(k-1)/C(k-2): stones tiene los tres; prevStones tiene B,C pero NO A; prevPrevStones tiene solo C', () => {
    setBoardSize(N)
    const state = buildGameState(basePosition([C, B, A]))

    // stones == S_3: las tres piedras presentes.
    expect(state.stones[idx(0, 0)]).toBe(BLACK) // C
    expect(state.stones[idx(1, 1)]).toBe(WHITE) // B
    expect(state.stones[idx(2, 2)]).toBe(BLACK) // A

    // prevStones == S_2 (hace 1 turno): B y C presentes, A todavía NO jugada.
    expect(state.prevStones[idx(0, 0)]).toBe(BLACK) // C
    expect(state.prevStones[idx(1, 1)]).toBe(WHITE) // B
    expect(state.prevStones[idx(2, 2)]).toBe(EMPTY) // A aún no existe en S_2

    // prevPrevStones == S_1 (hace 2 turnos): solo C presente; ni B ni A.
    expect(state.prevPrevStones[idx(0, 0)]).toBe(BLACK) // C
    expect(state.prevPrevStones[idx(1, 1)]).toBe(EMPTY) // B aún no existe en S_1
    expect(state.prevPrevStones[idx(2, 2)]).toBe(EMPTY) // A aún no existe en S_1
  })

  it('fallback de inicio de partida: 0 jugadas → prevStones y prevPrevStones == tablero inicial (vacío, handicap 0)', () => {
    setBoardSize(N)
    const state = buildGameState(basePosition([]))
    for (let i = 0; i < N * N; i++) {
      expect(state.stones[i]).toBe(EMPTY)
      expect(state.prevStones[i]).toBe(EMPTY)
      expect(state.prevPrevStones[i]).toBe(EMPTY)
    }
  })

  it('1 jugada: stones == S_1 (una piedra), prevStones == S_0 (tablero inicial, vacío)', () => {
    setBoardSize(N)
    const state = buildGameState(basePosition([C]))
    expect(state.stones[idx(0, 0)]).toBe(BLACK) // S_1: C ya jugada
    expect(state.prevStones[idx(0, 0)]).toBe(EMPTY) // S_0: tablero inicial, sin C todavía
    for (let i = 0; i < N * N; i++) {
      expect(state.prevPrevStones[i]).toBe(EMPTY) // también S_0 (fallback de arranque)
    }
  })

  it('currentPlayer: lista de jugadas de longitud par (2, sin handicap) → Negro al turno', () => {
    setBoardSize(N)
    const state = buildGameState(basePosition([C, B])) // última jugada Blanco → opuesto Negro
    expect(state.currentPlayer).toBe('black')
  })

  it('currentPlayer: lista de jugadas de longitud impar (3, sin handicap) → Blanco al turno', () => {
    setBoardSize(N)
    const state = buildGameState(basePosition([C, B, A])) // última jugada Negro → opuesto Blanco
    expect(state.currentPlayer).toBe('white')
  })
})

// Fase Aprender T1: piedras de setup (semántica SGF AB/AW: se colocan, no se juegan) + initialTurn
// (tsumego "juegan blancas" con 0 jugadas). El setup se escribe en el tablero inicial ANTES del
// bucle de jugadas, así que para el encoder V7 esas piedras "siempre estuvieron ahí": aparecen en
// stones/prevStones/prevPrevStones y NO fabrican historial en recentMoves.
describe('buildGameState: setup + initialTurn', () => {
  const SETUP = {
    black: [
      { x: 4, y: 4 },
      { x: 5, y: 4 },
    ],
    white: [{ x: 4, y: 5 }],
  }

  it('setup sin jugadas: piedras presentes en stones Y en prevStones/prevPrevStones; recentMoves vacío', () => {
    setBoardSize(N)
    const state = buildGameState({ ...basePosition([]), setup: SETUP })
    for (const buf of [state.stones, state.prevStones, state.prevPrevStones]) {
      expect(buf[idx(4, 4)]).toBe(BLACK)
      expect(buf[idx(5, 4)]).toBe(BLACK)
      expect(buf[idx(4, 5)]).toBe(WHITE)
    }
    expect(state.recentMoves).toEqual([])
  })

  it('setup + 1 jugada: la jugada NO está en prevStones, el setup sí (historial honesto)', () => {
    setBoardSize(N)
    const state = buildGameState({ ...basePosition([A]), setup: SETUP })
    expect(state.stones[idx(2, 2)]).toBe(BLACK) // A jugada
    expect(state.prevStones[idx(2, 2)]).toBe(EMPTY) // A aún no existía hace 1 turno
    expect(state.prevStones[idx(4, 4)]).toBe(BLACK) // el setup "siempre estuvo"
    expect(state.recentMoves).toHaveLength(1)
  })

  it('initialTurn white con 0 jugadas y sin handicap → currentPlayer white', () => {
    setBoardSize(N)
    const state = buildGameState({ ...basePosition([]), setup: SETUP, initialTurn: 'white' })
    expect(state.currentPlayer).toBe('white')
  })

  it('setup sin initialTurn, 0 jugadas, handicap 0 → currentPlayer black (derivación de siempre)', () => {
    setBoardSize(N)
    const state = buildGameState({ ...basePosition([]), setup: SETUP })
    expect(state.currentPlayer).toBe('black')
  })

  it('con jugadas, initialTurn NO pisa la derivación: currentPlayer = opuesto de la última jugada', () => {
    setBoardSize(N)
    const state = buildGameState({ ...basePosition([C, B, A]), initialTurn: 'black' })
    expect(state.currentPlayer).toBe('white') // última jugada Negro → Blanco, initialTurn irrelevante
  })

  it('regresión: setup vacío e initialTurn ausente → GameState byte-idéntico al de una Position sin los campos', () => {
    setBoardSize(N)
    const before = buildGameState(basePosition([C, B, A]))
    const after = buildGameState({
      ...basePosition([C, B, A]),
      setup: { black: [], white: [] },
      initialTurn: undefined,
    })
    expect(Array.from(after.stones)).toEqual(Array.from(before.stones))
    expect(Array.from(after.prevStones)).toEqual(Array.from(before.prevStones))
    expect(Array.from(after.prevPrevStones)).toEqual(Array.from(before.prevPrevStones))
    expect(after.koPoint).toBe(before.koPoint)
    expect(after.currentPlayer).toBe(before.currentPlayer)
    expect(after.recentMoves).toEqual(before.recentMoves)
  })
})
