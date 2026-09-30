import { describe, expect, it } from 'vitest'
import {
  createRoom,
  flagDeadline,
  joinSeat,
  onAlarm,
  project,
  reduce,
  validateIntentLocally,
  type Intent,
  type RoomConfig,
  type RoomEvent,
  type SeatRole,
} from '../src/room'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
const T0 = 1_000_000
const cfg = (over: Partial<RoomConfig> = {}): RoomConfig => ({
  boardSize: 9,
  komi: 7,
  handicap: 0,
  creatorColor: 'black',
  ...over,
})
const CLOCK = { mainTimeMs: 60000, byoyomiPeriods: 3, byoyomiPeriodMs: 30000 }

function started(config: RoomConfig = cfg(), rng?: () => number): RoomEvent[] {
  const ev = createRoom(config, 'alice', T0)
  const j = joinSeat(ev, 'bob', T0, rng)
  if (!j) throw new Error('join failed')
  return [...ev, ...j.events]
}

function play(events: RoomEvent[], seat: SeatRole, intent: DistributiveOmit<Intent, 'seq'>, now: number): RoomEvent[] {
  const r = reduce(events, seat, { ...intent, seq: project(events).nextSeq } as Intent, now)
  if ('rejected' in r) throw new Error('rejected: ' + r.rejected)
  return [...events, ...r.events]
}

// creador = negro (alice), guest = blanco
const B = (events: RoomEvent[], x: number, y: number, now = T0 + 1) => play(events, 'creator', { type: 'move', x, y }, now)
const W = (events: RoomEvent[], x: number, y: number, now = T0 + 1) => play(events, 'guest', { type: 'move', x, y }, now)

describe('sala: creación y unión', () => {
  it('createRoom + joinSeat(guest) → started; project playing, toPlay black', () => {
    const ev = started()
    expect(ev.map((e) => e.type)).toEqual(['created', 'joined', 'started'])
    expect(ev.map((e) => e.seq)).toEqual([0, 1, 2])
    const s = project(ev)
    expect(s.phase).toBe('playing')
    expect(s.toPlay).toBe('black')
    expect(s.colors).toEqual({ creator: 'black', guest: 'white' })
    expect(s.nextSeq).toBe(3)
  })

  it('nigiri resuelve el color del creador con rng', () => {
    expect(project(started(cfg({ creatorColor: 'nigiri' }), () => 0.1)).colors?.creator).toBe('black')
    expect(project(started(cfg({ creatorColor: 'nigiri' }), () => 0.9)).colors?.creator).toBe('white')
  })

  it('joinSeat del creador o de un tercero tras el guest → null', () => {
    const ev = createRoom(cfg(), 'alice', T0)
    expect(joinSeat(ev, 'alice', T0)).toBeNull()
    const ev2 = started()
    expect(joinSeat(ev2, 'carol', T0)).toBeNull()
  })
})

