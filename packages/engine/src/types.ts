export type StoneColor = 'black' | 'white'
export type BoardSize = 9 | 13 | 19
export type Rules = 'chinese' | 'japanese'
export type NetworkId = 'b18' | 'humanv0' | 'b10'
export type RankLevel = { kind: 'human'; rank: HumanRank } | { kind: 'kata'; visits: number }
export type HumanRank =
  | '20k'
  | '19k'
  | '18k'
  | '17k'
  | '16k'
  | '15k'
  | '14k'
  | '13k'
  | '12k'
  | '11k'
  | '10k'
  | '9k'
  | '8k'
  | '7k'
  | '6k'
  | '5k'
  | '4k'
  | '3k'
  | '2k'
  | '1k'
  | '1d'
  | '2d'
  | '3d'
  | '4d'
  | '5d'
  | '6d'
  | '7d'
  | '8d'
  | '9d'

export const HUMAN_RANKS = [
  '20k',
  '19k',
  '18k',
  '17k',
  '16k',
  '15k',
  '14k',
  '13k',
  '12k',
  '11k',
  '10k',
  '9k',
  '8k',
  '7k',
  '6k',
  '5k',
  '4k',
  '3k',
  '2k',
  '1k',
  '1d',
  '2d',
  '3d',
  '4d',
  '5d',
  '6d',
  '7d',
  '8d',
  '9d',
] as const

export type Vertex = { x: number; y: number } | 'pass'
export type Move = { color: StoneColor; vertex: Vertex }
export type Position = {
  boardSize: BoardSize
  komi: number
  rules: Rules
  handicap: number // piedras de handicap colocadas (0 = sin handicap)
  moves: Move[] // desde el inicio (tras handicap), en orden
}
export type MoveAnalysis = {
  vertex: Vertex
  visits: number
  winrate: number // persp. Negro
  scoreLead: number
  prior: number
  pv: Vertex[]
}
export type Analysis = {
  winrate: number
  scoreLead: number
  scoreStdev: number
  visits: number // persp. Negro
  moves: MoveAnalysis[]
  ownership?: Float32Array
}
export type CancelFn = () => void
export interface Engine {
  init(config: { network: NetworkId; boardSize: BoardSize }): Promise<void>
  genMove(pos: Position, opts: { level: RankLevel }): Promise<Move>
  // `onError` (4º parámetro, opcional): canal de error POR-LLAMADA — si el motor lanza durante este
  // `analyze` específico, se invoca en vez de perderse en silencio (Fase 3a Task 1, M-2). Aditivo: los
  // callers de Fase 2 que sólo pasan 3 argumentos siguen funcionando sin cambios.
  analyze(
    pos: Position,
    opts: { visits: number },
    onUpdate: (a: Analysis) => void,
    onError?: (e: unknown) => void,
  ): CancelFn
  stop(): void
}
