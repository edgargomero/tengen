// Backup a Google Drive (Fase 5 Task 3). Módulo PURO respecto al resto del worker: recibe un
// accessToken y habla con la Drive API vía fetch global — no conoce better-auth ni Hono (la ruta
// en games.ts hace el pegamento). Con el scope drive.file, files.list SOLO ve archivos/carpetas
// creados por esta app: la carpeta "tengen" del usuario es efectivamente un namespace propio.
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SGF_MIME = 'application/x-go-sgf'

/** Error de la Drive API con el status de Google (la ruta lo traduce a 502; nunca toca D1). */
export class DriveApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DriveApiError'
  }
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

async function driveFetch(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init)
  if (!res.ok) {
    // El body de error de Google puede ser JSON o HTML; se ignora (el status alcanza para decidir).
    await res.body?.cancel()
    throw new DriveApiError(res.status, `Drive API ${init.method ?? 'GET'} ${res.status}`)
  }
  return res
}

/** Devuelve el id de la carpeta "tengen" del Drive del usuario, creándola si no existe. */
export async function ensureTengenFolder(accessToken: string): Promise<string> {
  const q = `name='tengen' and mimeType='${FOLDER_MIME}' and trashed=false`
  const listUrl = `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id)`
  const listRes = await driveFetch(listUrl, { method: 'GET', headers: authHeaders(accessToken) })
  const list = (await listRes.json()) as { files?: { id: string }[] }
  const existing = list.files?.[0]
  if (existing) return existing.id

  const createRes = await driveFetch(DRIVE_FILES, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'tengen', mimeType: FOLDER_MIME }),
  })
  const created = (await createRes.json()) as { id: string }
  return created.id
}

export interface UploadSgfParams {
  accessToken: string
  folderId: string
  /** Nombre visible en Drive (con extensión .sgf). */
  fileName: string
  sgf: string
  /** Id de un backup anterior: se actualiza in-place en vez de crear un duplicado. */
  fileId?: string | null
}

/** Sube (o actualiza) el .sgf en la carpeta de tengen y devuelve el fileId resultante.
 * Si el PATCH de actualización da 404 (el usuario borró el archivo de SU Drive — es suyo),
 * se re-crea desde cero: el backup nunca queda huérfano por una limpieza manual. */
export async function uploadSgf(params: UploadSgfParams): Promise<string> {
  if (params.fileId) {
    try {
      await driveFetch(`${DRIVE_UPLOAD}/${params.fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...authHeaders(params.accessToken), 'Content-Type': SGF_MIME },
        body: params.sgf,
      })
      return params.fileId
    } catch (e) {
      if (!(e instanceof DriveApiError && e.status === 404)) throw e
      // 404 → cae al POST de creación de abajo.
    }
  }

  // Alta multipart: metadata (nombre + carpeta) y contenido en un solo request.
  const boundary = 'tengen-sgf-boundary'
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: params.fileName, parents: [params.folderId], mimeType: SGF_MIME }),
    `--${boundary}`,
    `Content-Type: ${SGF_MIME}`,
    '',
    params.sgf,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const res = await driveFetch(`${DRIVE_UPLOAD}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      ...authHeaders(params.accessToken),
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  })
  const created = (await res.json()) as { id: string }
  return created.id
}
