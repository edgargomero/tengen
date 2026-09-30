import { describe, expect, it, vi } from 'vitest'
import type { RoomConfig, RoomEvent } from '@tengen/go-rules'
import { getPlayerId, getSeatToken, createRoom } from '../src/online/identity'
import { connectRoom, type RoomConnectionState } from '../src/online/roomClient'

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

class FakeSocket {
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e?: { code?: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {}
  send(s: string) { this.sent.push(s) }
  close() { this.closed = true; this.onclose?.() }
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  raw(data: string) { this.onmessage?.({ data }) }
  drop(code?: number) { this.onclose?.(code === undefined ? undefined : { code }) }
}

/** Temporizadores manuales: `advance(ms)` dispara los vencidos en orden. */
class FakeTimers {
  now = 0
  private next = 1
  private pending = new Map<number, { at: number; fn: () => void }>()
  set = (fn: () => void, ms: number) => { const id = this.next++; this.pending.set(id, { at: this.now + ms, fn }); return id }
  clear = (h: unknown) => { this.pending.delete(h as number) }
  advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      let best: [number, { at: number; fn: () => void }] | null = null
      for (const e of this.pending) if (e[1].at <= end && (!best || e[1].at < best[1].at)) best = e
      if (!best) break
      this.pending.delete(best[0])
      this.now = best[1].at
      best[1].fn()
    }
    this.now = end
  }
}

const config: RoomConfig = { boardSize: 9, komi: 6.5, handicap: 0, creatorColor: 'black' }
const created: RoomEvent = { seq: 0, at: 0, type: 'created', config, playerId: 'p1' }
const joined: RoomEvent = { seq: 1, at: 1, type: 'joined', seat: 'guest', playerId: 'p2' }
const started: RoomEvent = { seq: 2, at: 1, type: 'started', creatorColor: 'black' }
const base = [created, joined, started]

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)) }
const ok = (status = 200) => async () => ({ status, ok: status < 400, json: async () => ({}) }) as Response

function setup(fetchFn: (u: string) => Promise<Response> = ok()) {
  const storage = new MemStorage()
  const sockets: FakeSocket[] = []
  const states: RoomConnectionState[] = []
  const sleeps: number[] = []
  const timers = new FakeTimers()
  const wakes: Array<() => void> = []
  const conn = connectRoom('room1', {
    timers,
    onWake: (check) => { wakes.push(check); return () => {} },
    storage,
    fetchFn: fetchFn as never,
    onState: (s) => states.push(s),
    socketFactory: (url) => { const s = new FakeSocket(url); sockets.push(s); return s as unknown as WebSocket },
    sleep: async (ms) => { sleeps.push(ms) },
  })
  return { storage, sockets, states, sleeps, conn, timers, wake: () => wakes.forEach((w) => w()), last: () => states[states.length - 1]! }
}

describe('identity', () => {
  it('getPlayerId persiste y devuelve el mismo id', () => {
    const s = new MemStorage()
    const a = getPlayerId(s)
    expect(a).toBeTruthy()
    expect(getPlayerId(s)).toBe(a)
    expect(s.getItem('tengen.playerId')).toBe(a)
  })

  it('createRoom guarda el seatToken', async () => {
    const s = new MemStorage()
    let body: any
    const f = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      return { status: 201, ok: true, json: async () => ({ roomId: 'r9', seatToken: 'tok' }) }
    }) as never
    const r = await createRoom(config, f, s)
    expect(r).toEqual({ roomId: 'r9' })
    expect(getSeatToken(s, 'r9')).toBe('tok')
    expect(body.playerId).toBe(getPlayerId(s))
  })
})

