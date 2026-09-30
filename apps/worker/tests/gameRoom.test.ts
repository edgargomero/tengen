// Partidas online Task 3: Durable Object GameRoom + rutas /api/rooms.
// Producción usa Date.now(): las pruebas de alarm RETROCEDEN los `at` guardados (vía
// runInDurableObject) antes de ejecutar la alarm, en vez de inyectar un reloj.
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it } from 'vitest'
import { flagDeadline, project, type RoomConfig, type RoomEvent } from '@tengen/go-rules'
import type { Env } from '../src/index'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

const DAY = 24 * 60 * 60 * 1000
const CONFIG: RoomConfig = { boardSize: 9, komi: 6.5, handicap: 0, creatorColor: 'black' }
const P1 = 'player-creator-01'
const P2 = 'player-guest-0002'
const P3 = 'player-watcher-03'

type Msg = { t: string; [k: string]: unknown }

class Client {
  msgs: Msg[] = []
  closeCode: number | undefined
  private waiters: Array<() => void> = []
  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      this.msgs.push(e.data === 'pong' ? { t: 'pong' } : (JSON.parse(e.data as string) as Msg))
      this.waiters.splice(0).forEach((w) => w())
    })
    ws.addEventListener('close', (e) => {
      this.closeCode = e.code
      this.waiters.splice(0).forEach((w) => w())
    })
  }
  /** Espera (y consume) el primer mensaje no consumido que cumpla el predicado. */
  async next(pred: (m: Msg) => boolean = () => true): Promise<Msg> {
    const deadline = Date.now() + 4000
    for (;;) {
      const i = this.msgs.findIndex(pred)
      if (i >= 0) return this.msgs.splice(i, 1)[0]!
      if (Date.now() > deadline) throw new Error('timeout esperando mensaje; cola=' + JSON.stringify(this.msgs))
      await new Promise<void>((r) => {
        this.waiters.push(r)
        setTimeout(r, 100)
      })
    }
  }
  send(o: unknown): void {
    this.ws.send(typeof o === 'string' ? o : JSON.stringify(o))
  }
  async waitClose(): Promise<number | undefined> {
    const deadline = Date.now() + 4000
    while (this.closeCode === undefined && Date.now() < deadline) {
      await new Promise<void>((r) => {
        this.waiters.push(r)
        setTimeout(r, 100)
      })
    }
    return this.closeCode
  }
}

const open: Client[] = []
afterEach(() => {
  // El storage aislado del pool puede fallar con WebSockets abiertos al terminar el test.
  for (const c of open.splice(0)) {
    try {
      c.ws.close(1000)
    } catch {
      // ya cerrado
    }
  }
})

