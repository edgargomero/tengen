// Fase Aprender Bloque 3: conteo de área (piedras + territorio) para los ejercicios nuevos de
// "contar puntos" (learn/countingExercise.ts). Mismo layer que rules.ts -- reglas puras de Go, sin
// UI, corre en Node. Usa `board.getConnectedComponent` (confirmado en
// node_modules/@sabaki/go-board/src/GoBoard.js: flood-fill DFS genérico que siempre incluye el
// vértice de arranque y filtra vecinos por `predicate`) como el flood-fill que hace falta, sin
// reimplementarlo.
//
// `countArea` NO suma komi: el komi (cuando el ejercicio lo tiene) se suma aparte, fuera de esta
// función -- no todo `CountingExercise` lo trae (ver countingExercise.ts).
//
// Riesgo documentado, no de código: una piedra "muerta" por descuido en una posición curada cuenta
// como viva y envenena a dame la región vecina. Fuera de alcance simular vida/muerte -- las
// posiciones de conteo son curadas a mano sin ambigüedad, por diseño.
import type { BoardSize } from '@tengen/engine'
import { boardFromMoves, type SetupStones } from './rules'

/**
 * Piedras propias + territorio de cada color sobre una posición TERMINADA (sin komi). Cada región
 * vacía conectada pertenece a un color solo si linda ÚNICAMENTE con ese color; si linda con ambos
 * (o con ninguno, tablero vacío), es dame y no cuenta para nadie -- por eso
 * `black + white <= boardSize²`, con la diferencia siendo puntos de dame.
 */
export function countArea(boardSize: BoardSize, setup: SetupStones): { black: number; white: number } {
  const board = boardFromMoves(boardSize, 0, [], setup)
  let black = 0
  let white = 0
  const visitedEmpty = new Set<string>()

  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      const sign = board.get([x, y])
      if (sign === 1) {
        black++
        continue
      }
      if (sign === -1) {
        white++
        continue
      }

      // Punto vacío: si ya se contó como parte de una región visitada, no recontar.
      const key = `${x},${y}`
      if (visitedEmpty.has(key)) continue

      const region = board.getConnectedComponent([x, y], (v) => board.get(v) === 0)
      region.forEach(([rx, ry]) => visitedEmpty.add(`${rx},${ry}`))

      let touchesBlack = false
      let touchesWhite = false
      for (const [rx, ry] of region) {
        for (const neighbor of board.getNeighbors([rx, ry])) {
          const neighborSign = board.get(neighbor)
          if (neighborSign === 1) touchesBlack = true
          else if (neighborSign === -1) touchesWhite = true
        }
      }

      if (touchesBlack && !touchesWhite) black += region.length
      else if (touchesWhite && !touchesBlack) white += region.length
      // Linda con ambos colores (o con ninguno, tablero vacío): dame, no cuenta para nadie.
    }
  }

  return { black, white }
}