describe('sala: jugadas y rechazos', () => {
  it('jugada válida → move con seq correcto; nextSeq avanza', () => {
    const ev = B(started(), 4, 4)
    const last = ev[ev.length - 1]!
    expect(last).toMatchObject({ type: 'move', color: 'black', x: 4, y: 4, seq: 3 })
    expect(project(ev).nextSeq).toBe(4)
    expect(project(ev).toPlay).toBe('white')
  })

  it('dos intenciones con el mismo seq → la segunda stale', () => {
    const ev = started()
    const seq = project(ev).nextSeq
    const r1 = reduce(ev, 'creator', { type: 'move', x: 4, y: 4, seq }, T0 + 1)
    expect('events' in r1).toBe(true)
    const ev2 = [...ev, ...('events' in r1 ? r1.events : [])]
    expect(reduce(ev2, 'guest', { type: 'move', x: 3, y: 3, seq }, T0 + 2)).toEqual({ rejected: 'stale' })
  })

  it('fuera de turno, espectador y antes de started', () => {
    const ev = started()
    const seq = project(ev).nextSeq
    expect(reduce(ev, 'guest', { type: 'move', x: 1, y: 1, seq }, T0)).toEqual({ rejected: 'not-your-turn' })
    expect(reduce(ev, 'spectator', { type: 'move', x: 1, y: 1, seq }, T0)).toEqual({ rejected: 'not-a-player' })
    const waiting = createRoom(cfg(), 'alice', T0)
    expect(reduce(waiting, 'creator', { type: 'move', x: 1, y: 1, seq: 1 }, T0)).toEqual({ rejected: 'not-started' })
  })

  it('fuera de rango → illegal', () => {
    const ev = started()
    const seq = project(ev).nextSeq
    expect(reduce(ev, 'creator', { type: 'move', x: 9, y: 0, seq }, T0)).toEqual({ rejected: 'illegal' })
    expect(reduce(ev, 'creator', { type: 'move', x: -1, y: 0, seq }, T0)).toEqual({ rejected: 'illegal' })
    expect(reduce(ev, 'creator', { type: 'move', x: 1.5, y: 0, seq }, T0)).toEqual({ rejected: 'illegal' })
  })

  it('ocupado, suicidio y ko', () => {
    let ev = B(started(), 4, 4)
    expect(reduce(ev, 'guest', { type: 'move', x: 4, y: 4, seq: project(ev).nextSeq }, T0)).toEqual({ rejected: 'occupied' })

    // suicidio: negro en (0,0) con blancas en (1,0),(0,1)
    ev = started()
    ev = B(ev, 8, 8)
    ev = W(ev, 1, 0)
    ev = B(ev, 8, 7)
    ev = W(ev, 0, 1)
    expect(reduce(ev, 'creator', { type: 'move', x: 0, y: 0, seq: project(ev).nextSeq }, T0)).toEqual({ rejected: 'suicide' })

    // ko
    ev = started()
    ev = B(ev, 1, 0)
    ev = W(ev, 2, 0)
    ev = B(ev, 0, 1)
    ev = W(ev, 3, 1)
    ev = B(ev, 1, 2)
    ev = W(ev, 2, 2)
    ev = B(ev, 8, 8)
    ev = W(ev, 1, 1)
    ev = B(ev, 2, 1) // captura (1,1)
    expect(reduce(ev, 'guest', { type: 'move', x: 1, y: 1, seq: project(ev).nextSeq }, T0)).toEqual({ rejected: 'ko' })
  })

  it('tras ended, cualquier intención → game-over', () => {
    const ev = play(started(), 'creator', { type: 'resign' }, T0 + 5)
    const seq = project(ev).nextSeq
    expect(reduce(ev, 'guest', { type: 'move', x: 1, y: 1, seq }, T0)).toEqual({ rejected: 'game-over' })
    expect(reduce(ev, 'creator', { type: 'pass', seq }, T0)).toEqual({ rejected: 'game-over' })
    expect(reduce(ev, 'guest', { type: 'resign', seq }, T0)).toEqual({ rejected: 'game-over' })
  })

  it('validateIntentLocally coincide con reduce', () => {
    const ev = started()
    const s = project(ev)
    expect(validateIntentLocally(s, 'creator', { type: 'pass', seq: s.nextSeq })).toBeNull()
    expect(validateIntentLocally(s, 'guest', { type: 'pass', seq: s.nextSeq })).toBe('not-your-turn')
  })
})

describe('sala: handicap y reloj', () => {
  it('handicap 2 en 19x19 → toPlay white y se descuenta el reloj de Blanco', () => {
    const ev0 = started(cfg({ boardSize: 19, handicap: 2, clock: CLOCK }))
    expect(project(ev0).toPlay).toBe('white')
    const ev = play(ev0, 'guest', { type: 'move', x: 3, y: 3 }, T0 + 10_000)
    const s = project(ev)
    expect(s.clocks?.white.mainTimeRemainingMs).toBe(50_000)
    expect(s.clocks?.black.mainTimeRemainingMs).toBe(60_000)
    expect(s.toPlay).toBe('black')
  })

  it('reloj: main, byoyomi, períodos y timeout sin evento move', () => {
    const base = started(cfg({ clock: CLOCK }))
    let s = project(play(base, 'creator', { type: 'move', x: 4, y: 4 }, T0 + 10_000))
    expect(s.clocks?.black).toEqual({ mainTimeRemainingMs: 50_000, byoyomiPeriodsRemaining: 3, inByoyomi: false })

    s = project(play(base, 'creator', { type: 'move', x: 4, y: 4 }, T0 + 70_000))
    expect(s.clocks?.black).toEqual({ mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true })

    s = project(play(base, 'creator', { type: 'move', x: 4, y: 4 }, T0 + 95_000))
    expect(s.clocks?.black.byoyomiPeriodsRemaining).toBe(2)

    const r = reduce(base, 'creator', { type: 'move', x: 4, y: 4, seq: project(base).nextSeq }, T0 + 150_000)
    expect('events' in r).toBe(true)
    if (!('events' in r)) return
    expect(r.events.map((e) => e.type)).toEqual(['timeout', 'ended'])
    expect(r.events[1]).toMatchObject({ result: 'W+T' })
    expect(r.events.map((e) => e.seq)).toEqual([3, 4])
  })

  it('flagDeadline exacto y onAlarm', () => {
    const base = started(cfg({ clock: CLOCK }))
    const d = flagDeadline(project(base))
    expect(d).toBe(T0 + 60_000 + 3 * 30_000)
    expect(onAlarm(base, d! - 1)).toEqual([])
    const ev = onAlarm(base, d!)
    expect(ev.map((e) => e.type)).toEqual(['timeout', 'ended'])
    expect(ev[1]).toMatchObject({ result: 'W+T' })
    expect(onAlarm([...base, ...ev], d! + 10)).toEqual([])
    expect(flagDeadline(project(started()))).toBeUndefined()
  })
})

