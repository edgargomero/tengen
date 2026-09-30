// Protocolo de red (JSON por WebSocket) de las salas online. Fuente única: lo importan el Durable
// Object (worker) y el cliente (web), para que no puedan divergir.
import type { Intent, RejectReason, RoomEvent, SeatRole } from './room'

/** Mensajes servidor → cliente. `serverNow` es Date.now() del DO al emitir (para el desfase de reloj). */
export type ServerMessage =
  | { t: 'welcome'; seat: SeatRole | 'spectator'; seatToken?: string; events: RoomEvent[]; serverNow: number }
  | { t: 'events'; events: RoomEvent[]; serverNow: number }
  | { t: 'rejected'; reason: RejectReason }
  | { t: 'presence'; creator: boolean; guest: boolean }
/** Mensajes cliente → servidor. */
export type ClientMessage = { t: 'intent'; intent: Intent }

/** Latido de vida del socket: texto crudo (no JSON); el DO responde sin despertarse. */
export const PING = 'ping'
export const PONG = 'pong'
