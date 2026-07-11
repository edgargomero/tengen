import { Hono } from 'hono'

export interface Env {
  MODELS: R2Bucket
  ASSETS: Fetcher
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

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
