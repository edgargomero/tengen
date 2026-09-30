// Rutas HTTP de las salas online. El estado vive en el Durable Object `GameRoom`; acá solo se
// valida la entrada, se aplica rate limit y se delega al DO por RPC / fetch.
import { Hono } from 'hono'
import type { Intent, RejectReason, RoomConfig, RoomEvent, SeatRole } from '@tengen/go-rules'
import type { Env } from '../index'

// ── Protocolo de red (JSON por WebSocket) ──────────────────────────────────────────────────────
export type ServerMessage =
  | { t: 'welcome'; seat: SeatRole | 'spectator'; seatToken?: string; events: RoomEvent[] }
  | { t: 'events'; events: RoomEvent[] }
  | { t: 'rejected'; reason: RejectReason }
  | { t: 'presence'; creator: boolean; guest: boolean }
export type ClientMessage = { t: 'intent'; intent: Intent }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** Devuelve la config saneada (solo los campos conocidos) o null si es inválida. */
export function parseConfig(raw: unknown): RoomConfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const size = r.boardSize
  if (size !== 9 && size !== 13 && size !== 19) return null
  if (typeof r.komi !== 'number' || !Number.isFinite(r.komi)) return null
  const handicap = r.handicap
  if (
    handicap !== 0 &&
    !(size === 19 && typeof handicap === 'number' && Number.isInteger(handicap) && handicap >= 2 && handicap <= 9)
  ) {
    return null
  }
  const cc = r.creatorColor
  if (cc !== 'black' && cc !== 'white' && cc !== 'nigiri') return null
  const config: RoomConfig = { boardSize: size, komi: r.komi, handicap: handicap as number, creatorColor: cc }
  if (r.clock !== undefined) {
    const c = r.clock as Record<string, unknown> | null
    if (typeof c !== 'object' || c === null) return null
    if (!isInt(c.mainTimeMs) || !isInt(c.byoyomiPeriods) || !isInt(c.byoyomiPeriodMs)) return null
    // Reloj sin tiempo posible: el primer turno vencería al instante.
    if (c.mainTimeMs === 0 && (c.byoyomiPeriods === 0 || c.byoyomiPeriodMs === 0)) return null
    config.clock = { mainTimeMs: c.mainTimeMs, byoyomiPeriods: c.byoyomiPeriods, byoyomiPeriodMs: c.byoyomiPeriodMs }
  }
  return config
}

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const roomsApp = new Hono<{ Bindings: Env }>()

roomsApp.post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'JSON inválido' }, 400)
  }
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const config = parseConfig(b.config)
  if (!config) return c.json({ error: 'Configuración de sala inválida' }, 400)
  const playerId = b.playerId
  if (typeof playerId !== 'string' || playerId.length < 8 || playerId.length > 64) {
    return c.json({ error: 'playerId inválido' }, 400)
  }
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const { success } = await c.env.LIMITER.limit({ key: `room:${ip}` })
  if (!success) return c.json({ error: 'Demasiadas salas seguidas; espera un momento.' }, 429)

  const roomId = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const stub = c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(roomId))
  const seatToken = await stub.create(config, playerId)
  return c.json({ roomId, seatToken }, 201)
})

roomsApp.get('/:id', async (c) => {
  const stub = c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(c.req.param('id')))
  if (!(await stub.exists())) return c.json({ exists: false }, 404)
  return c.json({ exists: true })
})

roomsApp.get('/:id/ws', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.text('Se esperaba un upgrade a WebSocket', 426)
  }
  const stub = c.env.GAME_ROOM.get(c.env.GAME_ROOM.idFromName(c.req.param('id')))
  if (!(await stub.exists())) return c.json({ exists: false }, 404)
  return stub.fetch(c.req.raw)
})
