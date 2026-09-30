// Cliente WebSocket de una sala online con reconexión. La verdad vive en el servidor (Durable
// Object); acá se mantiene el log de eventos recibido y se valida localmente cada intención
// (barrera 1 contra jugadas ilegales, sin ida y vuelta).
import { PING, PONG, project, validateIntentLocally } from '@tengen/go-rules'
import type { ClientMessage, Intent, RejectReason, RoomEvent, SeatRole, ServerMessage } from '@tengen/go-rules'
import type { StorageLike } from '../game/persistence'
import { getPlayerId, getSeatToken, setSeatToken, type FetchLike } from './identity'

export interface RoomConnectionState {
  /**
   * `full`: el servidor cerró con 1013 (sala al tope de espectadores); terminal, sin reintentos.
   * `replaced`: cerró con 4001 (el mismo dueño abrió el asiento en otra pestaña o dispositivo);
   * terminal también: reconectar arrancaría una guerra de pestañas.
   */
  status: 'connecting' | 'open' | 'reconnecting' | 'not-found' | 'full' | 'replaced'
  seat?: SeatRole | 'spectator'
  events: RoomEvent[]
  lastRejected?: RejectReason
  /** Cuenta los rechazos recibidos: permite re-mostrar el mismo motivo dos veces seguidas. */
  rejectCount: number
  /** `serverNow − Date.now()` medido con el último mensaje del servidor (0 si aún no hay). */
  serverOffsetMs: number
  presence?: { creator: boolean; guest: boolean }
}

export interface ConnectRoomOpts {
  storage: StorageLike
  onState(s: RoomConnectionState): void
  socketFactory?: (url: string) => WebSocket
  sleep?: (ms: number) => Promise<void>
  /** Inyectable para tests: el GET /api/rooms/:id previo a cada (re)conexión. */
  fetchFn?: FetchLike
  /** Inyectable para tests: temporizadores del heartbeat y del ack de intenciones. */
  timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
  /**
   * Inyectable para tests: suscribe `check` a las señales que sugieren que la red cambió
   * (pestaña visible de nuevo, `online`) y devuelve la función que las desuscribe.
   */
  onWake?: (check: () => void) => () => void
}

/** Heartbeat: un ping cada 15 s; sin pong en 5 s el socket se da por medio abierto. */
const PING_INTERVAL_MS = 15_000
const PONG_TIMEOUT_MS = 5_000
/** Tras enviar una intención, si en 5 s no llega evento ni rechazo se fuerza la reconexión. */
const ACK_TIMEOUT_MS = 5_000

