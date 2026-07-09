// Wiring de alto nivel del MCTS. Archivo 100% de tengen (no adaptado de upstream): mapea un
// `GameState` (encoding/gameState.ts, Task 5) a lo que `MctsSearch.create` (vendor/web-katrain,
// adaptado en Task 8) espera —`board`/`previousBoard`/`previousPreviousBoard`/`moveHistory` en el
// `Move` local del vendor `{x,y,player}`— e inyecta el `NNEvaluator`. Fija los defaults deterministas
// que el gate de tests exige (nnRandomize=false, rootSymmetrySamples=1 → simetría identidad, sin
// ownership). El evaluador ONNX real es Task 9.

import type { NNEvaluator } from '../nn/evaluator'
import type { GameState } from '../encoding/gameState'
import { MctsSearch } from '../vendor/web-katrain/analyzeMcts'
import { BLACK, PASS_MOVE } from '../vendor/web-katrain/fastBoard'

type Player = 'black' | 'white'
type BoardCell = 'black' | 'white' | null
type BoardState = BoardCell[][] // índice [y][x], null = vacío
type VendorMove = { x: number; y: number; player: Player } // Move local del vendor (row-major), no {color,vertex}

// Inverso de `boardStateToStones` del vendor: `stones` (0 vacío / 1 negro / 2 blanco) → matriz [y][x].
function stonesToBoardState(stones: Uint8Array, n: number): BoardState {
  const board: BoardState = new Array(n)
  for (let y = 0; y < n; y++) {
    const row: BoardCell[] = new Array(n)
    for (let x = 0; x < n; x++) {
      const v = stones[y * n + x]
      row[x] = v === 0 || v === undefined ? null : v === BLACK ? 'black' : 'white'
    }
    board[y] = row
  }
  return board
}

/**
 * Construye una búsqueda MCTS lista para `run()`/`getAnalysis()` a partir de un `GameState` y un
 * evaluador de red inyectado. El `bin` NCHW del root se regenera dentro de `create()` con el mismo
 * encoder V7 (`fillFeaturesV7NCHW`) que produjo `state`, así que el puente es idempotente (gate del
 * test 3). `conservativePass`/`wideRootNoise` por defecto 0/false para determinismo.
 */
export async function createSearch(args: {
  evaluator: NNEvaluator
  state: GameState
  conservativePass?: boolean
  wideRootNoise?: number
}): Promise<MctsSearch> {
  const { evaluator, state } = args
  const n = state.boardSize

  const board = stonesToBoardState(state.stones, n)
  const previousBoard = stonesToBoardState(state.prevStones, n)
  const previousPreviousBoard = stonesToBoardState(state.prevPrevStones, n)

  const moveHistory: VendorMove[] = state.recentMoves.map((m) => ({
    x: m.move === PASS_MOVE ? -1 : m.move % n,
    y: m.move === PASS_MOVE ? -1 : (m.move / n) | 0,
    player: m.player,
  }))

  return MctsSearch.create({
    evaluator,
    board,
    previousBoard,
    previousPreviousBoard,
    currentPlayer: state.currentPlayer,
    moveHistory,
    komi: state.komi,
    rules: state.rules,
    nnRandomize: false, // determinismo: sin simetría aleatoria
    conservativePass: args.conservativePass ?? false,
    maxChildren: n * n + 1, // todos los puntos legales + pase
    ownershipMode: 'none', // Task 8 no necesita ownership
    wideRootNoise: args.wideRootNoise ?? 0,
    rootSymmetrySamples: 1, // identidad → el bin del root == encoding sin transformar (gate test 3)
  })
}
