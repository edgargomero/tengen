// Durable Object de una sala de partida online. Autoridad única: valida intenciones con la lógica
// pura de @tengen/go-rules, persiste el log de eventos (SQLite) y lo difunde por WebSocket
// Hibernation. El reloj usa Date.now() y una alarm para el flag por tiempo.
import { DurableObject } from 'cloudflare:workers'
import {
  createRoom,
  flagDeadline,
  joinSeat,
  onAlarm,
  project,
  reduce,
  scoringDeadline,
  type RoomConfig,
  type RoomEvent,
  type SeatRole,
  PING,
  PONG,
} from '@tengen/go-rules'
import type { ClientMessage, ServerMessage } from '@tengen/go-rules'
import type { Env } from '../index'

const WAITING_TTL_MS = 24 * 60 * 60 * 1000
const ENDED_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_SOCKETS = 50
// El tope aplica sólo a espectadores: los dos asientos siempre pueden (re)conectar.
const MAX_SPECTATORS = MAX_SOCKETS - 2
const MAX_MESSAGE_LEN = 1024
// Sala en juego sin reloj: si nadie mueve en 30 días se considera abandonada y se borra.
const IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface Tokens {
  creator?: string
  guest?: string
}
interface Attachment {
  seat: SeatRole | 'spectator'
  playerId: string
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Acota el playerId que va al attachment: 8..64 caracteres, o '' si no hay uno usable. */
function sanitizePlayerId(raw: string): string {
  if (raw.length > 64) return raw.slice(0, 64)
  return raw.length < 8 ? '' : raw
}

/**
 * Copia los eventos sin `playerId` (created/joined): el id de jugador es un secreto de asiento y
 * no debe difundirse a espectadores. El log guardado lo conserva (joinSeat lo usa).
 * Cast deliberado: los tipos de go-rules exigen `playerId` en esos eventos, pero el cliente
 * nunca lo lee, así que no se cambian los tipos compartidos.
 */
export function redactEvents(events: readonly RoomEvent[]): RoomEvent[] {
  return events.map((e) => {
    if (e.type !== 'created' && e.type !== 'joined') return e
    const { playerId: _omit, ...rest } = e as RoomEvent & { playerId?: string }
    return rest as unknown as RoomEvent
  })
}

export class GameRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Latido de vida: el runtime contesta sin despertar al DO hibernado.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  private async loadEvents(): Promise<RoomEvent[]> {
    return (await this.ctx.storage.get<RoomEvent[]>('events')) ?? []
  }

  /** RPC: crea la sala y devuelve el token del creador. */
  async create(config: RoomConfig, playerId: string): Promise<string> {
    const existing = await this.loadEvents()
    if (existing.length > 0) throw new Error('room already exists')
    const now = Date.now()
    const token = newToken()
    await this.ctx.storage.put({
      events: createRoom(config, playerId, now),
      tokens: { creator: token } satisfies Tokens,
    })
    await this.ctx.storage.setAlarm(now + WAITING_TTL_MS)
    return token
  }

  /** RPC: ¿la sala existe (tiene log de eventos)? */
  async exists(): Promise<boolean> {
    return (await this.loadEvents()).length > 0
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }
    const events = await this.loadEvents()
    if (events.length === 0) return new Response('Not found', { status: 404 })

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    const url = new URL(request.url)
    const rawPlayerId = url.searchParams.get('playerId') ?? ''
    const playerId = sanitizePlayerId(rawPlayerId)
    const token = url.searchParams.get('token')
    const wantsJoin = url.searchParams.get('join') === '1'
    const lastSeqRaw = url.searchParams.get('lastSeq')
    const lastSeq = lastSeqRaw !== null && lastSeqRaw !== '' ? Number(lastSeqRaw) : NaN

    const tokens = (await this.ctx.storage.get<Tokens>('tokens')) ?? {}
    let seat: SeatRole | 'spectator' = 'spectator'
    let seatToken: string | undefined
    let current = events
    let fresh: RoomEvent[] = []

    if (token && tokens.creator === token) seat = 'creator'
    else if (token && tokens.guest === token) seat = 'guest'
    else if (wantsJoin && playerId.length >= 8 && playerId.length <= 64) {
      const join = joinSeat(events, playerId, Date.now())
      if (join) {
        seat = join.seat
        seatToken = newToken()
        fresh = join.events
        current = [...events, ...fresh]
        await this.ctx.storage.put({ events: current, tokens: { ...tokens, guest: seatToken } satisfies Tokens })
        await this.reschedule(current)
      }
    }

