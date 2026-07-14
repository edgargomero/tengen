// API de partidas en la nube (Fase 5 Task 2): data access sobre D1 + sub-app Hono.
//
// Todas las queries van scoped a `user_id` — no existe un camino para tocar filas ajenas (un PUT
// sobre una partida de otro usuario da el mismo 404 que una inexistente, sin filtrar existencia).
// El rate limit (binding LIMITER de wrangler.jsonc, key = userId) solo aplica a ESCRITURAS: el
// guardado automático dispara ~1 request por jugada y es lo único con volumen real.
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { requireUser, type AuthVariables } from './auth'
import type { Env } from './index'

export type GameMode = 'jugar' | 'analizar'

/** Fila cruda de la tabla games (snake_case, como el DDL de 0002_games.sql). */
export interface GameRow {
  id: string
  user_id: string
  name: string
  sgf: string
  board_size: number
  mode: GameMode
  result: string | null
  opponent: string | null
  drive_file_id: string | null
  created_at: number
  updated_at: number
}

const BOARD_SIZES = [9, 13, 19]
const MAX_SGF_LENGTH = 256 * 1024
const MAX_NAME_LENGTH = 200
const MAX_RESULT_LENGTH = 100

// ── Data access (funciones puras sobre D1, testeables sin HTTP) ────────────────────────────────

export async function insertGame(db: D1Database, row: GameRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO games (id, user_id, name, sgf, board_size, mode, result, opponent, drive_file_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.user_id,
      row.name,
      row.sgf,
      row.board_size,
      row.mode,
      row.result,
      row.opponent,
      row.drive_file_id,
      row.created_at,
      row.updated_at,
    )
    .run()
}

/** Update in-place de una partida propia. Devuelve false si la fila no existe o es de otro usuario
 * (mismo 404 hacia afuera: no se revela cuál de las dos). name/result/opponent solo se pisan si
 * vienen definidos (COALESCE no sirve: un result nuevo SÍ debe poder pisar null → se arma el SET
 * con los campos presentes). */
export async function updateGame(
  db: D1Database,
  userId: string,
  id: string,
  fields: { sgf: string; name?: string; result?: string; opponent?: string },
): Promise<boolean> {
  const sets = ['sgf = ?', 'updated_at = ?']
  const binds: (string | number)[] = [fields.sgf, Date.now()]
  if (fields.name !== undefined) {
    sets.push('name = ?')
    binds.push(fields.name)
  }
  if (fields.result !== undefined) {
    sets.push('result = ?')
    binds.push(fields.result)
  }
  if (fields.opponent !== undefined) {
    sets.push('opponent = ?')
    binds.push(fields.opponent)
  }
  binds.push(id, userId)
  const res = await db
    .prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...binds)
    .run()
  return res.meta.changes > 0
}

/** Lista para "Mis partidas": SIN la columna sgf (puede pesar cientos de KB por fila y el listado
 * no la necesita), ordenada por actividad reciente (índice games_user_updated_idx). */
export async function listGames(db: D1Database, userId: string): Promise<Omit<GameRow, 'sgf'>[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, board_size, mode, result, opponent, drive_file_id, created_at, updated_at
       FROM games WHERE user_id = ? ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<Omit<GameRow, 'sgf'>>()
  return results
}

