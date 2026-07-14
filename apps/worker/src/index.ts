import { Hono } from 'hono'
import { createAuth } from './auth'

export interface Env {
  MODELS: R2Bucket
  ASSETS: Fetcher
  DB: D1Database
  LIMITER: RateLimit
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
}

// `ort-wasm-simd-threaded.jsep.wasm` pesa 25.6 MiB — supera el límite de 25 MiB/archivo de
// Cloudflare Workers Static Assets, así que no puede vivir en dist/ort-dist/ como static asset
// (excluido explícitamente vía apps/web/public/.assetsignore). Se sirve desde el mismo bucket
// R2 que los modelos, bajo el prefijo de key `ort-dist/`, igual que /models/:filename.
const ORT_DIST_CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
}

const app = new Hono<{ Bindings: Env }>()

app.get('/models/:filename', async (c) => {
  const filename = c.req.param('filename')
  const object = await c.env.MODELS.get(filename)
  if (!object) return c.notFound()
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

app.get('/ort-dist/:filename', async (c) => {
  const filename = c.req.param('filename')
  const object = await c.env.MODELS.get(`ort-dist/${filename}`)
  if (!object) return c.notFound()
  const dot = filename.lastIndexOf('.')
  const ext = dot === -1 ? '' : filename.slice(dot)
  const contentType = ORT_DIST_CONTENT_TYPES[ext] ?? 'application/octet-stream'
  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
      // ORT multihilo carga el .mjs como script de un dedicated worker; bajo crossOriginIsolated
      // el worker hereda COEP y su script debe llegar con este header o Chrome lo bloquea (mismo
      // motivo que el middleware de dev en apps/web/vite.config.ts).
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  })
})

// better-auth maneja TODO /api/auth/* (login social, callback de Google, get-session, sign-out…).
// Debe ir ANTES del fallback ASSETS: con `single-page-application`, el fallback respondería el
// index.html de la SPA a cualquier ruta de auth no interceptada.
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw))

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
