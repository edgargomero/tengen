import GoBoard from '@sabaki/go-board'
import type { Move } from '@tengen/engine'
import { describe, expect, it } from 'vitest'
import {
  applyMove,
  boardFromMoves,
  capturesOf,
  currentTurn,
  handicapVertices,
  isMoveSequenceLegal,
  signMapOf,
  validateMove,
} from '../src/game/rules'

// Serializa un conjunto de tuplas [x,y] a Set<string> para comparar sin depender del orden.
function asSet(pts: [number, number][]): Set<string> {
  return new Set(pts.map(([x, y]) => `${x},${y}`))
}

// Puntos de handicap esperados (19×19), verificados contra go-board real (hecho #2 del brief).
const EXPECTED_HANDICAP: Record<number, [number, number][]> = {
  2: [[3, 15], [15, 3]],
  3: [[3, 15], [15, 3], [15, 15]],
  4: [[3, 15], [15, 3], [15, 15], [3, 3]],
  5: [[3, 15], [15, 3], [15, 15], [3, 3], [9, 9]],
  6: [[3, 15], [15, 3], [15, 15], [3, 3], [3, 9], [15, 9]],
  7: [[3, 15], [15, 3], [15, 15], [3, 3], [3, 9], [15, 9], [9, 9]],
  8: [[3, 15], [15, 3], [15, 15], [3, 3], [3, 9], [15, 9], [9, 3], [9, 15]],
  9: [[3, 15], [15, 3], [15, 15], [3, 3], [3, 9], [15, 9], [9, 3], [9, 15], [9, 9]],
}

describe('handicapVertices', () => {
  it('h=0 y h=1 → [] (sin piedras de handicap)', () => {
    expect(handicapVertices(19, 0)).toEqual([])
    expect(handicapVertices(19, 1)).toEqual([])
  })

  it('h=2..9 coincide (como conjunto) con los hoshi verificados', () => {
    for (let h = 2; h <= 9; h++) {
      expect(asSet(handicapVertices(19, h))).toEqual(asSet(EXPECTED_HANDICAP[h]!))
    }
  })
})

describe('currentTurn', () => {
  it('sin handicap y sin jugadas → negro', () => {
    expect(currentTurn(0, [])).toBe('black')
  })

  it('con handicap 2 y sin jugadas → blanco', () => {
    expect(currentTurn(2, [])).toBe('white')
  })

  it('tras una jugada negra → blanco (alterna)', () => {
    const moves: Move[] = [{ color: 'black', vertex: { x: 3, y: 3 } }]
    expect(currentTurn(0, moves)).toBe('white')
  })

  it('con handicap 2, tras la primera jugada blanca → negro', () => {
    const moves: Move[] = [{ color: 'white', vertex: { x: 3, y: 3 } }]
    expect(currentTurn(2, moves)).toBe('black')
  })
})

describe('boardFromMoves', () => {
  it('coloca las piedras de handicap (negras) en los hoshi', () => {
    const board = boardFromMoves(19, 2, [])
    for (const [x, y] of handicapVertices(19, 2)) {
      expect(board.get([x, y])).toBe(1)
    }
  })

  it('aplica las jugadas reales en orden (negro=1, blanco=-1)', () => {
    const moves: Move[] = [
      { color: 'black', vertex: { x: 3, y: 3 } },
      { color: 'white', vertex: { x: 15, y: 15 } },
    ]
    const board = boardFromMoves(19, 0, moves)
    expect(board.get([3, 3])).toBe(1)
    expect(board.get([15, 15])).toBe(-1)
  })

  it('ignora los pases (no cambian el tablero, no lanzan)', () => {
    const moves: Move[] = [
      { color: 'black', vertex: { x: 2, y: 2 } },
      { color: 'white', vertex: 'pass' },
      { color: 'black', vertex: { x: 6, y: 6 } },
    ]
    const board = boardFromMoves(9, 0, moves)
    expect(board.get([2, 2])).toBe(1)
    expect(board.get([6, 6])).toBe(1)
  })

  it('deja que makeMove lance ante un historial ilegal (overwrite)', () => {
    const moves: Move[] = [
      { color: 'black', vertex: { x: 2, y: 2 } },
      { color: 'white', vertex: { x: 2, y: 2 } },
    ]
    expect(() => boardFromMoves(9, 0, moves)).toThrow()
  })
})