describe('connectRoom', () => {
  it('welcome con seatToken lo guarda y expone open + eventos', async () => {
    const { sockets, storage, last } = setup()
    await flush()
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', seatToken: 'abc', events: base })
    expect(getSeatToken(storage, 'room1')).toBe('abc')
    expect(last().status).toBe('open')
    expect(last().seat).toBe('creator')
    expect(last().events).toHaveLength(3)
  })

  it('send en punto ocupado devuelve occupied y no envía', async () => {
    const { sockets, conn } = setup()
    await flush()
    const sock = sockets[0]!
    const mv: RoomEvent = { seq: 3, at: 2, type: 'move', color: 'black', x: 4, y: 4 }
    sock.emit({ t: 'welcome', seat: 'guest', events: [...base, mv] })
    expect(conn.send({ type: 'move', x: 4, y: 4, seq: 4 })).toBe('occupied')
    expect(sock.sent).toHaveLength(0)
  })

  it('rejected se expone con su contador y la conexión sigue', async () => {
    const { sockets, conn, last } = setup()
    await flush()
    const sock = sockets[0]!
    sock.emit({ t: 'welcome', seat: 'creator', events: base })
    expect(conn.send({ type: 'move', x: 0, y: 0, seq: 3 })).toBeNull()
    sock.emit({ t: 'rejected', reason: 'illegal' })
    expect(last().lastRejected).toBe('illegal')
    expect(last().rejectCount).toBe(1)
    sock.emit({ t: 'rejected', reason: 'illegal' })
    expect(last().rejectCount).toBe(2)
    expect(last().status).toBe('open')
    expect(sock.closed).toBe(false)
  })

  it('M-1: con una intención en vuelo el segundo send no se reenvía; tras el evento vuelve a salir', async () => {
    const { sockets, conn } = setup()
    await flush()
    const sock = sockets[0]!
    sock.emit({ t: 'welcome', seat: 'creator', events: base })
    expect(conn.send({ type: 'move', x: 0, y: 0, seq: 3 })).toBeNull()
    expect(conn.send({ type: 'move', x: 0, y: 0, seq: 3 })).toBeNull()
    expect(sock.sent).toHaveLength(1)
    sock.emit({ t: 'events', events: [{ seq: 3, at: 2, type: 'move', color: 'black', x: 0, y: 0 }], serverNow: 2 })
    sock.emit({ t: 'events', events: [{ seq: 4, at: 3, type: 'move', color: 'white', x: 1, y: 1 }], serverNow: 3 })
    expect(conn.send({ type: 'move', x: 2, y: 2, seq: 5 })).toBeNull()
    expect(sock.sent).toHaveLength(2)
  })

  it('M-1: un stale con el log ya más allá del seq enviado se descarta; uno sin avance se muestra', async () => {
    const { sockets, conn, last } = setup()
    await flush()
    const sock = sockets[0]!
    sock.emit({ t: 'welcome', seat: 'creator', events: base })
    conn.send({ type: 'move', x: 0, y: 0, seq: 3 })
    sock.emit({ t: 'events', events: [{ seq: 3, at: 2, type: 'move', color: 'black', x: 0, y: 0 }], serverNow: 2 })
    sock.emit({ t: 'rejected', reason: 'stale' })
    expect(last().lastRejected).toBeUndefined()
    expect(last().rejectCount).toBe(0)
    // stale genuino: el log sigue en seq 3 y se envió seq 4
    sock.emit({ t: 'events', events: [{ seq: 4, at: 3, type: 'move', color: 'white', x: 1, y: 1 }], serverNow: 3 })
    conn.send({ type: 'move', x: 2, y: 2, seq: 5 })
    sock.emit({ t: 'rejected', reason: 'stale' })
    // el log (seq 4) no llegó a 5: el aviso sí se muestra
    expect(last().lastRejected).toBe('stale')
  })

  it('I-1: cierre 1013 → status full, sin reintentos ni nuevo socket', async () => {
    const { sockets, sleeps, states, last } = setup()
    await flush()
    sockets[0]!.drop(1013)
    await flush()
    expect(last().status).toBe('full')
    expect(sockets).toHaveLength(1)
    expect(sleeps).toHaveLength(0)
    expect(states.some((s) => s.status === 'reconnecting')).toBe(false)
  })

  it('I-2: ping cada 15 s; un pong (no JSON) mantiene el socket y agenda el siguiente ping', async () => {
    const { sockets, timers } = setup()
    await flush()
    const sock = sockets[0]!
    sock.emit({ t: 'welcome', seat: 'creator', events: base })
    timers.advance(14_999)
    expect(sock.sent).toEqual([])
    timers.advance(1)
    expect(sock.sent).toEqual(['ping'])
    timers.advance(2_000)
    sock.raw('pong')
    timers.advance(10_000)
    expect(sock.closed).toBe(false)
    timers.advance(15_000)
    expect(sock.sent).toEqual(['ping', 'ping'])
  })

  it('I-2: sin pong en 5 s el socket se cierra y se reconecta', async () => {
    const { sockets, timers, states, sleeps } = setup()
    await flush()
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', events: base })
    timers.advance(15_000)
    timers.advance(4_999)
    expect(sockets[0]!.closed).toBe(false)
    timers.advance(1)
    expect(sockets[0]!.closed).toBe(true)
    await flush()
    expect(states.some((s) => s.status === 'reconnecting')).toBe(true)
    expect(sleeps[0]).toBe(500)
    expect(sockets).toHaveLength(2)
  })

  it('I-2: visibilitychange/online fuerzan un ping inmediato', async () => {
    const { sockets, timers, wake } = setup()
    await flush()
    const sock = sockets[0]!
    sock.emit({ t: 'welcome', seat: 'creator', events: base })
    wake()
    expect(sock.sent).toEqual(['ping'])
    timers.advance(5_000)
    expect(sock.closed).toBe(true)
  })

  it('I-2: sin evento ni rechazo 5 s después de enviar una intención se fuerza la reconexión', async () => {
    const { sockets, conn, timers } = setup()
    await flush()
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', events: base })
    conn.send({ type: 'move', x: 0, y: 0, seq: 3 })
    timers.advance(4_999)
    expect(sockets[0]!.closed).toBe(false)
    timers.advance(1)
    expect(sockets[0]!.closed).toBe(true)
    await flush()
    expect(sockets).toHaveLength(2)
  })

  it('I-2: si llega el evento antes de 5 s no hay reconexión por ack', async () => {
    const { sockets, conn, timers } = setup()
    await flush()
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', events: base })
    conn.send({ type: 'move', x: 0, y: 0, seq: 3 })
    sockets[0]!.emit({ t: 'events', events: [{ seq: 3, at: 2, type: 'move', color: 'black', x: 0, y: 0 }], serverNow: 2 })
    timers.advance(5_000)
    expect(sockets[0]!.closed).toBe(false)
  })

  it('I-3: serverOffsetMs = serverNow − Date.now() con welcome y con events', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    try {
      const { sockets, last } = setup()
      await flush()
      expect(last().serverOffsetMs).toBe(0)
      sockets[0]!.emit({ t: 'welcome', seat: 'creator', events: base, serverNow: 1_007_000 })
      expect(last().serverOffsetMs).toBe(7_000)
      sockets[0]!.emit({ t: 'events', events: [], serverNow: 999_500 })
      expect(last().serverOffsetMs).toBe(-500)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('reconexión: reconnecting, lastSeq, y eventos nuevos sin duplicar', async () => {
    const { sockets, states, sleeps, last } = setup()
    await flush()
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', seatToken: 't', events: base })
    sockets[0]!.drop()
    await flush()
    expect(states.some((s) => s.status === 'reconnecting')).toBe(true)
    expect(sleeps[0]).toBe(500)
    expect(sockets).toHaveLength(2)
    const url = new URL(sockets[1]!.url, 'http://x')
    expect(url.searchParams.get('lastSeq')).toBe('2')
    expect(url.searchParams.get('token')).toBe('t')
    const clock = { mainTimeLeft: 123 } as never
    const mv: RoomEvent = { seq: 3, at: 5, type: 'move', color: 'black', x: 2, y: 2, clock }
    sockets[1]!.emit({ t: 'welcome', seat: 'creator', events: [started, mv] })
    expect(last().status).toBe('open')
    expect(last().events.map((e) => e.seq)).toEqual([0, 1, 2, 3])
  })

  it('el reloj proyectado usa el del welcome de reconexión', async () => {
    const cfg: RoomConfig = { ...config, clock: { mainTimeMs: 600000, byoyomiMs: 0, periods: 0 } as never }
    const c0: RoomEvent = { ...created, config: cfg } as RoomEvent
    const { sockets, last } = setup()
    await flush()
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', events: [c0, joined, started] })
    sockets[0]!.drop()
    await flush()
    const newClock = { mainTimeMs: 1234 } as never
    sockets[1]!.emit({ t: 'welcome', seat: 'creator', events: [{ seq: 3, at: 9, type: 'move', color: 'black', x: 0, y: 0, clock: newClock }] })
    const { project } = await import('@tengen/go-rules')
    expect(project(last().events).clocks?.black).toEqual(newClock)
  })

  it('backoff crece hasta 10 s', async () => {
    const { sockets, sleeps } = setup()
    await flush()
    for (let i = 0; i < 7; i++) { sockets[i]!.drop(); await flush() }
    expect(sleeps).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000])
  })

  it('404 previo → not-found sin reintentos ni socket', async () => {
    const { sockets, states, sleeps, last } = setup(ok(404))
    await flush()
    expect(last().status).toBe('not-found')
    expect(sockets).toHaveLength(0)
    expect(sleeps).toHaveLength(0)
    expect(states.length).toBeGreaterThan(0)
  })

  it('close() explícito no reconecta', async () => {
    const { sockets, conn, sleeps } = setup()
    await flush()
    conn.close()
    await flush()
    expect(sockets).toHaveLength(1)
    expect(sleeps).toHaveLength(0)
  })
})