async function createRoom(config: RoomConfig = CONFIG, playerId = P1) {
  const res = await SELF.fetch('https://example.com/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, playerId }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { roomId: string; seatToken: string }
}

async function connect(roomId: string, q: Record<string, string>): Promise<Client> {
  const res = await SELF.fetch(`https://example.com/api/rooms/${roomId}/ws?${new URLSearchParams(q)}`, {
    headers: { Upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket!
  ws.accept()
  const c = new Client(ws)
  open.push(c)
  return c
}

const stubOf = (roomId: string) => env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId))

/** Sala con creador y guest conectados y la partida iniciada. */
async function startedRoom(config: RoomConfig = CONFIG) {
  const { roomId, seatToken } = await createRoom(config)
  const creator = await connect(roomId, { playerId: P1, token: seatToken })
  await creator.next((m) => m.t === 'welcome')
  const guest = await connect(roomId, { playerId: P2 })
  const gw = await guest.next((m) => m.t === 'welcome')
  await creator.next((m) => m.t === 'events')
  return { roomId, seatToken, guestToken: gw.seatToken as string, creator, guest }
}

async function rewind(roomId: string, ms: number): Promise<void> {
  await runInDurableObject(stubOf(roomId), async (_i, state) => {
    const events = (await state.storage.get<RoomEvent[]>('events'))!
    await state.storage.put(
      'events',
      events.map((e) => ({ ...e, at: e.at - ms })),
    )
  })
}

describe('rutas /api/rooms', () => {
  it('1. POST crea la sala; GET la encuentra y un id inexistente da 404', async () => {
    const { roomId, seatToken } = await createRoom()
    expect(roomId).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    expect(seatToken.length).toBeGreaterThan(0)
    expect((await SELF.fetch(`https://example.com/api/rooms/${roomId}`)).status).toBe(200)
    expect((await SELF.fetch('https://example.com/api/rooms/inexistente1234567890ab')).status).toBe(404)
    const ws = await SELF.fetch('https://example.com/api/rooms/inexistente1234567890ab/ws', {
      headers: { Upgrade: 'websocket' },
    })
    expect(ws.status).toBe(404)
  })

  it('valida la config (400)', async () => {
    const post = (body: unknown) =>
      SELF.fetch('https://example.com/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await post({ config: { ...CONFIG, boardSize: 7 }, playerId: P1 })).status).toBe(400)
    expect((await post({ config: { ...CONFIG, handicap: 3 }, playerId: P1 })).status).toBe(400) // 9x9
    expect((await post({ config: { ...CONFIG, komi: null }, playerId: P1 })).status).toBe(400)
    expect((await post({ config: { ...CONFIG, creatorColor: 'red' }, playerId: P1 })).status).toBe(400)
    expect((await post({ config: { ...CONFIG, clock: { mainTimeMs: 0, byoyomiPeriods: 0, byoyomiPeriodMs: 0 } }, playerId: P1 })).status).toBe(400)
    expect((await post({ config: { ...CONFIG, clock: { mainTimeMs: 0, byoyomiPeriods: 3, byoyomiPeriodMs: 0 } }, playerId: P1 })).status).toBe(400)
    expect((await post({ config: { ...CONFIG, clock: { mainTimeMs: -1, byoyomiPeriods: 1, byoyomiPeriodMs: 1000 } }, playerId: P1 })).status).toBe(400)
    expect((await post({ config: CONFIG, playerId: 'corto' })).status).toBe(400)
    // M-3: topes de la config
    const clock = { mainTimeMs: 60000, byoyomiPeriods: 3, byoyomiPeriodMs: 30000 }
    const withClock = (over: object) => ({ config: { ...CONFIG, clock: { ...clock, ...over } }, playerId: P1 })
    expect((await post(withClock({ mainTimeMs: 24 * 60 * 60 * 1000 + 1 }))).status).toBe(400)
    expect((await post(withClock({ byoyomiPeriods: 31 }))).status).toBe(400)
    expect((await post(withClock({ byoyomiPeriodMs: 10 * 60 * 1000 + 1 }))).status).toBe(400)
    expect((await post({ config: { ...CONFIG, komi: 50.5 }, playerId: P1 })).status).toBe(400)
    expect((await post({ config: { ...CONFIG, komi: -50.5 }, playerId: P1 })).status).toBe(400)
    expect((await post(withClock({ mainTimeMs: 24 * 60 * 60 * 1000, byoyomiPeriods: 30, byoyomiPeriodMs: 10 * 60 * 1000 }))).status).toBe(201)
    expect((await post({ config: { ...CONFIG, komi: -50 }, playerId: P1 })).status).toBe(201)
    expect((await post({ config: { ...CONFIG, boardSize: 19, handicap: 4 }, playerId: P1 })).status).toBe(201)
    expect((await post({ config: { ...CONFIG, clock: { mainTimeMs: 0, byoyomiPeriods: 3, byoyomiPeriodMs: 30000 } }, playerId: P1 })).status).toBe(201)
  })
})

describe('GameRoom por WebSocket', () => {
  it('2. el creador con su token recibe welcome creator + created', async () => {
    const { roomId, seatToken } = await createRoom()
    const c = await connect(roomId, { playerId: P1, token: seatToken })
    const w = await c.next((m) => m.t === 'welcome')
    expect(w.seat).toBe('creator')
    expect((w.events as RoomEvent[]).map((e) => e.type)).toEqual(['created'])
    expect(await c.next((m) => m.t === 'presence')).toMatchObject({ creator: true, guest: false })
  })

  it('3. un segundo playerId ocupa el asiento guest; ambos ven joined+started', async () => {
    const { roomId, seatToken } = await createRoom()
    const creator = await connect(roomId, { playerId: P1, token: seatToken })
    await creator.next((m) => m.t === 'welcome')
    const guest = await connect(roomId, { playerId: P2 })
    const gw = await guest.next((m) => m.t === 'welcome')
    expect(gw.seat).toBe('guest')
    expect(typeof gw.seatToken).toBe('string')
    expect((gw.events as RoomEvent[]).map((e) => e.type)).toEqual(['created', 'joined', 'started'])
    const ev = await creator.next((m) => m.t === 'events')
    expect((ev.events as RoomEvent[]).map((e) => e.type)).toEqual(['joined', 'started'])
    expect(await creator.next((m) => m.t === 'presence' && m.guest === true)).toBeTruthy()
  })

  it('4. un tercero es espectador y no puede jugar', async () => {
    const { roomId } = await startedRoom()
    const spec = await connect(roomId, { playerId: P3 })
    const w = await spec.next((m) => m.t === 'welcome')
    expect(w.seat).toBe('spectator')
    expect(w.seatToken).toBeUndefined()
    spec.send({ t: 'intent', intent: { type: 'pass', seq: 3 } })
    expect(await spec.next((m) => m.t === 'rejected')).toMatchObject({ reason: 'not-a-player' })
  })

  it('5. una jugada valida llega igual a ambos jugadores y al espectador', async () => {
    const { roomId, creator, guest } = await startedRoom()
    const spec = await connect(roomId, { playerId: P3 })
    await spec.next((m) => m.t === 'welcome')
    creator.send({ t: 'intent', intent: { type: 'move', x: 4, y: 4, seq: 3 } })
    const [a, b, c] = await Promise.all(
      [creator, guest, spec].map((cl) => cl.next((m) => m.t === 'events')),
    )
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect((a!.events as RoomEvent[])[0]).toMatchObject({ type: 'move', color: 'black', x: 4, y: 4, seq: 3 })
    // fuera de turno
    creator.send({ t: 'intent', intent: { type: 'move', x: 0, y: 0, seq: 4 } })
    expect(await creator.next((m) => m.t === 'rejected')).toMatchObject({ reason: 'not-your-turn' })
  })

  it('6. reconexion con token y lastSeq recibe solo los eventos posteriores', async () => {
    const { roomId, seatToken, creator } = await startedRoom()
    creator.send({ t: 'intent', intent: { type: 'move', x: 4, y: 4, seq: 3 } })
    await creator.next((m) => m.t === 'events')
    creator.ws.close(1000)
    const again = await connect(roomId, { playerId: P1, token: seatToken, lastSeq: '2' })
    const w = await again.next((m) => m.t === 'welcome')
    expect(w.seat).toBe('creator')
    expect((w.events as RoomEvent[]).map((e) => e.seq)).toEqual([3])
  })

  it('7. sala sin guest: alarm a +24 h; al ejecutarla la sala se borra', async () => {
    const { roomId } = await createRoom()
    const before = Date.now()
    const alarm = await runInDurableObject(stubOf(roomId), (_i, state) => state.storage.getAlarm())
    expect(alarm).not.toBeNull()
    expect(Math.abs(alarm! - (before + DAY))).toBeLessThan(10_000)
    await rewind(roomId, DAY + 60_000)
    expect(await runDurableObjectAlarm(stubOf(roomId))).toBe(true)
    expect((await SELF.fetch(`https://example.com/api/rooms/${roomId}`)).status).toBe(404)
    const ws = await SELF.fetch(`https://example.com/api/rooms/${roomId}/ws`, { headers: { Upgrade: 'websocket' } })
    expect(ws.status).toBe(404)
  })

  it('8. con reloj: alarm en flagDeadline; vencida difunde timeout+ended; luego +30 dias y borrado', async () => {
    const clock = { mainTimeMs: 1000, byoyomiPeriods: 1, byoyomiPeriodMs: 1000 }
    const { roomId, creator, guest } = await startedRoom({ ...CONFIG, clock })
    const stub = stubOf(roomId)
    const { alarm, deadline } = await runInDurableObject(stub, async (_i, state) => {
      const events = (await state.storage.get<RoomEvent[]>('events'))!
      return { alarm: await state.storage.getAlarm(), deadline: flagDeadline(project(events)) }
    })
    expect(deadline).toBeDefined()
    expect(alarm).toBe(deadline)

    await rewind(roomId, 60_000) // el tiempo de negras ya venció
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    for (const c of [creator, guest]) {
      const ev = await c.next((m) => m.t === 'events')
      expect((ev.events as RoomEvent[]).map((e) => e.type)).toEqual(['timeout', 'ended'])
      expect((ev.events as RoomEvent[])[1]).toMatchObject({ result: 'W+T' })
    }
    const after = Date.now()
    const alarm2 = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())
    expect(Math.abs(alarm2! - (after + 30 * DAY))).toBeLessThan(10_000)

    await rewind(roomId, 31 * DAY)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect((await SELF.fetch(`https://example.com/api/rooms/${roomId}`)).status).toBe(404)
  })

  it('9. mensajes > 1 KB o JSON invalido se ignoran; la conexion 51 se cierra con 1013', async () => {
    const { roomId, seatToken } = await createRoom()
    const c = await connect(roomId, { playerId: P1, token: seatToken })
    await c.next((m) => m.t === 'welcome')
    c.send('x'.repeat(2000))
    c.send('{no es json')
    c.send({ t: 'intent', intent: { type: 'pass', seq: 1 } }) // vivo: la sala aún no empezó
    expect(await c.next((m) => m.t === 'rejected')).toMatchObject({ reason: 'not-started' })
    expect(c.closeCode).toBeUndefined()

    for (let i = 0; i < 49; i++) await connect(roomId, { playerId: `watcher-${String(i).padStart(4, '0')}x` })
    const extra = await connect(roomId, { playerId: 'watcher-extra-0001' })
    expect(await extra.waitClose()).toBe(1013)
  })

  it('I-1: con la sala al tope de espectadores, el jugador que reconecta con token entra igual', async () => {
    const { roomId, seatToken, guestToken, creator } = await startedRoom()
    const all: Client[] = []
    for (let i = 0; i < 48; i++) all.push(await connect(roomId, { playerId: `watcher-${String(i).padStart(4, '0')}x` }))
    for (const w of all) await w.next((m) => m.t === 'welcome')
    const extra = await connect(roomId, { playerId: 'watcher-extra-0001' })
    expect(await extra.waitClose()).toBe(1013)
    // reconexión del creador (su socket viejo sigue abierto, como en un socket medio abierto)
    const again = await connect(roomId, { playerId: P1, token: seatToken, lastSeq: '2' })
    expect(await again.next((m) => m.t === 'welcome')).toMatchObject({ seat: 'creator' })
    expect(again.closeCode).toBeUndefined()
    const g = await connect(roomId, { playerId: P2, token: guestToken })
    expect(await g.next((m) => m.t === 'welcome')).toMatchObject({ seat: 'guest' })
    expect(creator.closeCode).toBeUndefined()
  })

  it('I-2: el DO responde pong al ping crudo', async () => {
    const { roomId, seatToken } = await createRoom()
    const c = await connect(roomId, { playerId: P1, token: seatToken })
    await c.next((m) => m.t === 'welcome')
    c.send('ping')
    expect(await c.next((m) => m.t === 'pong')).toEqual({ t: 'pong' })
  })

  it('I-3: welcome y events traen serverNow (Date.now() del DO)', async () => {
    const before = Date.now()
    const { roomId, seatToken } = await createRoom()
    const creator = await connect(roomId, { playerId: P1, token: seatToken })
    const w = await creator.next((m) => m.t === 'welcome')
    expect(typeof w.serverNow).toBe('number')
    expect(Math.abs((w.serverNow as number) - before)).toBeLessThan(10_000)
    const guest = await connect(roomId, { playerId: P2 })
    const gw = await guest.next((m) => m.t === 'welcome')
    expect(typeof gw.serverNow).toBe('number')
    const ev = await creator.next((m) => m.t === 'events')
    expect(typeof ev.serverNow).toBe('number')
    creator.send({ t: 'intent', intent: { type: 'move', x: 4, y: 4, seq: 3 } })
    expect(typeof (await guest.next((m) => m.t === 'events' && (m.events as RoomEvent[])[0]?.type === 'move')).serverNow).toBe('number')
  })

  it('una intención de type desconocido se rechaza y no entra al log', async () => {
    const { roomId, creator } = await startedRoom()
    creator.send({ t: 'intent', intent: { type: 'explode', seq: 3 } })
    expect(await creator.next((m) => m.t === 'rejected')).toMatchObject({ reason: 'illegal' })
    const n = await runInDurableObject(stubOf(roomId), async (_i, state) => (await state.storage.get<RoomEvent[]>('events'))!.length)
    expect(n).toBe(3)
  })

  it('M-4: el playerId del attachment se acota a 64 caracteres (o vacío si es demasiado corto)', async () => {
    const { roomId } = await startedRoom()
    const long = await connect(roomId, { playerId: 'x'.repeat(500) })
    await long.next((m) => m.t === 'welcome')
    const short = await connect(roomId, { playerId: 'ab' })
    await short.next((m) => m.t === 'welcome')
    const ids = await runInDurableObject(stubOf(roomId), (_i, state) =>
      state.getWebSockets().map((ws) => (ws.deserializeAttachment() as { playerId: string }).playerId),
    )
    expect(ids.every((id) => id.length <= 64)).toBe(true)
    expect(ids).toContain('x'.repeat(64))
    expect(ids).toContain('')
  })

  it('presence: al cerrarse un socket ya no cuenta como conectado', async () => {
    const { creator, guest } = await startedRoom()
    await guest.next((m) => m.t === 'presence')
    guest.ws.close(1000)
    const p = await creator.next((m) => m.t === 'presence' && m.guest === false)
    expect(p).toMatchObject({ creator: true, guest: false })
  })
})
