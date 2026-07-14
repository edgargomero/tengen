// Fase 5 Task 3: backup a Google Drive. `fetchMock` de cloudflare:test intercepta el fetch
// OUTBOUND del worker (googleapis.com) — los bindings (D1) no pasan por ahí. disableNetConnect
// garantiza que ningún test toque la red real.
import { env, fetchMock } from 'cloudflare:test'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ensureTengenFolder, uploadSgf, DriveApiError } from '../src/drive'
import app from '../src/index'
import { seedUser } from './authSeed'

const SGF = '(;GM[1]FF[4]SZ[9];B[ee])'
const ORIGIN = 'https://www.googleapis.com'

beforeAll(() => {
  fetchMock.activate()
  fetchMock.disableNetConnect()
})

afterEach(() => {
  fetchMock.assertNoPendingInterceptors()
})

function interceptFolderList(existingId?: string): void {
  fetchMock
    .get(ORIGIN)
    .intercept({ method: 'GET', path: (p) => p.startsWith('/drive/v3/files?') })
    .reply(200, JSON.stringify({ files: existingId ? [{ id: existingId }] : [] }))
}

function interceptFolderCreate(newId: string): void {
  fetchMock
    .get(ORIGIN)
    .intercept({ method: 'POST', path: '/drive/v3/files' })
    .reply(200, JSON.stringify({ id: newId }))
}

describe('ensureTengenFolder', () => {
  it('reusa la carpeta existente sin crear otra', async () => {
    interceptFolderList('folder-existente')
    const id = await ensureTengenFolder('tok')
    expect(id).toBe('folder-existente')
  })

  it('crea la carpeta si no existe', async () => {
    interceptFolderList()
    interceptFolderCreate('folder-nuevo')
    const id = await ensureTengenFolder('tok')
    expect(id).toBe('folder-nuevo')
  })
})

describe('uploadSgf', () => {
  it('alta: POST multipart con metadata (nombre+carpeta) y el SGF en el body', async () => {
    let capturedBody = ''
    fetchMock
      .get(ORIGIN)
      .intercept({
        method: 'POST',
        path: (p) => p.startsWith('/upload/drive/v3/files?uploadType=multipart'),
        body: (b) => {
          capturedBody = String(b)
          return true
        },
      })
      .reply(200, JSON.stringify({ id: 'file-nuevo' }))

    const id = await uploadSgf({
      accessToken: 'tok',
      folderId: 'folder-1',
      fileName: 'partida.sgf',
      sgf: SGF,
    })
    expect(id).toBe('file-nuevo')
    expect(capturedBody).toContain('"parents":["folder-1"]')
    expect(capturedBody).toContain('"name":"partida.sgf"')
    expect(capturedBody).toContain(SGF)
  })

  it('update: PATCH uploadType=media sobre el fileId existente', async () => {
    fetchMock
      .get(ORIGIN)
      .intercept({ method: 'PATCH', path: '/upload/drive/v3/files/file-viejo?uploadType=media' })
      .reply(200, JSON.stringify({ id: 'file-viejo' }))

    const id = await uploadSgf({
      accessToken: 'tok',
      folderId: 'folder-1',
      fileName: 'partida.sgf',
      sgf: SGF,
      fileId: 'file-viejo',
    })
    expect(id).toBe('file-viejo')
  })

  it('PATCH 404 (el usuario borró el archivo de su Drive) → re-crea con POST', async () => {
    fetchMock
      .get(ORIGIN)
      .intercept({ method: 'PATCH', path: '/upload/drive/v3/files/file-borrado?uploadType=media' })
      .reply(404, 'not found')
    fetchMock
      .get(ORIGIN)
      .intercept({ method: 'POST', path: (p) => p.startsWith('/upload/drive/v3/files?uploadType=multipart') })
      .reply(200, JSON.stringify({ id: 'file-recreado' }))

    const id = await uploadSgf({
      accessToken: 'tok',
      folderId: 'folder-1',
      fileName: 'partida.sgf',
      sgf: SGF,
      fileId: 'file-borrado',
    })
    expect(id).toBe('file-recreado')
  })

  it('otros errores de Google NO se tragan (PATCH 500 → DriveApiError)', async () => {
    fetchMock
      .get(ORIGIN)
      .intercept({ method: 'PATCH', path: '/upload/drive/v3/files/file-x?uploadType=media' })
      .reply(500, 'boom')

    await expect(
      uploadSgf({ accessToken: 'tok', folderId: 'f', fileName: 'p.sgf', sgf: SGF, fileId: 'file-x' }),
    ).rejects.toThrow(DriveApiError)
  })
})

