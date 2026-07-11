import { Hono } from 'hono'

export interface Env {
  MODELS: R2Bucket
  ASSETS: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

// Task 2 añade GET /models/:filename aquí, ANTES de este catch-all.

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
