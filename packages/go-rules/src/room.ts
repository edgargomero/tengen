// Lógica pura de la sala de partidas online (humano vs humano): log de eventos → estado
// (`project`), intenciones → eventos (`reduce`), reloj autoritativo y fin por dos pases/timeout/
// rendición. Sin I/O: la consume el Durable Object (autoridad) y el cliente (validación local).
//
// Solo `import type` de @tengen/engine (el worker no debe arrastrar onnxruntime); el reloj viene
// del subpath liviano '@tengen/engine/clock'.
import { applyElapsed, initialClockState } from '@tengen/engine/clock'
import type { BoardSize, ClockConfig, ClockState, Move, Rules, StoneColor } from '@tengen/engine/types'
import { boardFromMoves, currentTurn, validateMove } from './rules'
import { formatResult, isGameOverByTwoPasses } from './endgame'
import { chainAt, scoreGame, type ScoreBreakdown, type Vertex } from './scoring'

/** Plazo sin actividad en la fase de conteo antes de que la sala se resuelva sola. */
export const SCORING_TIMEOUT_MS = 5 * 60 * 1000

export type SeatRole = 'creator' | 'guest'
export interface RoomConfig {
  boardSize: BoardSize
  komi: number
  handicap: number
  clock?: ClockConfig
  creatorColor: StoneColor | 'nigiri'
  rules?: Rules
}
export type RoomEvent =
  | { seq: number; at: number; type: 'created'; config: RoomConfig; playerId: string }
  | { seq: number; at: number; type: 'joined'; seat: SeatRole; playerId: string }
  | { seq: number; at: number; type: 'started'; creatorColor: StoneColor }
  | { seq: number; at: number; type: 'move'; color: StoneColor; x: number; y: number; clock?: ClockState }
  | { seq: number; at: number; type: 'pass'; color: StoneColor; clock?: ClockState }
  | { seq: number; at: number; type: 'resign'; color: StoneColor }
  | { seq: number; at: number; type: 'timeout'; color: StoneColor }
  | { seq: number; at: number; type: 'scoring' }
  | { seq: number; at: number; type: 'dead-toggled'; color: StoneColor; x: number; y: number }
  | { seq: number; at: number; type: 'accepted'; color: StoneColor }
  | { seq: number; at: number; type: 'resumed'; by: StoneColor | 'timeout' }
  | { seq: number; at: number; type: 'ended'; result: string; score?: ScoreBreakdown }
export type Intent =
  | { type: 'move'; x: number; y: number; seq: number }
  | { type: 'pass'; seq: number }
  | { type: 'resign'; seq: number }
  | { type: 'toggle-dead'; x: number; y: number; seq: number }
  | { type: 'accept'; seq: number }
  | { type: 'resume'; seq: number }
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
  | 'scoring'
  | 'not-scoring'
export interface RoomState {
  config: RoomConfig
  phase: 'waiting' | 'playing' | 'scoring' | 'ended'
  colors?: Record<SeatRole, StoneColor>
  moves: Move[] // jugadas reales (handicap aparte), incluye pases
  toPlay?: StoneColor
  turnStartedAt?: number
  clocks?: Record<StoneColor, ClockState>
  result?: string
  nextSeq: number
  rules: Rules // config.rules ?? 'chinese'
  dead: Vertex[] // muertas marcadas (solo en scoring)
  accepted: Record<StoneColor, boolean>
  scoringSince?: number // at del último scoring/dead-toggled/accepted
  movesAtResume: number // moves.length al último started/resumed
  score?: ScoreBreakdown // del ended por conteo
}

export function effectiveRules(config: RoomConfig): Rules {
  return config.rules ?? 'chinese'
}

export function scoringDeadline(state: RoomState): number | undefined {
  return state.phase === 'scoring' && state.scoringSince !== undefined ? state.scoringSince + SCORING_TIMEOUT_MS : undefined
}

const opposite = (c: StoneColor): StoneColor => (c === 'black' ? 'white' : 'black')

