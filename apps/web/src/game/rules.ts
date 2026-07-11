// Reglas de Go para el "Modo Jugar" (Fase 2), delegando en @sabaki/go-board como ORÁCULO de
// reglas (capturas, suicidio, ko, superko de posición simple). Módulo puro, corre en Node.
//
// Contrato con el motor (@tengen/engine):
//   - El handicap NO va en `moves[]`: son solo jugadas reales. Las piedras de handicap (negras) se
//     colocan aparte, en los hoshi (handicapVertices). Con handicap >= 2, Blanco mueve primero.
//   - Vértices del motor {x,y} ↔ tuplas de go-board [x,y] (ver coords.ts). Recordatorio del footgun:
//     signMap se indexa [y][x], las tuplas de go-board son [x,y].
//
// boardFromMoves produce el GoBoard de display (para Shudan). La `Position` del motor la arma
// Task 2 (gameTree) por separado; aquí solo se maneja el tablero de reglas/visualización.
import GoBoard from '@sabaki/go-board'
import type { SignMap } from '@sabaki/go-board'
import type { BoardSize, Move, StoneColor } from '@tengen/engine'
import { colorToSign } from './coords'

/**
 * Puntos de handicap (tuplas [x,y]) para un tamaño y cantidad dados. handicap < 2 → []. En 19×19,
 * go-board devuelve los hoshi que el motor espera (verificado). handicap > 1 fuera de 19×19 no
 * debería llegar aquí (lo rechaza validateConfig), pero go-board solo da hoshi correctos en 19×19.
 */
export function handicapVertices(boardSize: BoardSize, handicap: number): [number, number][] {
  if (handicap < 2) return []
  return GoBoard.fromDimensions(boardSize).getHandicapPlacement(handicap)
}

/**
 * Reconstruye el GoBoard desde cero: arranca de fromDimensions, coloca las piedras de handicap
 * (negras) en los hoshi, y aplica cada jugada real en orden. Los pases ('pass') se ignoran (no
 * cambian el tablero). Un move ilegal en el historial es un bug del caller: se deja que makeMove
 * lance (no se traga el error).
 */
export function boardFromMoves(boardSize: BoardSize, handicap: number, moves: Move[]): GoBoard {
  let board = GoBoard.fromDimensions(boardSize)
  for (const vertex of handicapVertices(boardSize, handicap)) {
    board = board.makeMove(1, vertex)
  }
  for (const move of moves) {
    if (move.vertex === 'pass') continue
    board = applyMove(board, move.color, move.vertex)
  }
  return board
}

/**
 * Color al que le toca jugar. Si hay jugadas, es el opuesto a la última; si no, depende del
 * handicap: con handicap >= 2 arranca Blanco (Negro ya "colocó" su ventaja), si no arranca Negro.
 */
export function currentTurn(handicap: number, moves: Move[]): StoneColor {
  const last = moves[moves.length - 1]
  if (last) return last.color === 'black' ? 'white' : 'black'
  return handicap >= 2 ? 'white' : 'black'
}

/**
 * Valida una jugada sin aplicarla, usando go-board como oráculo. legal = no es overwrite, ni
 * suicidio, ni ko. overwrite/suicidio/ko son mutuamente excluyentes en analyzeMove (overwrite es
 * sobre punto ocupado; suicidio/ko solo sobre punto vacío), así que reporta el primer motivo.
 */
export function validateMove(
  board: GoBoard,
  color: StoneColor,
  v: { x: number; y: number },
): { legal: boolean; reason?: 'ko' | 'suicide' | 'overwrite' } {
  const analysis = board.analyzeMove(colorToSign(color), [v.x, v.y])
  if (analysis.overwrite) return { legal: false, reason: 'overwrite' }
  if (analysis.suicide) return { legal: false, reason: 'suicide' }
  if (analysis.ko) return { legal: false, reason: 'ko' }
  return { legal: true }
}

/**
 * FIX 1 (Important, fix wave post-Fase 2): versión pura/no-lanzante de `boardFromMoves`, para
 * validar una secuencia de jugadas ANTES de confiar en ella (p.ej. la línea principal de un SGF
 * importado, sin garantías de legalidad). `boardFromMoves` LANZA ante overwrite/ko/suicidio; sin
 * esta validación, ese throw sólo se descubría en el RENDER de `ReadyPlayView` (`tree.boardAt()`),
 * fuera de cualquier try — con la SPA sin error boundary, eso deja la pantalla en blanco. Se usa en
 * `PlayView.handleImportFile`, DENTRO del try, antes de aceptar el árbol importado.
 */
export function isMoveSequenceLegal(boardSize: BoardSize, handicap: number, moves: Move[]): boolean {
  try {
    boardFromMoves(boardSize, handicap, moves)
    return true
  } catch {
    return false
  }
}

/**
 * Aplica una jugada y devuelve un tablero NUEVO (go-board es inmutable). Con los tres prevent-flags
 * activos: una jugada ilegal lanza (el caller debe validar antes con validateMove si no quiere que
 * lance).
 */
export function applyMove(board: GoBoard, color: StoneColor, v: { x: number; y: number }): GoBoard {
  return board.makeMove(colorToSign(color), [v.x, v.y], {
    preventSuicide: true,
    preventOverwrite: true,
    preventKo: true,
  })
}

/** signMap crudo para Shudan (indexado [y][x], igual que lo consume el tablero). */
export function signMapOf(board: GoBoard): SignMap {
  return board.signMap
}

/**
 * Capturas acumuladas por cada color: `black` = piedras que Negro ha capturado (getCaptures(1)),
 * `white` = piedras que Blanco ha capturado (getCaptures(-1)). Útil para el marcador de prisioneros.
 */
export function capturesOf(board: GoBoard): { black: number; white: number } {
  return { black: board.getCaptures(1), white: board.getCaptures(-1) }
}