export async function getGame(db: D1Database, userId: string, id: string): Promise<GameRow | null> {
  return await db
    .prepare('SELECT * FROM games WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<GameRow>()
}

export async function setDriveFileId(
  db: D1Database,
  userId: string,
  id: string,
  driveFileId: string,
): Promise<boolean> {
  const res = await db
    .prepare('UPDATE games SET drive_file_id = ? WHERE id = ? AND user_id = ?')
    .bind(driveFileId, id, userId)
    .run()
  return res.meta.changes > 0
}

// ── Validación del payload ─────────────────────────────────────────────────────────────────────

interface GamePayload {
  name?: string
  sgf: string
  boardSize?: number
  mode?: GameMode
  result?: string
  opponent?: unknown
}

/** Valida y normaliza el body de POST (requiere name/boardSize/mode) o PUT (solo sgf obligatorio).
 * Devuelve un mensaje de error legible o el payload tipado. El opponent se re-serializa acá (nunca
 * se guarda el string crudo del cliente): garantiza que lo que hay en D1 es JSON válido. */
function validatePayload(
  body: unknown,
  kind: 'create' | 'update',
): { error: string } | { payload: GamePayload & { opponentJson?: string } } {
  if (typeof body !== 'object' || body === null) return { error: 'body JSON requerido' }
  const b = body as Record<string, unknown>

  if (typeof b.sgf !== 'string' || b.sgf.length === 0) return { error: 'sgf requerido (string no vacío)' }
  if (b.sgf.length > MAX_SGF_LENGTH) return { error: `sgf demasiado grande (máx ${MAX_SGF_LENGTH} caracteres)` }

  if (kind === 'create') {
    if (typeof b.name !== 'string' || b.name.trim().length === 0) return { error: 'name requerido' }
    if (!BOARD_SIZES.includes(b.boardSize as number)) return { error: 'boardSize debe ser 9, 13 o 19' }
    if (b.mode !== 'jugar' && b.mode !== 'analizar') return { error: "mode debe ser 'jugar' o 'analizar'" }
  } else {
    if (b.name !== undefined && (typeof b.name !== 'string' || b.name.trim().length === 0))
      return { error: 'name inválido' }
  }
  if (typeof b.name === 'string' && b.name.length > MAX_NAME_LENGTH)
    return { error: `name demasiado largo (máx ${MAX_NAME_LENGTH})` }
  if (b.result !== undefined && (typeof b.result !== 'string' || b.result.length > MAX_RESULT_LENGTH))
    return { error: 'result inválido' }

  let opponentJson: string | undefined
  if (b.opponent !== undefined && b.opponent !== null) {
    if (!isRankLevelShape(b.opponent)) return { error: 'opponent inválido (RankLevel esperado)' }
    opponentJson = JSON.stringify(b.opponent)
  }

  return {
    payload: {
      name: b.name as string | undefined,
      sgf: b.sgf,
      boardSize: b.boardSize as number | undefined,
      mode: b.mode as GameMode | undefined,
      result: b.result as string | undefined,
      opponentJson,
    },
  }
}

/** Forma mínima de un RankLevel (duplicado a propósito del guard de apps/web/game/persistence.ts:
 * el worker no depende de @tengen/engine y solo necesita rechazar basura, no validar el catálogo). */
function isRankLevelShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.kind === 'human') return typeof v.rank === 'string'
  if (v.kind === 'kata') return typeof v.visits === 'number'
  return false
}

/** Serialización hacia el cliente (camelCase; opponent ya parseado). `sgf` solo en el GET por id. */
function rowToJson(row: GameRow | Omit<GameRow, 'sgf'>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    boardSize: row.board_size,
    mode: row.mode,
    result: row.result,
    opponent: row.opponent === null ? null : (JSON.parse(row.opponent) as unknown),
    driveFileId: row.drive_file_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...('sgf' in row ? { sgf: row.sgf } : {}),
  }
}

// ── Sub-app HTTP ───────────────────────────────────────────────────────────────────────────────

/** Rate limit por usuario en escrituras. Va DESPUÉS de requireUser (necesita el userId como key). */
const writeRateLimit = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const { success } = await c.env.LIMITER.limit({ key: c.get('userId') })
    if (!success) {
      return c.json({ error: 'Demasiados guardados seguidos; espera un momento y reintenta.' }, 429)
    }
    await next()
  },
)

export const gamesApp = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

gamesApp.use('*', requireUser)

gamesApp.get('/', async (c) => {
  const rows = await listGames(c.env.DB, c.get('userId'))
  return c.json({ games: rows.map(rowToJson) })
})

gamesApp.get('/:id', async (c) => {
  const row = await getGame(c.env.DB, c.get('userId'), c.req.param('id'))
  if (!row) return c.json({ error: 'Partida no encontrada' }, 404)
  return c.json(rowToJson(row))
})

gamesApp.post('/', writeRateLimit, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'body JSON requerido' }, 400)
  }
  const validated = validatePayload(body, 'create')
  if ('error' in validated) return c.json({ error: validated.error }, 400)
  const p = validated.payload
  const now = Date.now()
  const row: GameRow = {
    id: crypto.randomUUID(),
    user_id: c.get('userId'),
    name: p.name!,
    sgf: p.sgf,
    board_size: p.boardSize!,
    mode: p.mode!,
    result: p.result ?? null,
    opponent: p.opponentJson ?? null,
    drive_file_id: null,
    created_at: now,
    updated_at: now,
  }
  await insertGame(c.env.DB, row)
  return c.json({ id: row.id }, 201)
})

gamesApp.put('/:id', writeRateLimit, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'body JSON requerido' }, 400)
  }
  const validated = validatePayload(body, 'update')
  if ('error' in validated) return c.json({ error: validated.error }, 400)
  const p = validated.payload
  const updated = await updateGame(c.env.DB, c.get('userId'), c.req.param('id'), {
    sgf: p.sgf,
    name: p.name,
    result: p.result,
    opponent: p.opponentJson,
  })
  if (!updated) return c.json({ error: 'Partida no encontrada' }, 404)
  return c.json({ ok: true })
})
