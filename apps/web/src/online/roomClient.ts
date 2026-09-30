// Cliente WebSocket de una sala online con reconexión. La verdad vive en el servidor (Durable
// Object); acá se mantiene el log de eventos recibido y se valida localmente cada intención
// (barrera 1 contra jugadas ilegales, sin ida y vuelta).
import { project, validateIntentLocally } from '@tengen/go-rules'
import type { Intent, RejectReason, RoomEvent, SeatRole } from '@tengen/go-rules'
import type { StorageLike } from '../game/persistence'
import { getPlayerId, getSeatToken, setSeatToken, type FetchLike } from './identity'

/** Mensajes servidor → cliente. */
export type ServerMessage =
  | { t: 'welcome'; seat: SeatRole | 'spectator'; seatToken?: string; events: RoomEvent[] }
  | { t: 'events'; events: RoomEvent[] }
  | { t: 'rejected'; reason: RejectReason }
  | { t: 'presence'; creator: boolean; guest: boolean }
/** Mensajes cliente → servidor. */
export type ClientMessage = { t: 'intent'; intent: Intent }

export interface RoomConnectionState {
  status: 'connecting' | 'open' | 'reconnecting' | 'not-found'
  seat?: SeatRole | 'spectator'
  events: RoomEvent[]
  lastRejected?: RejectReason
  presence?: { creator: boolean; guest: boolean }
}

export interface ConnectRoomOpts {
  storage: StorageLike
  onState(s: RoomConnectionState): void
  socketFactory?: (url: string) => WebSocket
  sleep?: (ms: number) => Promise<void>
  /** Inyectable para tests: el GET /api/rooms/:id previo a cada (re)conexión. */
  fetchFn?: FetchLike
}

const BACKOFF_START_MS = 500
const BACKOFF_MAX_MS = 10_000

function defaultUrl(roomId: string, qs: string): string {
  const loc = typeof location !== 'undefined' ? location : undefined
  const proto = loc?.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = loc?.host ?? 'localhost'
  return `${proto}//${host}/api/rooms/${encodeURIComponent(roomId)}/ws?${qs}`
}

export function connectRoom(
  roomId: string,
  opts: ConnectRoomOpts,
): { send(intent: Intent): RejectReason | null; close(): void } {
  const fetchFn: FetchLike = opts.fetchFn ?? ((i, init) => fetch(i, init))
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const makeSocket = opts.socketFactory ?? ((url) => new WebSocket(url))

  const events: RoomEvent[] = []
  let seat: SeatRole | 'spectator' | undefined
  let status: RoomConnectionState['status'] = 'connecting'
  let lastRejected: RejectReason | undefined
  let presence: RoomConnectionState['presence']
  let socket: WebSocket | null = null
  let closed = false
  let delay = BACKOFF_START_MS

  const emit = () => opts.onState({ status, seat, events: [...events], lastRejected, presence })

  const merge = (incoming: RoomEvent[]) => {
    let last = events.length ? events[events.length - 1]!.seq : -1
    for (const ev of incoming) {
      if (ev.seq > last) {
        events.push(ev)
        last = ev.seq
      }
    }
  }

  function handle(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome':
        if (msg.seatToken) setSeatToken(opts.storage, roomId, msg.seatToken)
        seat = msg.seat
        merge(msg.events)
        status = 'open'
        delay = BACKOFF_START_MS
        break
      case 'events':
        merge(msg.events)
        break
      case 'rejected':
        lastRejected = msg.reason
        break
      case 'presence':
        presence = { creator: msg.creator, guest: msg.guest }
        break
    }
    emit()
  }

  /** Abre un socket y resuelve cuando se cierra. */
  function openSocket(): Promise<void> {
    return new Promise((resolve) => {
      const params = new URLSearchParams({ playerId: getPlayerId(opts.storage) })
      const token = getSeatToken(opts.storage, roomId)
      if (token) params.set('token', token)
      if (events.length) params.set('lastSeq', String(events[events.length - 1]!.seq))
      const ws = makeSocket(defaultUrl(roomId, params.toString()))
      socket = ws
      ws.onmessage = (e: MessageEvent) => {
        try {
          handle(JSON.parse(String(e.data)) as ServerMessage)
        } catch {
          /* mensaje malformado: se ignora */
        }
      }
      ws.onclose = () => {
        if (socket === ws) socket = null
        resolve()
      }
      ws.onerror = () => {
        /* el cierre posterior dispara la reconexión */
      }
    })
  }

  async function run() {
    emit()
    while (!closed) {
      // Un upgrade de WebSocket fallido no expone su status HTTP al navegador: se consulta antes.
      let notFound = false
      try {
        const res = await fetchFn(`/api/rooms/${encodeURIComponent(roomId)}`)
        notFound = res.status === 404
      } catch {
        /* sin red: se trata como caída transitoria y se reintenta */
      }
      if (closed) return
      if (notFound) {
        status = 'not-found'
        emit()
        return
      }
      await openSocket()
      if (closed) return
      status = 'reconnecting'
      emit()
      await sleep(delay)
      delay = Math.min(delay * 2, BACKOFF_MAX_MS)
    }
  }
  void run()

  return {
    send(intent) {
      if (!seat || !events.length) return 'not-started'
      const rejected = validateIntentLocally(project(events), seat, intent)
      if (rejected) return rejected
      // Sin socket abierto no se puede enviar; 'illegal' es el motivo genérico disponible.
      if (!socket || status !== 'open') return 'illegal'
      const msg: ClientMessage = { t: 'intent', intent }
      socket.send(JSON.stringify(msg))
      return null
    },
    close() {
      closed = true
      const ws = socket
      socket = null
      ws?.close()
    },
  }
}
