/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/downloadProgress.ts. Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 * Se porta VERBATIM solo la matemática de progreso (getContentLength/getProgressPercent). El loop
 * de streaming (getReader + acumulación) NO se porta: web-katrain acumula en un Blob en memoria;
 * tengen reimplementa el loop en modelCache.ts con escritura incremental a OPFS (RAM plana).
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */

export type DownloadProgress = {
  receivedBytes: number
  totalBytes: number | null
  percent: number | null
}

export function getContentLength(headers: Headers): number | null {
  const raw = headers.get('content-length')
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function getProgressPercent(receivedBytes: number, totalBytes: number | null): number | null {
  if (!totalBytes) return null
  return Math.min(100, Math.max(0, Math.round((receivedBytes / totalBytes) * 100)))
}