describe('sala: rendición tras vencer el reloj (M-2)', () => {
  it('resign con el tiempo del que rinde ya vencido → timeout de él, no resign del rival', () => {
    const base = started(cfg({ clock: CLOCK }))
    const d = flagDeadline(project(base))!
    // Negras (creador, en turno) se rinden pero su reloj ya venció: pierden por tiempo.
    const r = reduce(base, 'creator', { type: 'resign', seq: 3 }, d)
    expect('events' in r).toBe(true)
    if (!('events' in r)) return
    expect(r.events.map((e) => e.type)).toEqual(['timeout', 'ended'])
    expect(r.events[1]).toMatchObject({ result: 'W+T' })
  })

  it('resign del rival (fuera de turno) con el reloj del jugador en turno vencido → pierde por tiempo el del turno', () => {
    const base = started(cfg({ clock: CLOCK }))
    const d = flagDeadline(project(base))!
    const r = reduce(base, 'guest', { type: 'resign', seq: 3 }, d + 5)
    if (!('events' in r)) throw new Error('rejected')
    expect(r.events[0]).toMatchObject({ type: 'timeout', color: 'black' })
    expect(r.events[1]).toMatchObject({ result: 'W+T' })
  })

  it('resign antes del deadline sigue siendo resign', () => {
    const base = started(cfg({ clock: CLOCK }))
    const d = flagDeadline(project(base))!
    const r = reduce(base, 'creator', { type: 'resign', seq: 3 }, d - 1)
    if (!('events' in r)) throw new Error('rejected')
    expect(r.events[0]).toMatchObject({ type: 'resign', color: 'black' })
  })
})

describe('sala: intenciones de tipo desconocido', () => {
  it('validateIntentLocally y reduce rechazan un type fuera de move|pass|resign', () => {
    const base = started()
    const bogus = { type: 'explode', seq: 3 } as unknown as Intent
    expect(validateIntentLocally(project(base), 'creator', bogus)).toBe('illegal')
    expect(reduce(base, 'creator', bogus, T0 + 1)).toEqual({ rejected: 'illegal' })
  })
})

describe('sala: fin de partida', () => {
  it('dos pases seguidos → ended con conteo de área + komi', () => {
    let ev = started(cfg({ komi: 0.5 }))
    for (let y = 0; y < 9; y++) {
      ev = B(ev, 3, y)
      ev = W(ev, 6, y)
    }
    ev = play(ev, 'creator', { type: 'pass' }, T0 + 2)
    expect(project(ev).phase).toBe('playing')
    ev = play(ev, 'guest', { type: 'pass' }, T0 + 3)
    // negro 36, blanco 27 + 0.5 komi → B+8.5
    expect(ev[ev.length - 1]).toMatchObject({ type: 'ended', result: 'B+8.5' })
    expect(project(ev).phase).toBe('ended')
    expect(project(ev).result).toBe('B+8.5')
  })

  it('B+2.0 con komi 7', () => {
    let ev = started()
    for (let y = 0; y < 9; y++) {
      ev = B(ev, 3, y)
      ev = W(ev, 6, y)
    }
    ev = play(ev, 'creator', { type: 'pass' }, T0 + 2)
    ev = play(ev, 'guest', { type: 'pass' }, T0 + 3)
    expect(project(ev).result).toBe('B+2.0')
  })

  it('resign fuera de turno → aceptado', () => {
    const ev = play(started(), 'guest', { type: 'resign' }, T0 + 5)
    expect(ev.slice(-2).map((e) => e.type)).toEqual(['resign', 'ended'])
    expect(project(ev).result).toBe('B+R')
  })
})
