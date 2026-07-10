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
