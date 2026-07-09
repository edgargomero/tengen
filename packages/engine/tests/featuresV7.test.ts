import { describe, expect, it } from 'vitest'
import {
  setBoardSize,
  BLACK,
  WHITE,
  computeLibertyMap,
  computeAreaMapV7KataGo,
  computeLadderFeaturesV7KataGo,
  computeLadderedStonesV7KataGo,
  type StoneColor,
} from '../src/vendor/web-katrain/fastBoard'
import { fillInputsV7Fast } from '../src/vendor/web-katrain/featuresV7Fast' // oráculo NHWC original
import { fillFeaturesV7NCHW, SPATIAL_CHANNELS_V7 } from '../src/encoding/featuresV7'
import { buildGameState, type GameState } from '../src/encoding/gameState'

const C = SPATIAL_CHANNELS_V7 // 22
const at = (n: number, x: number, y: number): number => y * n + x

// --- Oráculo diferencial ----------------------------------------------------------------------
// El fork NCHW calcula sus mapas internamente; para que el diff compare SOLO el layout (NHWC↔NCHW)
// y no la lógica de los mapas, alimentamos al oráculo NHWC exactamente los mismos mapas, computados
// con las MISMAS llamadas de fastBoard y las mismas convenciones que usa el fork (ver featuresV7.ts).

type V7Maps = {
  libertyMap: Uint8Array
  areaMap: Uint8Array | undefined
  ladderedStones: Uint8Array
  ladderWorkingMoves: Uint8Array
  prevLaddered: Uint8Array
  prevPrevLaddered: Uint8Array
}

function buildMaps(state: GameState): V7Maps {
  const stones = state.stones
  const plaColor: StoneColor = state.currentPlayer === 'black' ? BLACK : WHITE
  const libertyMap = computeLibertyMap(stones)
  const areaMap = state.rules === 'chinese' ? computeAreaMapV7KataGo(stones) : undefined
  const { ladderedStones, ladderWorkingMoves } = computeLadderFeaturesV7KataGo({
    stones,
    koPoint: state.koPoint,
    currentPlayer: plaColor,
  })
  const prevLaddered = computeLadderedStonesV7KataGo({ stones: state.prevStones, koPoint: -1 })
  const prevPrevLaddered = computeLadderedStonesV7KataGo({ stones: state.prevPrevStones, koPoint: -1 })
  return { libertyMap, areaMap, ladderedStones, ladderWorkingMoves, prevLaddered, prevPrevLaddered }
}

// Corre oráculo (NHWC) y fork (NCHW), asserta igualdad plano-a-plano tras des-transponer + globals,
// y devuelve la salida NCHW del fork para asserts adicionales.
function assertDiff(state: GameState, maps: V7Maps, conservativePassAndIsRoot?: boolean) {
  const N = state.boardSize
  const refSpatial = new Float32Array(N * N * C)
  const refGlobal = new Float32Array(19)
  fillInputsV7Fast({
    stones: state.stones,
    koPoint: state.koPoint,
    currentPlayer: state.currentPlayer,
    recentMoves: state.recentMoves,
    komi: state.komi,
    rules: state.rules,
    conservativePassAndIsRoot,
    libertyMap: maps.libertyMap,
    areaMap: maps.areaMap,
    ladderedStones: maps.ladderedStones,
    ladderWorkingMoves: maps.ladderWorkingMoves,
    prevLadderedStones: maps.prevLaddered,
    prevPrevLadderedStones: maps.prevPrevLaddered,
    outSpatial: refSpatial,
    outGlobal: refGlobal,
  })

  const ourSpatial = new Float32Array(N * N * C)
  const ourGlobal = new Float32Array(19)
  fillFeaturesV7NCHW({ state, conservativePassAndIsRoot, outSpatial: ourSpatial, outGlobal: ourGlobal })

  const nhwc = (x: number, y: number, c: number) => (y * N + x) * C + c
  const nchw = (x: number, y: number, c: number) => c * N * N + y * N + x
  for (let c = 0; c < C; c++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        expect(ourSpatial[nchw(x, y, c)]).toBe(refSpatial[nhwc(x, y, c)])
      }
    }
  }
  expect(Array.from(ourGlobal)).toEqual(Array.from(refGlobal))
  return { ourSpatial, ourGlobal }
}

