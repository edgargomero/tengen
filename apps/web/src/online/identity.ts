// Identidad anónima del jugador para partidas online: un playerId aleatorio persistido en
// localStorage, y un seatToken por sala (lo emite el servidor al crear/unirse; prueba la propiedad
// del asiento al reconectar). Sin cuentas: perder el storage = perder el asiento.
import type { RoomConfig } from '@tengen/go-rules'
import type { StorageLike } from '../game/persistence'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const PLAYER_KEY = 'tengen.playerId'
const seatKey = (roomId: string) => `tengen.seat.${roomId}`

function randomId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('')
}

export function getPlayerId(storage: StorageLike): string {
  try {
    const existing = storage.getItem(PLAYER_KEY)
    if (existing) return existing
  } catch {
    /* storage bloqueado: id efímero */
  }
  const id = randomId()
  try {
    storage.setItem(PLAYER_KEY, id)
  } catch {
    /* ídem */
  }
  return id
}

export function getSeatToken(storage: StorageLike, roomId: string): string | undefined {
  try {
    return storage.getItem(seatKey(roomId)) ?? undefined
  } catch {
    return undefined
  }
}

export function setSeatToken(storage: StorageLike, roomId: string, token: string): void {
  try {
    storage.setItem(seatKey(roomId), token)
  } catch {
    /* sin persistencia: la sala sigue viva pero no se podrá reconectar al asiento tras recargar */
  }
}

/** POST /api/rooms → guarda el seatToken del creador. Lanza si el servidor no responde 201. */
export async function createRoom(
  config: RoomConfig,
  fetchFn: FetchLike = (i, init) => fetch(i, init),
  storage: StorageLike = window.localStorage,
): Promise<{ roomId: string }> {
  const res = await fetchFn('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ config, playerId: getPlayerId(storage) }),
  })
  if (res.status !== 201) throw new Error(`createRoom failed: ${res.status}`)
  const { roomId, seatToken } = (await res.json()) as { roomId: string; seatToken: string }
  setSeatToken(storage, roomId, seatToken)
  return { roomId }
}
