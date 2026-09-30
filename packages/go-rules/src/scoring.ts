// Conteo de fin de partida con piedras muertas marcadas, por reglas chinas (área) o japonesas
// (territorio + prisioneros). Módulo puro; solo `import type` de @tengen/engine.
import type { BoardSize, Move, Rules } from '@tengen/engine/types'
import { boardFromMoves, capturesOf, signMapOf, type SetupStones } from './rules'
import { countArea } from './territory'
import { formatResult } from './endgame'

export interface Vertex {
  x: number
  y: number
}
export interface SideScore {
  stones: number
  territory: number
  prisoners: number
  komi: number
  total: number
}
export interface ScoreBreakdown {
  rules: Rules
  black: SideScore
  white: SideScore
  result: string
}
export interface ScoreInput {
  boardSize: BoardSize
  handicap: number
  moves: Move[]
  dead: Vertex[]
  rules: Rules
  komi: number
}

const key = (v: Vertex) => `${v.x},${v.y}`

/** Cadena del mismo color que contiene `v`; `[]` si `v` está vacío o fuera del tablero. */
export function chainAt(boardSize: BoardSize, handicap: number, moves: Move[], v: Vertex): Vertex[] {
  const board = boardFromMoves(boardSize, handicap, moves)
  if (!board.has([v.x, v.y]) || board.get([v.x, v.y]) === 0) return []
  return board.getChain([v.x, v.y]).map(([x, y]) => ({ x, y }))
}

function liveSetup(input: Omit<ScoreInput, 'rules' | 'komi'>) {
  const board = boardFromMoves(input.boardSize, input.handicap, input.moves)
  const dead = new Set(input.dead.map(key))
  const setup: SetupStones = { black: [], white: [] }
  let deadBlack = 0
  let deadWhite = 0
  signMapOf(board).forEach((row, y) =>
    row.forEach((sign, x) => {
      if (sign === 0) return
      const isDead = dead.has(key({ x, y }))
      if (sign === 1) {
        if (isDead) deadBlack++
        else setup.black.push({ x, y })
      } else if (isDead) deadWhite++
      else setup.white.push({ x, y })
    }),
  )
  return { board, setup, deadBlack, deadWhite }
}

export function scoreGame(input: ScoreInput): ScoreBreakdown {
  const { board, setup, deadBlack, deadWhite } = liveSetup(input)
  const area = countArea(input.boardSize, setup)
  const caps = capturesOf(board)
  const chinese = input.rules === 'chinese'
  const side = (stones: number, areaN: number, prisoners: number, komi: number): SideScore => {
    const territory = areaN - stones
    const total = chinese ? stones + territory + komi : territory + prisoners + komi
    return { stones, territory, prisoners: chinese ? 0 : prisoners, komi, total }
  }
  const black = side(setup.black.length, area.black, caps.black + deadWhite, 0)
  const white = side(setup.white.length, area.white, caps.white + deadBlack, input.komi)
  return { rules: input.rules, black, white, result: formatResult(black.total - white.total) }
}

/** [y][x]: 1 negro, -1 blanco, 0 dame. Piedras vivas y territorio; las muertas cuentan para el rival. */
export function ownershipMap(input: Omit<ScoreInput, 'rules' | 'komi'>): (-1 | 0 | 1)[][] {
  const { setup } = liveSetup(input)
  const n = input.boardSize
  const board = boardFromMoves(n, 0, [], setup)
  const out: (-1 | 0 | 1)[][] = Array.from({ length: n }, () => Array<-1 | 0 | 1>(n).fill(0))
  const seen = new Set<string>()
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const sign = board.get([x, y])
      const row = out[y]
      if (!row) continue
      if (sign !== 0) {
        row[x] = sign === 1 ? 1 : -1
        continue
      }
      if (seen.has(`${x},${y}`)) continue
      const region = board.getConnectedComponent([x, y], (v) => board.get(v) === 0)
      let b = false
      let w = false
      for (const [rx, ry] of region) {
        seen.add(`${rx},${ry}`)
        for (const nb of board.getNeighbors([rx, ry])) {
          const s = board.get(nb)
          if (s === 1) b = true
          else if (s === -1) w = true
        }
      }
      const owner: -1 | 0 | 1 = b && !w ? 1 : w && !b ? -1 : 0
      for (const [rx, ry] of region) {
        const r = out[ry]
        if (r) r[rx] = owner
      }
    }
  }
  return out
}