const plane = (sp: Float32Array, n: number, c: number): Float32Array => sp.subarray(c * n * n, (c + 1) * n * n)

// Estado a mano (sin pasar por buildGameState) para posiciones de área/reglas con formas verificadas.
function handState(stones: Uint8Array, n: number, currentPlayer: 'black' | 'white', rules: 'chinese' | 'japanese'): GameState {
  return {
    boardSize: n,
    stones,
    koPoint: -1,
    currentPlayer,
    recentMoves: [],
    prevStones: stones.slice(),
    prevPrevStones: stones.slice(),
    komi: 7.5,
    rules,
  }
}

// Grupo negro 5×5 con dos ojos reales (Benson pass-alive) — misma forma verificada a mano en
// tests/ladderArea.test.ts. El propio borde del tablero hace de pared; los dos ojos son (1,1) y (3,3).
function twoEyeBoard5(): Uint8Array {
  const n = 5
  setBoardSize(n)
  const s = new Uint8Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if ((x === 1 && y === 1) || (x === 3 && y === 3)) continue
      s[y * n + x] = BLACK
    }
  }
  return s
}

describe('featuresV7 NCHW == NHWC de web-katrain (des-transpuesto)', () => {
  it('plano 0 (máscara) = 1 en todo el tablero; global 5 = selfKomi/20', () => {
    setBoardSize(19)
    const state = buildGameState({ boardSize: 19, komi: 7.5, rules: 'chinese', handicap: 0, moves: [] })
    expect(state.currentPlayer).toBe('black')
    const n = 19
    const sp = new Float32Array(n * n * C)
    const gl = new Float32Array(19)
    fillFeaturesV7NCHW({ state, outSpatial: sp, outGlobal: gl })
    for (let i = 0; i < n * n; i++) expect(sp[i]).toBe(1) // plano 0 = índices 0..360 en NCHW
    expect(gl[5]).toBeCloseTo(-0.375, 6) // -7.5/20, Negro al turno
  })

  it('coincide plano a plano en una posición con historial (4 esquinas)', () => {
    setBoardSize(19)
    const state = buildGameState({
      boardSize: 19,
      komi: 7.5,
      rules: 'chinese',
      handicap: 0,
      moves: [
        { color: 'black', vertex: { x: 3, y: 3 } },
        { color: 'white', vertex: { x: 15, y: 15 } },
        { color: 'black', vertex: { x: 15, y: 3 } },
        { color: 'white', vertex: { x: 3, y: 15 } },
      ],
    })
    assertDiff(state, buildMaps(state))
  })

  it('posición rica: dos escaleras vivas (borde 1-lib + esquina 2-lib) → planos 14/15/16/17 no-cero', () => {
    // Dos escaleras que NO interactúan (esquinas opuestas del tablero):
    //  - Borde arriba-izq: W(3,0) en atari por B(4,0),B(3,1) → 1 lib, escalera de borde (plano 14).
    //  - Esquina abajo-der: B(17,17) con W(16,17),W(17,16) → 2 libs hacia (18,18), escalera de esquina.
    // 7 jugadas (una de relleno) para que ambas escaleras existan también hace 1 y 2 turnos (15/16)
    // y para dejar a Blanco al turno (así el plano 17 registra las jugadas de ataque sobre el grupo
    // NEGRO perseguido: opponentOf(white)=black == color del grupo).
    const n = 19
    setBoardSize(n)
    const state = buildGameState({
      boardSize: 19,
      komi: 7.5,
      rules: 'chinese',
      handicap: 0,
      moves: [
        { color: 'black', vertex: { x: 4, y: 0 } },
        { color: 'white', vertex: { x: 3, y: 0 } },
        { color: 'black', vertex: { x: 3, y: 1 } },
        { color: 'white', vertex: { x: 16, y: 17 } },
        { color: 'black', vertex: { x: 17, y: 17 } },
        { color: 'white', vertex: { x: 17, y: 16 } },
        { color: 'black', vertex: { x: 9, y: 9 } },
      ],
    })
    expect(state.currentPlayer).toBe('white')

    const { ourSpatial } = assertDiff(state, buildMaps(state))

    // Los planos 14-17 son realmente no-cero aquí (si no, el diff de layout de esos planos sería
    // tautológico — comparar 0 contra 0). Una regresión que los ponga a cero fallaría este guard.
    for (const c of [14, 15, 16, 17]) {
      expect(plane(ourSpatial, n, c).some((v) => v !== 0)).toBe(true)
    }
    // Puntos concretos verificados a mano:
    expect(plane(ourSpatial, n, 14)[at(n, 3, 0)]).toBe(1) // W(3,0) laddered (1 lib, borde)
    expect(plane(ourSpatial, n, 14)[at(n, 17, 17)]).toBe(1) // B(17,17) laddered (2 libs, esquina)
    // Plano 17: jugadas de ataque sobre B(17,17) hacia la esquina (18,18).
    expect(plane(ourSpatial, n, 17)[at(n, 18, 17)]).toBe(1)
    expect(plane(ourSpatial, n, 17)[at(n, 17, 18)]).toBe(1)
  })

  it('planos 15/16: el historial de escaleras sale de prevStones/prevPrevStones de buildGameState', () => {
    // Reutiliza la posición rica: W(3,0) queda en escalera de 1 lib en el tablero actual, hace 1 turno
    // y hace 2 turnos → planos 14, 15 y 16 marcan (3,0). Verifica que buildGameState capturó bien los
    // tableros históricos (no repite el actual ni deja vacío a mitad de partida).
    const n = 19
    setBoardSize(n)
    const state = buildGameState({
      boardSize: 19,
      komi: 7.5,
      rules: 'chinese',
      handicap: 0,
      moves: [
        { color: 'black', vertex: { x: 4, y: 0 } },
        { color: 'white', vertex: { x: 3, y: 0 } },
        { color: 'black', vertex: { x: 3, y: 1 } },
        { color: 'white', vertex: { x: 16, y: 17 } },
        { color: 'black', vertex: { x: 17, y: 17 } },
        { color: 'white', vertex: { x: 17, y: 16 } },
        { color: 'black', vertex: { x: 9, y: 9 } },
      ],
    })
    const { ourSpatial } = assertDiff(state, buildMaps(state))
    expect(plane(ourSpatial, n, 15)[at(n, 3, 0)]).toBe(1) // W(3,0) laddered hace 1 turno
    expect(plane(ourSpatial, n, 16)[at(n, 3, 0)]).toBe(1) // W(3,0) laddered hace 2 turnos
  })

  it('área pass-alive (chinas): plano 18 no-cero con Negro al turno', () => {
    const n = 5
    const stones = twoEyeBoard5() // setBoardSize(5)
    const state = handState(stones, n, 'black', 'chinese')
    const { ourSpatial } = assertDiff(state, buildMaps(state))
    // Todo el tablero es área negra (Benson): con Negro al turno, área == plaColor → plano 18.
    expect(plane(ourSpatial, n, 18)[at(n, 1, 1)]).toBe(1) // ojo (1,1) marcado como área propia
    expect(plane(ourSpatial, n, 18).some((v) => v !== 0)).toBe(true)
    expect(plane(ourSpatial, n, 19).every((v) => v === 0)).toBe(true)
  })

  it('área pass-alive (chinas): plano 19 no-cero con Blanco al turno (misma área, oppColor)', () => {
    const n = 5
    const stones = twoEyeBoard5()
    const state = handState(stones, n, 'white', 'chinese')
    const { ourSpatial } = assertDiff(state, buildMaps(state))
    // Con Blanco al turno, el área negra es oppColor → plano 19.
    expect(plane(ourSpatial, n, 19)[at(n, 1, 1)]).toBe(1)
    expect(plane(ourSpatial, n, 19).some((v) => v !== 0)).toBe(true)
    expect(plane(ourSpatial, n, 18).every((v) => v === 0)).toBe(true)
  })

  it('reglas japonesas: planos 18/19 en cero, globals 9/10 = 1, diff exacto', () => {
    const n = 5
    const stones = twoEyeBoard5()
    const state = handState(stones, n, 'black', 'japanese')
    const { ourSpatial, ourGlobal } = assertDiff(state, buildMaps(state))
    expect(plane(ourSpatial, n, 18).every((v) => v === 0)).toBe(true)
    expect(plane(ourSpatial, n, 19).every((v) => v === 0)).toBe(true)
    expect(ourGlobal[9]).toBe(1) // scoring: territory
    expect(ourGlobal[10]).toBe(1) // tax: seki
  })
})