/** Reproduce el log de eventos. Lanza si el log está vacío o no empieza con `created`. */
export function project(events: readonly RoomEvent[]): RoomState {
  const first = events[0]
  if (!first || first.type !== 'created') throw new Error('room log must start with a created event')
  const state: RoomState = {
    config: first.config,
    phase: 'waiting',
    moves: [],
    nextSeq: first.seq + 1,
    rules: effectiveRules(first.config),
    dead: [],
    accepted: { black: false, white: false },
    movesAtResume: 0,
  }
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
        state.movesAtResume = 0
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
      case 'scoring':
        state.phase = 'scoring'
        state.dead = []
        state.accepted = { black: false, white: false }
        state.scoringSince = ev.at
        break
      case 'dead-toggled': {
        const { boardSize, handicap } = state.config
        const chain = chainAt(boardSize, handicap, state.moves, { x: ev.x, y: ev.y })
        const has = (v: Vertex) => state.dead.some((d) => d.x === v.x && d.y === v.y)
        if (chain.every(has)) state.dead = state.dead.filter((d) => !chain.some((c) => c.x === d.x && c.y === d.y))
        else state.dead = [...state.dead, ...chain.filter((v) => !has(v))]
        state.accepted = { black: false, white: false }
        state.scoringSince = ev.at
        break
      }
      case 'accepted':
        state.accepted[ev.color] = true
        state.scoringSince = ev.at
        break
      case 'resumed':
        state.phase = 'playing'
        state.dead = []
        state.accepted = { black: false, white: false }
        state.scoringSince = undefined
        state.turnStartedAt = ev.at
        state.movesAtResume = state.moves.length
        break
      case 'ended':
        state.phase = 'ended'
        state.result = ev.result
        if (ev.score) state.score = ev.score
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
  // Lista blanca: un tipo desconocido no debe caer en la rama de `pass`.
  const known = ['move', 'pass', 'resign', 'toggle-dead', 'accept', 'resume']
  if (!known.includes(intent.type)) return 'illegal'
  if (state.phase === 'waiting') return 'not-started'
  if (state.phase === 'ended') return 'game-over'
  if (intent.seq !== state.nextSeq) return 'stale'
  const color = state.colors?.[seat]
  if (!color) return 'not-started'
  if (intent.type === 'toggle-dead' || intent.type === 'accept' || intent.type === 'resume') {
    if (state.phase !== 'scoring') return 'not-scoring'
    if (intent.type === 'accept' && state.accepted[color]) return 'illegal'
    if (intent.type === 'toggle-dead') {
      const n = state.config.boardSize
      const inRange = (v: number) => Number.isInteger(v) && v >= 0 && v < n
      if (!inRange(intent.x) || !inRange(intent.y)) return 'illegal'
      if (chainAt(n, state.config.handicap, state.moves, { x: intent.x, y: intent.y }).length === 0) return 'illegal'
    }
    return null
  }
  if (intent.type === 'resign') return null
  if (state.phase === 'scoring') return 'scoring'
  if (color !== state.toPlay) return 'not-your-turn'
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
  // Si el reloj de quien está en turno ya venció, el timeout gana a cualquier intención (incluida
  // la rendición de cualquiera de los dos): el resultado lo decide el tiempo, no quién escribió antes.
  const deadline = flagDeadline(state)
  if (seat !== 'spectator' && deadline !== undefined && state.toPlay && now >= deadline) {
    return { events: timeoutEvents(state.toPlay, state.nextSeq, now) }
  }
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

  if (state.phase === 'scoring') {
    if (intent.type === 'toggle-dead') return { events: [{ seq, at: now, type: 'dead-toggled', color, x: intent.x, y: intent.y }] }
    if (intent.type === 'resume') return { events: [{ seq, at: now, type: 'resumed', by: color }] }
    if (intent.type === 'accept') {
      const out: RoomEvent[] = [{ seq, at: now, type: 'accepted', color }]
      if (state.accepted[opposite(color)]) {
        const { boardSize, handicap, komi } = state.config
        const score = scoreGame({ boardSize, handicap, moves: state.moves, dead: state.dead, rules: state.rules, komi })
        out.push({ seq: seq + 1, at: now, type: 'ended', result: score.result, score })
      }
      return { events: out }
    }
    return { rejected: 'illegal' }
  }
  if (intent.type !== 'move' && intent.type !== 'pass') return { rejected: 'illegal' }

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
  if (isGameOverByTwoPasses(moves.slice(state.movesAtResume))) out.push({ seq: seq + 1, at: now, type: 'scoring' })
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
  if (state.phase === 'scoring') {
    const limit = scoringDeadline(state)
    if (limit === undefined || now < limit) return []
    const { black, white } = state.accepted
    if (black !== white) return [{ seq: state.nextSeq, at: now, type: 'ended', result: black ? 'B+F' : 'W+F' }]
    return [{ seq: state.nextSeq, at: now, type: 'resumed', by: 'timeout' }]
  }
  const deadline = flagDeadline(state)
  if (deadline === undefined || !state.toPlay || now < deadline) return []
  return timeoutEvents(state.toPlay, state.nextSeq, now)
}
