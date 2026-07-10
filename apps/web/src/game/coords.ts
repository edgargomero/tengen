// Adaptadores puros entre el modelo de coordenadas del motor (@tengen/engine) y el de
// @sabaki/go-board / Shudan. Sin estado, sin dependencias de tablero: solo traducción de tipos.
//
// FOOTGUN de indexación (documentado aquí porque es el origen de la confusión):
//   - Los vértices del motor son objetos { x, y }.
//   - Las tuplas de go-board (makeMove/analyzeMove/get, y este módulo) son [x, y].
//   - PERO el `signMap` de go-board (y de Shudan) se indexa POR FILA PRIMERO: signMap[y][x].
//     Es decir, una piedra en {x:3,y:15} vive en signMap[15][3], no en signMap[3][15].
//   Este módulo solo traduce vértices [x,y] ↔ {x,y}; quien lea signMap debe recordar [y][x].
//
// El pase ('pass') NO es un vértice de tablero: no se convierte aquí. Los callers manejan el
// pase por separado (Move.vertex === 'pass').
import type { StoneColor } from '@tengen/engine'

/** Vértice del motor {x,y} → tupla de go-board [x,y]. */
export function engineToSabakiVertex(v: { x: number; y: number }): [number, number] {
  return [v.x, v.y]
}

/** Tupla de go-board [x,y] → vértice del motor {x,y}. */
export function sabakiToEngineVertex(v: [number, number]): { x: number; y: number } {
  return { x: v[0], y: v[1] }
}

/** Color del motor → Sign de Sabaki: black→1, white→-1 (convención Sabaki: Sign 1 = negro). */
export function colorToSign(color: StoneColor): 1 | -1 {
  return color === 'black' ? 1 : -1
}

/** Sign de Sabaki (±1) → color del motor. */
export function signToColor(sign: 1 | -1): StoneColor {
  return sign === 1 ? 'black' : 'white'
}
