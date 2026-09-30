import { describe, expect, it } from 'vitest'
import {
  SCORING_TIMEOUT_MS,
  createRoom,
  flagDeadline,
  scoringDeadline,
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
    expect(ev[ev.length - 1]).toMatchObject({ type: 'scoring' })
    ev = play(ev, 'creator', { type: 'accept' }, T0 + 4)
    ev = play(ev, 'guest', { type: 'accept' }, T0 + 5)
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
    ev = play(ev, 'creator', { type: 'accept' }, T0 + 4)
    ev = play(ev, 'guest', { type: 'accept' }, T0 + 5)
    expect(project(ev).result).toBe('B+2.0')
  })

  it('resign fuera de turno → aceptado', () => {
    const ev = play(started(), 'guest', { type: 'resign' }, T0 + 5)
    expect(ev.slice(-2).map((e) => e.type)).toEqual(['resign', 'ended'])
    expect(project(ev).result).toBe('B+R')
  })
})

describe('sala: fase de conteo', () => {
  const REAL = 'gc cg gg cc de ef fe dd ee ce ec df eh ff gf dh db cb da ca ed dc eb fg fh ei fi ci di eg gh ei - di - -'
  // Reproduce una partida (negro = creador, alterna) con pases '-'; los dos últimos pases abren el conteo.
  function game(config: RoomConfig, seq = REAL): RoomEvent[] {
    let ev = started(config)
    seq.split(' ').forEach((c, i) => {
      const seat: SeatRole = i % 2 === 0 ? 'creator' : 'guest'
      ev = play(ev, seat, c === '-' ? { type: 'pass' } : { type: 'move', x: c.charCodeAt(0) - 97, y: c.charCodeAt(1) - 97 }, T0 + 10 + i)
    })
    return ev
  }
  // Tablero con muros: negro x=3, blanco x=6 (como los tests de área), listo para dos pases.
  function walls(config: RoomConfig = cfg()): RoomEvent[] {
    let ev = started(config)
    for (let y = 0; y < 9; y++) {
      ev = B(ev, 3, y)
      ev = W(ev, 6, y)
    }
    ev = play(ev, 'creator', { type: 'pass' }, T0 + 2)
    return play(ev, 'guest', { type: 'pass' }, T0 + 3)
  }
  const last = (ev: RoomEvent[]) => ev[ev.length - 1]!

  it('1. dos pases → scoring (no ended); flagDeadline undefined', () => {
    const ev = walls(cfg({ clock: CLOCK }))
    expect(last(ev)).toMatchObject({ type: 'scoring' })
    expect(ev.some((e) => e.type === 'ended')).toBe(false)
    const s = project(ev)
    expect(s.phase).toBe('scoring')
    expect(s.toPlay).toBeUndefined()
    expect(s.dead).toEqual([])
    expect(flagDeadline(s)).toBeUndefined()
  })

  it('2. toggle-dead marca la cadena entera; segundo toggle la quita; vacío → illegal', () => {
    let ev = walls()
    ev = play(ev, 'creator', { type: 'toggle-dead', x: 6, y: 4 }, T0 + 4)
    const s = project(ev)
    expect(s.dead).toHaveLength(9)
    expect(s.dead).toContainEqual({ x: 6, y: 0 })
    ev = play(ev, 'guest', { type: 'toggle-dead', x: 6, y: 8 }, T0 + 5)
    expect(project(ev).dead).toEqual([])
    const seq = project(ev).nextSeq
    expect(reduce(ev, 'creator', { type: 'toggle-dead', x: 0, y: 0, seq }, T0 + 6)).toEqual({ rejected: 'illegal' })
    expect(reduce(ev, 'creator', { type: 'toggle-dead', x: 99, y: 0, seq }, T0 + 6)).toEqual({ rejected: 'illegal' })
  })

  it('3. aceptación previa se invalida al marcar; scoringDeadline = at del toggle + 5 min', () => {
    let ev = walls()
    ev = play(ev, 'creator', { type: 'accept' }, T0 + 4)
    expect(project(ev).accepted).toEqual({ black: true, white: false })
    ev = play(ev, 'guest', { type: 'toggle-dead', x: 6, y: 4 }, T0 + 50)
    const s = project(ev)
    expect(s.accepted).toEqual({ black: false, white: false })
    expect(scoringDeadline(s)).toBe(T0 + 50 + SCORING_TIMEOUT_MS)
  })

  it('4. ambos aceptan: japonesas W+0.5; sin rules → chinas W+1.5', () => {
    let ev = game(cfg({ komi: 6.5, rules: 'japanese' }))
    expect(project(ev).phase).toBe('scoring')
    ev = play(ev, 'creator', { type: 'accept' }, T0 + 100)
    ev = play(ev, 'guest', { type: 'accept' }, T0 + 101)
    expect(last(ev)).toMatchObject({ type: 'ended', result: 'W+0.5' })
    const s = project(ev)
    expect(s.phase).toBe('ended')
    expect(s.score?.white.total).toBe(29.5)

    let ev2 = game(cfg({ komi: 6.5 }))
    ev2 = play(ev2, 'guest', { type: 'accept' }, T0 + 100)
    ev2 = play(ev2, 'creator', { type: 'accept' }, T0 + 101)
    expect(project(ev2).result).toBe('W+1.5')
    expect(project(ev2).rules).toBe('chinese')
  })

  it('5. accept repetido → illegal; move en scoring → scoring; accept en playing → not-scoring', () => {
    let ev = walls()
    ev = play(ev, 'creator', { type: 'accept' }, T0 + 4)
    const seq = project(ev).nextSeq
    expect(reduce(ev, 'creator', { type: 'accept', seq }, T0 + 5)).toEqual({ rejected: 'illegal' })
    expect(reduce(ev, 'guest', { type: 'move', x: 0, y: 0, seq }, T0 + 5)).toEqual({ rejected: 'scoring' })
    expect(reduce(ev, 'guest', { type: 'pass', seq }, T0 + 5)).toEqual({ rejected: 'scoring' })
    const pl = started()
    const s = project(pl)
    expect(validateIntentLocally(s, 'creator', { type: 'accept', seq: s.nextSeq })).toBe('not-scoring')
    expect(validateIntentLocally(s, 'creator', { type: 'resume', seq: s.nextSeq })).toBe('not-scoring')
    expect(validateIntentLocally(s, 'creator', { type: 'toggle-dead', x: 0, y: 0, seq: s.nextSeq })).toBe('not-scoring')
  })

  it('6. resume → playing, dead vacío, toPlay = currentTurn y el reloj no descuenta el conteo', () => {
    let ev = walls(cfg({ clock: CLOCK }))
    ev = play(ev, 'creator', { type: 'toggle-dead', x: 6, y: 4 }, T0 + 4)
    ev = play(ev, 'guest', { type: 'resume' }, T0 + 200_000)
    expect(last(ev)).toMatchObject({ type: 'resumed', by: 'white' })
    const s = project(ev)
    expect(s.phase).toBe('playing')
    expect(s.dead).toEqual([])
    expect(s.accepted).toEqual({ black: false, white: false })
    expect(s.scoringSince).toBeUndefined()
    expect(s.toPlay).toBe('black')
    expect(s.turnStartedAt).toBe(T0 + 200_000)
  })

  it('7. tras resume, UN pase sigue playing; el segundo consecutivo → scoring', () => {
    let ev = walls()
    ev = play(ev, 'guest', { type: 'resume' }, T0 + 10)
    ev = play(ev, 'creator', { type: 'pass' }, T0 + 11)
    expect(project(ev).phase).toBe('playing')
    ev = play(ev, 'guest', { type: 'pass' }, T0 + 12)
    expect(last(ev)).toMatchObject({ type: 'scoring' })
    expect(project(ev).phase).toBe('scoring')
  })

  it('8. resign en scoring → ended B+R si se rinde Blanco', () => {
    const ev = play(walls(), 'guest', { type: 'resign' }, T0 + 5)
    expect(ev.slice(-2).map((e) => e.type)).toEqual(['resign', 'ended'])
    expect(project(ev).result).toBe('B+R')
  })

  it('9. onAlarm en scoring: antes → []; vencido con un aceptado → F; sin aceptados → resumed timeout', () => {
    let ev = walls()
    expect(scoringDeadline(project(walls()))).toBe(T0 + 3 + SCORING_TIMEOUT_MS)
    expect(onAlarm(ev, T0 + 3 + SCORING_TIMEOUT_MS - 1)).toEqual([])
    const none = onAlarm(ev, T0 + 3 + SCORING_TIMEOUT_MS)
    expect(none).toHaveLength(1)
    expect(none[0]).toMatchObject({ type: 'resumed', by: 'timeout' })
    ev = play(ev, 'creator', { type: 'accept' }, T0 + 10)
    const evs = onAlarm(ev, T0 + 10 + SCORING_TIMEOUT_MS)
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ type: 'ended', result: 'B+F' })
    let ev2 = walls()
    ev2 = play(ev2, 'guest', { type: 'accept' }, T0 + 10)
    expect(onAlarm(ev2, T0 + 10 + SCORING_TIMEOUT_MS)[0]).toMatchObject({ type: 'ended', result: 'W+F' })
  })
})
