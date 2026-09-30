// Lógica pura de la sala de partidas online (humano vs humano): log de eventos → estado
// (`project`), intenciones → eventos (`reduce`), reloj autoritativo y fin por dos pases/timeout/
// rendición. Sin I/O: la consume el Durable Object (autoridad) y el cliente (validación local).
//
// Solo `import type` de @tengen/engine (el worker no debe arrastrar onnxruntime); el reloj viene
// del subpath liviano '@tengen/engine/clock'.
import { applyElapsed, initialClockState } from '@tengen/engine/clock'
import type { BoardSize, ClockConfig, ClockState, Move, StoneColor } from '@tengen/engine/types'
import { countArea } from './territory'
import { boardFromMoves, currentTurn, signMapOf, validateMove, type SetupStones } from './rules'
import { formatResult, isGameOverByTwoPasses } from './endgame'

export type SeatRole = 'creator' | 'guest'
export interface RoomConfig {
  boardSize: BoardSize
  komi: number
  handicap: number
  clock?: ClockConfig
  creatorColor: StoneColor | 'nigiri'
}
export type RoomEvent =
  | { seq: number; at: number; type: 'created'; config: RoomConfig; playerId: string }
  | { seq: number; at: number; type: 'joined'; seat: SeatRole; playerId: string }
  | { seq: number; at: number; type: 'started'; creatorColor: StoneColor }
  | { seq: number; at: number; type: 'move'; color: StoneColor; x: number; y: number; clock?: ClockState }
  | { seq: number; at: number; type: 'pass'; color: StoneColor; clock?: ClockState }
  | { seq: number; at: number; type: 'resign'; color: StoneColor }
  | { seq: number; at: number; type: 'timeout'; color: StoneColor }
  | { seq: number; at: number; type: 'ended'; result: string }
export type Intent =
  | { type: 'move'; x: number; y: number; seq: number }
  | { type: 'pass'; seq: number }
  | { type: 'resign'; seq: number }
export type RejectReason =
  | 'stale'
  | 'not-a-player'
  | 'not-started'
  | 'game-over'
  | 'not-your-turn'
  | 'illegal'
  | 'ko'
  | 'suicide'
  | 'occupied'
export interface RoomState {
  config: RoomConfig
  phase: 'waiting' | 'playing' | 'ended'
  colors?: Record<SeatRole, StoneColor>
  moves: Move[] // jugadas reales (handicap aparte), incluye pases
  toPlay?: StoneColor
  turnStartedAt?: number
  clocks?: Record<StoneColor, ClockState>
  result?: string
  nextSeq: number
}

const opposite = (c: StoneColor): StoneColor => (c === 'black' ? 'white' : 'black')

/** Reproduce el log de eventos. Lanza si el log está vacío o no empieza con `created`. */
export function project(events: readonly RoomEvent[]): RoomState {
  const first = events[0]
  if (!first || first.type !== 'created') throw new Error('room log must start with a created event')
  const state: RoomState = { config: first.config, phase: 'waiting', moves: [], nextSeq: first.seq + 1 }
  for (const ev of events) {
    state.nextSeq = ev.seq + 1
    switch (ev.type) {
      case 'created':
      case 'joined':
        break
      case 'started': {
        state.phase = 'playing'
        state.colors = { creator: ev.creatorColor, guest: opposite(ev.creatorColor) }
        state.turnStartedAt = ev.at
        if (state.config.clock) {
          const c = initialClockState(state.config.clock)
          state.clocks = { black: { ...c }, white: { ...c } }
        }
        break
      }
      case 'move':
      case 'pass': {
        state.moves.push({ color: ev.color, vertex: ev.type === 'move' ? { x: ev.x, y: ev.y } : 'pass' })
        state.turnStartedAt = ev.at
        if (ev.clock && state.clocks) state.clocks[ev.color] = ev.clock
        break
      }
      case 'resign':
      case 'timeout':
        break
      case 'ended':
        state.phase = 'ended'
        state.result = ev.result
        break
    }
  }
  if (state.phase === 'playing') state.toPlay = currentTurn(state.config.handicap, state.moves)
  return state
}

export function createRoom(config: RoomConfig, playerId: string, now: number): RoomEvent[] {
  return [{ seq: 0, at: now, type: 'created', config, playerId }]
}

export function joinSeat(
  events: readonly RoomEvent[],
  playerId: string,
  now: number,
  rng: () => number = Math.random,
): { seat: SeatRole; events: RoomEvent[] } | null {
  const state = project(events)
  const created = events[0]
  if (!created || created.type !== 'created') return null
  if (events.some((e) => e.type === 'joined' && e.seat === 'guest')) return null
  if (created.playerId === playerId) return null
  const cc = state.config.creatorColor
  const creatorColor: StoneColor = cc === 'nigiri' ? (rng() < 0.5 ? 'black' : 'white') : cc
  const seq = state.nextSeq
  return {
    seat: 'guest',
    events: [
      { seq, at: now, type: 'joined', seat: 'guest', playerId },
      { seq: seq + 1, at: now, type: 'started', creatorColor },
    ],
  }
}