    // El tope se aplica DESPUÉS de resolver el asiento: sólo los espectadores se rechazan.
    if (seat === 'spectator' && this.countSpectators() >= MAX_SPECTATORS) {
      this.ctx.acceptWebSocket(server)
      server.close(1013, 'Sala llena')
      return new Response(null, { status: 101, webSocket: client })
    }

    // A los sockets ya conectados se les difunde el join ANTES de aceptar al nuevo: el nuevo lo
    // recibe dentro del welcome.
    if (fresh.length > 0) this.broadcast({ t: 'events', events: redactEvents(fresh), serverNow: Date.now() })

    // Un socket por asiento: el nuevo dueño desplaza a los previos (nunca a espectadores).
    if (seat !== 'spectator') {
      for (const old of this.ctx.getWebSockets()) {
        if ((old.deserializeAttachment() as Attachment | null)?.seat !== seat) continue
        try {
          old.close(4001, 'Abierta en otro lado')
        } catch {
          // ya cerrado
        }
      }
    }

    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ seat, playerId } satisfies Attachment)
    const sendFrom = Number.isInteger(lastSeq) ? lastSeq : -1
    this.send(server, {
      t: 'welcome',
      seat,
      ...(seatToken ? { seatToken } : {}),
      events: redactEvents(current.filter((e) => e.seq > sendFrom)),
      serverNow: Date.now(),
    })
    this.broadcastPresence()
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_LEN) return
    let msg: ClientMessage
    try {
      msg = JSON.parse(message) as ClientMessage
    } catch {
      return
    }
    if (msg?.t !== 'intent' || typeof msg.intent !== 'object' || msg.intent === null) return
    const att = ws.deserializeAttachment() as Attachment | null
    if (!att) return

    const events = await this.loadEvents()
    if (events.length === 0) return
    const result = reduce(events, att.seat, msg.intent, Date.now())
    if ('rejected' in result) {
      this.send(ws, { t: 'rejected', reason: result.rejected })
      return
    }
    const next = [...events, ...result.events]
    await this.ctx.storage.put('events', next)
    this.broadcast({ t: 'events', events: redactEvents(result.events), serverNow: Date.now() })
    await this.reschedule(next)
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason)
    } catch {
      // ya cerrado
    }
    this.broadcastPresence(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws)
  }

  override async alarm(): Promise<void> {
    const events = await this.loadEvents()
    if (events.length === 0) return
    const now = Date.now()
    const state = project(events)
    const created = events[0]
    const last = events[events.length - 1]
    if (
      (state.phase === 'waiting' && created && now >= created.at + WAITING_TTL_MS) ||
      (state.phase === 'ended' && last && now >= last.at + ENDED_TTL_MS) ||
      (state.phase === 'playing' && !state.config.clock && last && now >= last.at + IDLE_TTL_MS)
    ) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1001, 'Sala cerrada')
        } catch {
          // ya cerrado
        }
      }
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.deleteAll()
      return
    }
    if (state.phase === 'playing' || state.phase === 'scoring') {
      const out = onAlarm(events, now)
      if (out.length > 0) {
        const next = [...events, ...out]
        await this.ctx.storage.put('events', next)
        this.broadcast({ t: 'events', events: redactEvents(out), serverNow: Date.now() })
        await this.reschedule(next)
        return
      }
    }
    await this.reschedule(events)
  }

  /** Reprograma la alarm según la fase: flag, plazo del conteo, expiración de sala en espera, o +30 días al terminar. */
  private async reschedule(events: readonly RoomEvent[]): Promise<void> {
    const state = project(events)
    const last = events[events.length - 1]
    let at: number | undefined
    if (state.phase === 'playing') {
      at = flagDeadline(state)
      // Sin reloj no hay flag: alarm de abandono en último evento + 30 días.
      if (at === undefined && last) at = last.at + IDLE_TTL_MS
    }
    else if (state.phase === 'scoring') at = scoringDeadline(state)
    else if (state.phase === 'ended' && last) at = last.at + ENDED_TTL_MS
    else if (state.phase === 'waiting' && events[0]) at = events[0].at + WAITING_TTL_MS
    if (at === undefined) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(at)
  }

  private countSpectators(): number {
    let n = 0
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null
      if (!att || att.seat === 'spectator') n++
    }
    return n
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // socket cerrándose
    }
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data)
      } catch {
        // socket cerrándose
      }
    }
  }

  private broadcastPresence(closing?: WebSocket): void {
    let creator = false
    let guest = false
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === closing) continue
      const att = ws.deserializeAttachment() as Attachment | null
      if (att?.seat === 'creator') creator = true
      else if (att?.seat === 'guest') guest = true
    }
    this.broadcast({ t: 'presence', creator, guest })
  }
}
