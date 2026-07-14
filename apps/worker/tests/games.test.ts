// Fase 5 Task 2: API /api/games. La sesión viene del seed directo a D1 (tests/authSeed.ts) — acá
// se testea la API, no el flujo OAuth (gate manual de Task 7).
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'
import { seedUser } from './authSeed'

const SGF = '(;GM[1]FF[4]SZ[9];B[ee];W[cc])'

/** Body válido mínimo para POST /api/games. */
function createBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: '9×9 vs 15k — test',
    sgf: SGF,
    boardSize: 9,
    mode: 'jugar',
    opponent: { kind: 'human', rank: '15k' },
    ...overrides,
  })
}

function authedInit(cookie: string, method = 'GET', body?: string): RequestInit {
  return {
    method,
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body } : {}),
  }
}

describe('sin sesión → 401 en las 4 rutas', () => {
  it.each([
    ['GET', '/api/games'],
    ['GET', '/api/games/algun-id'],
    ['POST', '/api/games'],
    ['PUT', '/api/games/algun-id'],
  ])('%s %s', async (method, path) => {
    const res = await app.request(path, { method }, env)
    expect(res.status).toBe(401)
  })
})

describe('POST /api/games', () => {
  it('crea la partida y la fila queda en D1 con el user_id del dueño', async () => {
    const user = await seedUser('post')
    const res = await app.request('/api/games', authedInit(user.cookie, 'POST', createBody()), env)
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(id).toMatch(/[0-9a-f-]{36}/)

    const row = await env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(id).first()
    expect(row).toMatchObject({
      user_id: user.userId,
      name: '9×9 vs 15k — test',
      sgf: SGF,
      board_size: 9,
      mode: 'jugar',
      result: null,
      opponent: JSON.stringify({ kind: 'human', rank: '15k' }),
      drive_file_id: null,
    })
  })

  it.each([
    ['sgf vacío', createBody({ sgf: '' })],
    ['sgf gigante', createBody({ sgf: 'x'.repeat(256 * 1024 + 1) })],
    ['mode inválido', createBody({ mode: 'torneo' })],
    ['boardSize inválido', createBody({ boardSize: 10 })],
    ['sin name', createBody({ name: undefined })],
    ['opponent basura', createBody({ opponent: { kind: 'alien' } })],
    ['body no-JSON', 'esto no es json'],
  ])('payload inválido (%s) → 400', async (_label, body) => {
    const user = await seedUser('post400')
    const res = await app.request('/api/games', authedInit(user.cookie, 'POST', body), env)
    expect(res.status).toBe(400)
  })

  it('rate limit excedido → 429 con mensaje claro (LIMITER fake inyectado)', async () => {
    const user = await seedUser('post429')
    const limited = { ...env, LIMITER: { limit: async () => ({ success: false }) } }
    const res = await app.request('/api/games', authedInit(user.cookie, 'POST', createBody()), limited)
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('Demasiados guardados')
  })
})

describe('PUT /api/games/:id', () => {
  it('actualiza in-place (mismo id, sgf/result nuevos, updated_at avanza)', async () => {
    const user = await seedUser('put')
    const created = await app.request('/api/games', authedInit(user.cookie, 'POST', createBody()), env)
    const { id } = (await created.json()) as { id: string }
    const before = await env.DB.prepare('SELECT updated_at FROM games WHERE id = ?')
      .bind(id)
      .first<{ updated_at: number }>()

    const newSgf = `${SGF.slice(0, -1)};B[gg])`
    const res = await app.request(
      `/api/games/${id}`,
      authedInit(user.cookie, 'PUT', JSON.stringify({ sgf: newSgf, result: 'W+R' })),
      env,
    )
    expect(res.status).toBe(200)

    const row = await env.DB.prepare('SELECT * FROM games WHERE id = ?')
      .bind(id)
      .first<{ sgf: string; result: string; updated_at: number }>()
    expect(row!.sgf).toBe(newSgf)
    expect(row!.result).toBe('W+R')
    expect(row!.updated_at).toBeGreaterThanOrEqual(before!.updated_at)

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM games').first<{ n: number }>()
    expect(count!.n).toBe(1) // in-place: nunca una segunda fila
  })

  it('partida de OTRO usuario → 404 (y la fila no cambia)', async () => {
    const owner = await seedUser('owner')
    const intruder = await seedUser('intruder')
    const created = await app.request('/api/games', authedInit(owner.cookie, 'POST', createBody()), env)
    const { id } = (await created.json()) as { id: string }

    const res = await app.request(
      `/api/games/${id}`,
      authedInit(intruder.cookie, 'PUT', JSON.stringify({ sgf: '(;GM[1]FF[4]SZ[9];B[aa])' })),
      env,
    )
    expect(res.status).toBe(404)
    const row = await env.DB.prepare('SELECT sgf FROM games WHERE id = ?').bind(id).first<{ sgf: string }>()
    expect(row!.sgf).toBe(SGF)
  })

  it('partida inexistente → 404', async () => {
    const user = await seedUser('put404')
    const res = await app.request(
      '/api/games/no-existe',
      authedInit(user.cookie, 'PUT', JSON.stringify({ sgf: SGF })),
      env,
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/games (listado)', () => {
  it('lista solo las propias, sin sgf, ordenadas por updated_at DESC', async () => {
    const user = await seedUser('list')
    const other = await seedUser('list-other')

    const first = await app.request(
      '/api/games',
      authedInit(user.cookie, 'POST', createBody({ name: 'vieja' })),
      env,
    )
    const { id: oldId } = (await first.json()) as { id: string }
    await app.request(
      '/api/games',
      authedInit(user.cookie, 'POST', createBody({ name: 'nueva', mode: 'analizar', opponent: undefined })),
      env,
    )
    await app.request('/api/games', authedInit(other.cookie, 'POST', createBody({ name: 'ajena' })), env)
    // Tocar la vieja: pasa al frente del listado.
    await app.request(`/api/games/${oldId}`, authedInit(user.cookie, 'PUT', JSON.stringify({ sgf: SGF })), env)

    const res = await app.request('/api/games', authedInit(user.cookie), env)
    expect(res.status).toBe(200)
    const { games } = (await res.json()) as { games: Record<string, unknown>[] }
    expect(games).toHaveLength(2)
    expect(games.map((g) => g.name)).toEqual(['vieja', 'nueva'])
    for (const g of games) {
      expect(g).not.toHaveProperty('sgf')
      expect(g).toHaveProperty('boardSize', 9)
    }
  })
})

describe('GET /api/games/:id', () => {
  it('devuelve la partida completa (con sgf y opponent parseado)', async () => {
    const user = await seedUser('get')
    const created = await app.request('/api/games', authedInit(user.cookie, 'POST', createBody()), env)
    const { id } = (await created.json()) as { id: string }

    const res = await app.request(`/api/games/${id}`, authedInit(user.cookie), env)
    expect(res.status).toBe(200)
    const game = (await res.json()) as Record<string, unknown>
    expect(game).toMatchObject({
      id,
      name: '9×9 vs 15k — test',
      sgf: SGF,
      boardSize: 9,
      mode: 'jugar',
      opponent: { kind: 'human', rank: '15k' },
      driveFileId: null,
    })
  })

  it('partida ajena → 404', async () => {
    const owner = await seedUser('get-owner')
    const intruder = await seedUser('get-intruder')
    const created = await app.request('/api/games', authedInit(owner.cookie, 'POST', createBody()), env)
    const { id } = (await created.json()) as { id: string }

    const res = await app.request(`/api/games/${id}`, authedInit(intruder.cookie), env)
    expect(res.status).toBe(404)
  })
})