export function validateIntentLocally(
  state: RoomState,
  seat: SeatRole | 'spectator',
  intent: Intent,
): RejectReason | null {
  if (seat === 'spectator') return 'not-a-player'
  if (state.phase === 'waiting') return 'not-started'
  if (state.phase === 'ended') return 'game-over'
  if (intent.seq !== state.nextSeq) return 'stale'
  const color = state.colors?.[seat]
  if (!color) return 'not-started'
  if (intent.type !== 'resign' && color !== state.toPlay) return 'not-your-turn'
  if (intent.type === 'move') {
    const n = state.config.boardSize
    const inRange = (v: number) => Number.isInteger(v) && v >= 0 && v < n
    if (!inRange(intent.x) || !inRange(intent.y)) return 'illegal'
    const board = boardFromMoves(n, state.config.handicap, state.moves)
    const r = validateMove(board, color, { x: intent.x, y: intent.y })
    if (!r.legal) return r.reason === 'overwrite' ? 'occupied' : (r.reason ?? 'illegal')
  }
  return null
}

function setupFromBoard(board: ReturnType<typeof boardFromMoves>): SetupStones {
  const setup: SetupStones = { black: [], white: [] }
  signMapOf(board).forEach((row, y) =>
    row.forEach((sign, x) => {
      if (sign === 1) setup.black.push({ x, y })
      else if (sign === -1) setup.white.push({ x, y })
    }),
  )
  return setup
}

function timeoutEvents(color: StoneColor, seq: number, now: number): RoomEvent[] {
  return [
    { seq, at: now, type: 'timeout', color },
    { seq: seq + 1, at: now, type: 'ended', result: color === 'black' ? 'W+T' : 'B+T' },
  ]
}

export function reduce(
  events: readonly RoomEvent[],
  seat: SeatRole | 'spectator',
  intent: Intent,
  now: number,
): { events: RoomEvent[] } | { rejected: RejectReason } {
  const state = project(events)
  const rejected = validateIntentLocally(state, seat, intent)
  if (rejected) return { rejected }
  if (seat === 'spectator' || !state.colors) return { rejected: 'not-a-player' }
  const color = state.colors[seat]
  const seq = state.nextSeq

  if (intent.type === 'resign') {
    return {
      events: [
        { seq, at: now, type: 'resign', color },
        { seq: seq + 1, at: now, type: 'ended', result: formatResult(0, color) },
      ],
    }
  }

  let clock: ClockState | undefined
  const clockCfg = state.config.clock
  if (clockCfg && state.clocks) {
    const elapsed = Math.max(0, now - (state.turnStartedAt ?? now))
    const r = applyElapsed(state.clocks[color], clockCfg, elapsed)
    if (r.timedOut) return { events: timeoutEvents(color, seq, now) }
    clock = r.state
  }

  const out: RoomEvent[] =
    intent.type === 'move'
      ? [{ seq, at: now, type: 'move', color, x: intent.x, y: intent.y, ...(clock ? { clock } : {}) }]
      : [{ seq, at: now, type: 'pass', color, ...(clock ? { clock } : {}) }]

  const moves: Move[] = [
    ...state.moves,
    { color, vertex: intent.type === 'move' ? { x: intent.x, y: intent.y } : 'pass' },
  ]
  if (isGameOverByTwoPasses(moves)) {
    const { boardSize, handicap, komi } = state.config
    const board = boardFromMoves(boardSize, handicap, moves)
    const area = countArea(boardSize, setupFromBoard(board))
    out.push({ seq: seq + 1, at: now, type: 'ended', result: formatResult(area.black - (area.white + komi)) })
  }
  return { events: out }
}

export function flagDeadline(state: RoomState): number | undefined {
  const cfg = state.config.clock
  if (!cfg || state.phase !== 'playing' || !state.clocks || !state.toPlay || state.turnStartedAt === undefined) {
    return undefined
  }
  const c = state.clocks[state.toPlay]
  const budget = c.inByoyomi
    ? c.byoyomiPeriodsRemaining * cfg.byoyomiPeriodMs
    : c.mainTimeRemainingMs + cfg.byoyomiPeriods * cfg.byoyomiPeriodMs
  return state.turnStartedAt + budget
}

export function onAlarm(events: readonly RoomEvent[], now: number): RoomEvent[] {
  const state = project(events)
  const deadline = flagDeadline(state)
  if (deadline === undefined || !state.toPlay || now < deadline) return []
  return timeoutEvents(state.toPlay, state.nextSeq, now)
}