// ── Ruta completa POST /api/games/:id/drive-backup ─────────────────────────────────────────────

function authedInit(cookie: string, method = 'POST', body?: string): RequestInit {
  return {
    method,
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body } : {}),
  }
}

async function createGame(cookie: string): Promise<string> {
  const res = await app.request(
    '/api/games',
    authedInit(
      cookie,
      'POST',
      JSON.stringify({ name: 'backup-test', sgf: SGF, boardSize: 9, mode: 'jugar' }),
    ),
    env,
  )
  const { id } = (await res.json()) as { id: string }
  return id
}

describe('POST /api/games/:id/drive-backup', () => {
  it('sin sesión → 401', async () => {
    const res = await app.request('/api/games/x/drive-backup', { method: 'POST' }, env)
    expect(res.status).toBe(401)
  })

  it('partida ajena → 404 (sin llamar a Google)', async () => {
    const owner = await seedUser('dv-owner')
    const intruder = await seedUser('dv-intruder')
    const id = await createGame(owner.cookie)
    const res = await app.request(`/api/games/${id}/drive-backup`, authedInit(intruder.cookie), env)
    expect(res.status).toBe(404)
  })

  it('flujo completo: usa el token seedeado, sube a Drive y persiste drive_file_id en D1', async () => {
    const user = await seedUser('dv-full')
    const id = await createGame(user.cookie)

    let authHeader = ''
    fetchMock
      .get(ORIGIN)
      .intercept({
        method: 'GET',
        path: (p) => p.startsWith('/drive/v3/files?'),
        headers: (h) => {
          authHeader = (h as Record<string, string>).authorization ?? ''
          return true
        },
      })
      .reply(200, JSON.stringify({ files: [{ id: 'folder-1' }] }))
    fetchMock
      .get(ORIGIN)
      .intercept({ method: 'POST', path: (p) => p.startsWith('/upload/drive/v3/files?uploadType=multipart') })
      .reply(200, JSON.stringify({ id: 'drive-file-1' }))

    const res = await app.request(`/api/games/${id}/drive-backup`, authedInit(user.cookie), env)
    expect(res.status).toBe(200)
    expect((await res.json()) as object).toEqual({ driveFileId: 'drive-file-1' })
    // getAccessToken devolvió el token seedeado SIN refresh (expiry a 1h — nunca llama a Google).
    expect(authHeader).toBe(`Bearer ${user.googleAccessToken}`)

    const row = await env.DB.prepare('SELECT drive_file_id FROM games WHERE id = ?')
      .bind(id)
      .first<{ drive_file_id: string }>()
    expect(row!.drive_file_id).toBe('drive-file-1')
  })

  it('con drive_file_id previo hace PATCH (update in-place del backup)', async () => {
    const user = await seedUser('dv-patch')
    const id = await createGame(user.cookie)
    await env.DB.prepare('UPDATE games SET drive_file_id = ? WHERE id = ?').bind('drive-old', id).run()

    fetchMock
      .get(ORIGIN)
      .intercept({ method: 'GET', path: (p) => p.startsWith('/drive/v3/files?') })
      .reply(200, JSON.stringify({ files: [{ id: 'folder-1' }] }))
    fetchMock
      .get(ORIGIN)
      .intercept({ method: 'PATCH', path: '/upload/drive/v3/files/drive-old?uploadType=media' })
      .reply(200, JSON.stringify({ id: 'drive-old' }))

    const res = await app.request(`/api/games/${id}/drive-backup`, authedInit(user.cookie), env)
    expect(res.status).toBe(200)
    expect((await res.json()) as object).toEqual({ driveFileId: 'drive-old' })
  })

  it('Google caído → 502 y D1 queda intacto (drive_file_id sigue null)', async () => {
    const user = await seedUser('dv-502')
    const id = await createGame(user.cookie)

    fetchMock
      .get(ORIGIN)
      .intercept({ method: 'GET', path: (p) => p.startsWith('/drive/v3/files?') })
      .reply(500, 'boom')

    const res = await app.request(`/api/games/${id}/drive-backup`, authedInit(user.cookie), env)
    expect(res.status).toBe(502)

    const row = await env.DB.prepare('SELECT drive_file_id FROM games WHERE id = ?')
      .bind(id)
      .first<{ drive_file_id: string | null }>()
    expect(row!.drive_file_id).toBeNull()
  })
})
