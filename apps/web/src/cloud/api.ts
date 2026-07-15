// Wrappers finos sobre la API /api/games del worker (Fase 5). `fetch` INYECTADO (mismo patrón que
// el Storage de persistence.ts): Node-testeable sin tocar el global. Lanzan ante !ok — el manejo
// (retry, badge) es de gameSync.ts; acá solo se traduce HTTP↔tipos.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type CloudGameMode = 'jugar' | 'analizar'

/** Snapshot completo de una partida tal como viaja al worker. */
export interface GameSnapshot {
  /** Requerido por el worker en el primer guardado (POST); se OMITE al actualizar una partida
   * reabierta para no pisar el nombre que ya tiene en D1. */
  name?: string
  sgf: string
  boardSize: number
  mode: CloudGameMode
  result?: string
  /** RankLevel (solo mode='jugar'); el worker lo valida y re-serializa. */
  opponent?: unknown
}

/** Item del listado de "Mis partidas" (sin sgf — la API no lo manda en la lista). */
export interface GameSummary {
  id: string
  name: string
  boardSize: number
  mode: CloudGameMode
  result: string | null
  opponent: unknown
  driveFileId: string | null
  createdAt: number
  updatedAt: number
}

export interface GameDetail extends GameSummary {
  sgf: string
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function ensureOk(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} → HTTP ${res.status}`)
  return res
}

export async function createGame(fetchImpl: FetchLike, snapshot: GameSnapshot): Promise<string> {
  const res = await ensureOk(
    await fetchImpl('/api/games', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(snapshot) }),
    'POST /api/games',
  )
  const { id } = (await res.json()) as { id: string }
  return id
}

export async function updateGame(fetchImpl: FetchLike, id: string, snapshot: GameSnapshot): Promise<void> {
  await ensureOk(
    await fetchImpl(`/api/games/${id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(snapshot) }),
    `PUT /api/games/${id}`,
  )
}

export async function listGames(fetchImpl: FetchLike): Promise<GameSummary[]> {
  const res = await ensureOk(await fetchImpl('/api/games'), 'GET /api/games')
  const { games } = (await res.json()) as { games: GameSummary[] }
  return games
}

export async function getGame(fetchImpl: FetchLike, id: string): Promise<GameDetail> {
  const res = await ensureOk(await fetchImpl(`/api/games/${id}`), `GET /api/games/${id}`)
  return (await res.json()) as GameDetail
}

export async function backupToDrive(fetchImpl: FetchLike, id: string): Promise<void> {
  await ensureOk(
    await fetchImpl(`/api/games/${id}/drive-backup`, { method: 'POST' }),
    `POST /api/games/${id}/drive-backup`,
  )
}