describe('validateMove (go-board como oráculo)', () => {
  it('jugar sobre una piedra existente → ilegal (overwrite)', () => {
    const board = applyMove(GoBoard.fromDimensions(9), 'black', { x: 4, y: 4 })
    expect(validateMove(board, 'white', { x: 4, y: 4 })).toEqual({
      legal: false,
      reason: 'overwrite',
    })
  })

  it('suicidio real → ilegal (suicide)', () => {
    // Negro rodea el punto (1,1); blanco jugando ahí se autocaptura.
    let board = GoBoard.fromDimensions(9)
    for (const v of [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }]) {
      board = applyMove(board, 'black', v)
    }
    expect(validateMove(board, 'white', { x: 1, y: 1 })).toEqual({
      legal: false,
      reason: 'suicide',
    })
  })

  it('captura simple → legal', () => {
    // Blanco en la esquina (0,0) con una libertad; negro juega (0,1) y la captura.
    let board = applyMove(GoBoard.fromDimensions(9), 'white', { x: 0, y: 0 })
    board = applyMove(board, 'black', { x: 1, y: 0 })
    expect(validateMove(board, 'black', { x: 0, y: 1 })).toEqual({ legal: true })
  })

  it('recaptura inmediata de ko → ilegal (ko)', () => {
    // Ko de 1 punto canónico: blanco (4,3) queda con una única libertad (3,3).
    let board = GoBoard.fromDimensions(9)
    for (const v of [{ x: 2, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 4 }]) {
      board = applyMove(board, 'white', v)
    }
    for (const v of [{ x: 5, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 4 }]) {
      board = applyMove(board, 'black', v)
    }
    board = applyMove(board, 'white', { x: 4, y: 3 })
    // Negro captura la piedra blanca en (4,3) jugando en (3,3).
    const afterCapture = applyMove(board, 'black', { x: 3, y: 3 })
    // Blanco intenta recapturar de inmediato en (4,3) → ko.
    expect(validateMove(afterCapture, 'white', { x: 4, y: 3 })).toEqual({
      legal: false,
      reason: 'ko',
    })
  })
})

describe('applyMove', () => {
  it('devuelve un tablero nuevo con la jugada aplicada', () => {
    const board = GoBoard.fromDimensions(9)
    const next = applyMove(board, 'black', { x: 4, y: 4 })
    expect(next).not.toBe(board)
    expect(board.get([4, 4])).toBe(0) // el original no se muta
    expect(next.get([4, 4])).toBe(1)
  })

  it('una captura simple reduce libertades y sube el contador de capturas', () => {
    let board = applyMove(GoBoard.fromDimensions(9), 'white', { x: 0, y: 0 })
    board = applyMove(board, 'black', { x: 1, y: 0 })
    const after = applyMove(board, 'black', { x: 0, y: 1 })
    expect(after.get([0, 0])).toBe(0) // la piedra blanca fue capturada
    expect(capturesOf(after)).toEqual({ black: 1, white: 0 })
  })
})

// FIX 1 (Important, fix wave post-Fase 2): `boardFromMoves` LANZA ante una jugada ilegal
// (overwrite/ko/suicidio) — antes, esa reconstrucción sólo ocurría en el RENDER de `ReadyPlayView`
// (`tree.boardAt()`), fuera de cualquier try, con la SPA sin error boundary → pantalla blanca ante
// un SGF importado ilegal. `isMoveSequenceLegal` es la versión pura/no-lanzante (atrapa el throw),
// que `PlayView.handleImportFile` usa DENTRO de su try para rechazar el import con un mensaje
// recuperable en vez de dejar que el throw escape al render.
describe('isMoveSequenceLegal (FIX 1: valida un import antes de aceptarlo)', () => {
  it('secuencia legal → true', () => {
    const moves: Move[] = [
      { color: 'black', vertex: { x: 3, y: 3 } },
      { color: 'white', vertex: { x: 15, y: 15 } },
    ]
    expect(isMoveSequenceLegal(19, 0, moves)).toBe(true)
  })

  it('overwrite (dos jugadas en el mismo vértice) → false, sin lanzar', () => {
    const moves: Move[] = [
      { color: 'black', vertex: { x: 4, y: 4 } },
      { color: 'white', vertex: { x: 4, y: 4 } },
    ]
    expect(() => isMoveSequenceLegal(9, 0, moves)).not.toThrow()
    expect(isMoveSequenceLegal(9, 0, moves)).toBe(false)
  })

  it('suicidio real → false', () => {
    const moves: Move[] = [
      { color: 'black', vertex: { x: 1, y: 0 } },
      { color: 'black', vertex: { x: 0, y: 1 } },
      { color: 'black', vertex: { x: 1, y: 2 } },
      { color: 'black', vertex: { x: 2, y: 1 } },
      { color: 'white', vertex: { x: 1, y: 1 } },
    ]
    expect(isMoveSequenceLegal(9, 0, moves)).toBe(false)
  })

  it('los pases no afectan la legalidad', () => {
    const moves: Move[] = [
      { color: 'black', vertex: { x: 2, y: 2 } },
      { color: 'white', vertex: 'pass' },
      { color: 'black', vertex: { x: 4, y: 4 } },
    ]
    expect(isMoveSequenceLegal(9, 0, moves)).toBe(true)
  })

  it('secuencia vacía (partida recién importada sin jugadas) → true', () => {
    expect(isMoveSequenceLegal(19, 0, [])).toBe(true)
  })
})

describe('signMapOf', () => {
  it('refleja las piedras indexando [y][x]', () => {
    const board = boardFromMoves(19, 0, [{ color: 'black', vertex: { x: 3, y: 15 } }])
    const signMap = signMapOf(board)
    expect(signMap[15]?.[3]).toBe(1)
    expect(signMap[3]?.[15]).toBe(0)
  })
})

describe('capturesOf', () => {
  it('tablero inicial → sin capturas', () => {
    expect(capturesOf(GoBoard.fromDimensions(9))).toEqual({ black: 0, white: 0 })
  })
})