function defaultOnWake(check: () => void): () => void {
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') check()
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  if (typeof window !== 'undefined') window.addEventListener('online', check)
  return () => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined') window.removeEventListener('online', check)
  }
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
): { send(intent: Intent): RejectReason | null; joinAsPlayer(): void; close(): void } {
  const fetchFn: FetchLike = opts.fetchFn ?? ((i, init) => fetch(i, init))
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
  const makeSocket = opts.socketFactory ?? ((url) => new WebSocket(url))
  const timers = opts.timers ?? {
    set: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  }

  const events: RoomEvent[] = []
  let seat: SeatRole | 'spectator' | undefined
  let status: RoomConnectionState['status'] = 'connecting'
  let lastRejected: RejectReason | undefined
  let presence: RoomConnectionState['presence']
  let socket: WebSocket | null = null
  let closed = false
  let delay = BACKOFF_START_MS
  let rejectCount = 0
  let serverOffsetMs = 0
  // Intención enviada sin evento ni rechazo todavía (M-1) y seq de la última enviada.
  let inFlight = false
  let lastSentSeq = -1
  let ackTimer: unknown = null
  // Cierra el socket actual y deja que el bucle de `run` reconecte (heartbeat / ack fallidos).
  let forceReconnect: (() => void) | null = null
  // Comprueba la vida del socket ya (visibilitychange / online).
  let checkAlive: (() => void) | null = null
  // `joinAsPlayer`: `join=1` en el PRÓXIMO upgrade (un solo uso: se limpia al recibir `welcome`) y
  // reconexión inmediata, sin el `sleep` del backoff ni el estado visible `reconnecting`.
  let joinNext = false
  let reconnectNow = false

  const emit = () =>
    opts.onState({ status, seat, events: [...events], lastRejected, rejectCount, serverOffsetMs, presence })

  const clearAck = () => {
    inFlight = false
    if (ackTimer !== null) timers.clear(ackTimer)
    ackTimer = null
  }

  const merge = (incoming: RoomEvent[]): boolean => {
    let last = events.length ? events[events.length - 1]!.seq : -1
    let added = false
    for (const ev of incoming) {
      if (ev.seq > last) {
        events.push(ev)
        last = ev.seq
        added = true
      }
    }
    return added
  }

  const noteServerNow = (serverNow: unknown) => {
    if (typeof serverNow === 'number' && Number.isFinite(serverNow)) serverOffsetMs = serverNow - Date.now()
  }

  function handle(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome':
        if (msg.seatToken) setSeatToken(opts.storage, roomId, msg.seatToken)
        joinNext = false
        seat = msg.seat
        merge(msg.events)
        noteServerNow(msg.serverNow)
        clearAck() // el welcome es el sync: muestra si la jugada entró
        status = 'open'
        delay = BACKOFF_START_MS
        break
      case 'events':
        noteServerNow(msg.serverNow)
        if (merge(msg.events)) clearAck()
        break
      case 'rejected': {
        const lastSeq = events.length ? events[events.length - 1]!.seq : -1
        clearAck()
        // `stale` con el log ya más allá de lo enviado: la jugada quedó vieja porque entró otra
        // (típico del doble toque o de un cruce con el rival); avisar sería un falso positivo.
        if (msg.reason === 'stale' && lastSentSeq >= 0 && lastSeq >= lastSentSeq) break
        lastRejected = msg.reason
        rejectCount++
        break
      }
      case 'presence':
        presence = { creator: msg.creator, guest: msg.guest }
        break
    }
    emit()
  }

  /** Abre un socket y resuelve (con el código de cierre, si lo hubo) cuando se cierra o se da por muerto. */
  function openSocket(): Promise<number | undefined> {
    return new Promise((resolve) => {
      const params = new URLSearchParams({ playerId: getPlayerId(opts.storage) })
      const token = getSeatToken(opts.storage, roomId)
      if (token) params.set('token', token)
      if (joinNext) params.set('join', '1')
      if (events.length) params.set('lastSeq', String(events[events.length - 1]!.seq))
      const ws = makeSocket(defaultUrl(roomId, params.toString()))
      socket = ws
      let done = false
      let pingTimer: unknown = null
      let pongTimer: unknown = null

      const finish = (code?: number) => {
        if (done) return
        done = true
        if (pingTimer !== null) timers.clear(pingTimer)
        if (pongTimer !== null) timers.clear(pongTimer)
        clearAck()
        forceReconnect = null
        checkAlive = null
        ws.onmessage = null
        ws.onclose = null
        if (socket === ws) socket = null
        resolve(code)
      }
      // Un socket medio abierto no dispara `onclose` a tiempo: se abandona y se cierra en segundo plano.
      const kill = () => {
        try {
          ws.close()
        } catch {
          /* ya cerrado */
        }
        finish()
      }
      const schedulePing = () => {
        if (pingTimer !== null) timers.clear(pingTimer)
        pingTimer = timers.set(ping, PING_INTERVAL_MS)
      }
      const ping = () => {
        if (done) return
        if (pingTimer !== null) timers.clear(pingTimer)
        pingTimer = null
        if (pongTimer === null) {
          try {
            ws.send(PING)
          } catch {
            /* el envío falló: el timeout de pong lo resuelve */
          }
          pongTimer = timers.set(kill, PONG_TIMEOUT_MS)
        }
      }
      const alive = () => {
        if (pongTimer !== null) timers.clear(pongTimer)
        pongTimer = null
        schedulePing()
      }
      forceReconnect = kill
      checkAlive = ping
      schedulePing()

      ws.onmessage = (e: MessageEvent) => {
        const data = String(e.data)
        // Cualquier mensaje prueba que el socket vive; `pong` no es JSON y no se parsea.
        alive()
        if (data === PONG) return
        try {
          handle(JSON.parse(data) as ServerMessage)
        } catch {
          /* mensaje malformado: se ignora */
        }
      }
      ws.onclose = (e?: { code?: number }) => finish(e?.code)
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
      const code = await openSocket()
      if (closed) return
      if (code === 4001) {
        // Otro dispositivo del mismo dueño tomó el asiento: terminal, sin reintentos.
        status = 'replaced'
        emit()
        return
      }
      if (code === 1013) {
        // Sala llena de espectadores: reintentar no sirve, es un estado terminal.
        status = 'full'
        emit()
        return
      }
      if (reconnectNow) {
        reconnectNow = false
        continue
      }
      status = 'reconnecting'
      emit()
      await sleep(delay)
      delay = Math.min(delay * 2, BACKOFF_MAX_MS)
    }
  }
  const unwatch = (opts.onWake ?? defaultOnWake)(() => checkAlive?.())
  void run().finally(unwatch)

  return {
    send(intent) {
      if (!seat || !events.length) return 'not-started'
      const rejected = validateIntentLocally(project(events), seat, intent)
      if (rejected) return rejected
      // Sin socket abierto no se puede enviar; 'illegal' es el motivo genérico disponible.
      if (!socket || status !== 'open') return 'illegal'
      // Intención ya en vuelo: el doble toque no se reenvía (el servidor rechazaría la copia como
      // `stale` y mostraría un aviso falso). Devuelve null: para quien toca, la jugada está "en camino".
      // `resign` es la excepción: no depende de `seq` vigente, y rendirse nunca debe quedar trabado
      // detrás de una jugada sin confirmar.
      if (inFlight && intent.type !== 'resign') return null
      const msg: ClientMessage = { t: 'intent', intent }
      socket.send(JSON.stringify(msg))
      inFlight = true
      lastSentSeq = intent.seq
      if (ackTimer !== null) timers.clear(ackTimer)
      ackTimer = timers.set(() => forceReconnect?.(), ACK_TIMEOUT_MS)
      return null
    },
    joinAsPlayer() {
      joinNext = true
      // Sin socket vivo (caída en curso) el próximo upgrade ya lleva `join=1`; nada más que hacer.
      if (!forceReconnect) return
      reconnectNow = true
      forceReconnect()
    },
    close() {
      closed = true
      clearAck()
      unwatch()
      const ws = socket
      socket = null
      ws?.close()
    },
  }
}
