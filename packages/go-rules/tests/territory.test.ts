// Fase Aprender Bloque 3: countArea es el algoritmo de conteo real detrás de
// countingExerciseIssues (learn/countingExercise.ts) -- estos fixtures son posiciones armadas y
// calculadas A MANO (no derivadas del propio countArea: eso volvería la prueba circular).
//
// La propiedad `black + white + dame === boardSize²` se chequea con `dame` fijado como un LITERAL
// calculado a mano por fixture, nunca como `boardSize² - black - white`: esa fórmula haría la
// propiedad trivialmente cierta sin verificar que countArea reparte los puntos al color correcto
// -- justo el bug que este archivo tiene que atrapar (una región que linda con ambos colores
// adjudicada a uno solo, por ejemplo).
import { describe, expect, it } from 'vitest'
import type { BoardSize } from '@tengen/engine'
import { countArea } from '../src/territory'
import type { SetupStones } from '../src/rules'

const SIZE: BoardSize = 9

function checkFixture(
  name: string,
  setup: SetupStones,
  expected: { black: number; white: number; dame: number },
): void {
  it(name, () => {
    const result = countArea(SIZE, setup)
    expect(result).toEqual({ black: expected.black, white: expected.white })
    // Literal de dame calculado a mano (ver cabecera) -- no derivado de `result`.
    expect(result.black + result.white + expected.dame).toBe(SIZE * SIZE)
  })
}

describe('countArea', () => {
  checkFixture(
    'setup vacío: tablero sin piedras -- nada linda con ningún color, todo es dame',
    { black: [], white: [] },
    { black: 0, white: 0, dame: 81 },
  )

  checkFixture(
    // Muros adyacentes en las columnas x=4 (negro, 9 piedras) y x=5 (blanco, 9 piedras): parten el
    // tablero en dos mitades desconectadas SIN punto neutral entre ellas (cada muro linda
    // directamente con el otro, no con una región vacía compartida).
    // Izquierda: 4 columnas (x=0..3) x 9 filas = 36 vacíos, lindan solo con negro -> negro = 9+36=45.
    // Derecha: 3 columnas (x=6..8) x 9 filas = 27 vacíos, lindan solo con blanco -> blanco = 9+27=36.
    'mitad-mitad: dos muros adyacentes (negro x=4, blanco x=5), sin dame',
    {
      black: Array.from({ length: SIZE }, (_, y) => ({ x: 4, y })),
      white: Array.from({ length: SIZE }, (_, y) => ({ x: 5, y })),
    },
    { black: 45, white: 36, dame: 0 },
  )

  checkFixture(
    // Muro negro en la fila y=0 (9 piedras) y muro blanco en la fila y=8 (9 piedras), con las 7
    // filas del medio (y=1..7, 9 columnas = 63 puntos) totalmente vacías y CONECTADAS entre sí: esa
    // única región gigante linda con negro (via y=1) Y con blanco (via y=7) a la vez -> dame=63.
    // Ningún muro obtiene territorio (solo sus propias piedras): negro=9, blanco=9.
    'dame en el medio: muro negro arriba (y=0) y blanco abajo (y=8), el medio linda con ambos',
    {
      black: Array.from({ length: SIZE }, (_, x) => ({ x, y: 0 })),
      white: Array.from({ length: SIZE }, (_, x) => ({ x, y: 8 })),
    },
    { black: 9, white: 9, dame: 63 },
  )

  checkFixture(
    // Tablero lleno de negro (79 piedras) salvo DOS huecos interiores aislados, (2,2) y (6,6),
    // cada uno rodeado en sus 4 vecinos por piedras negras: son DOS regiones de 1 punto cada una,
    // desconectadas entre sí (no hay camino de vacíos entre ellas), y el algoritmo tiene que sumar
    // ambas al mismo total en vez de perder una o contarla dos veces.
    'regiones desconectadas del mismo color: dos huecos negros aislados suman al mismo total',
    {
      black: (() => {
        const stones: { x: number; y: number }[] = []
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            if ((x === 2 && y === 2) || (x === 6 && y === 6)) continue
            stones.push({ x, y })
          }
        }
        return stones
      })(),
      white: [],
    },
    { black: 81, white: 0, dame: 0 },
  )

  checkFixture(
    // Una sola piedra blanca en la esquina (0,0), que solo tiene 2 vecinos (no 4): el punto donde
    // getNeighbors/getConnectedComponent tienen menos vecinos que en el interior del tablero. El
    // resto del tablero es una única región vacía conectada que linda solo con esa piedra.
    'rincón/borde: una piedra sola en la esquina (0,0), con solo 2 vecinos',
    { black: [], white: [{ x: 0, y: 0 }] },
    { black: 0, white: 81, dame: 0 },
  )
})
