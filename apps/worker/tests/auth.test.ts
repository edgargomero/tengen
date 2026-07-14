// Fase 5 Task 1: better-auth montado sobre D1. No se testea el flujo OAuth real (eso es el gate
// manual con credenciales de Edgar); acá solo que el schema migró y que /api/auth/* responde
// better-auth y NO cae al fallback ASSETS de la SPA.
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

describe('migración 0001 — schema de better-auth', () => {
  it('crea las tablas user/session/account/verification', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>()
    const names = results.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['user', 'session', 'account', 'verification']))
  })

})

describe('mount /api/auth/*', () => {
  it('get-session sin cookie responde JSON de better-auth (no el index.html del fallback)', async () => {
    const res = await app.request('/api/auth/get-session', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('application/json')
    expect(await res.json()).toBeNull()
  })

  it('una ruta de auth inexistente responde 404 de better-auth, sin caer a ASSETS', async () => {
    const res = await app.request('/api/auth/no-existe', {}, env)
    expect(res.status).toBe(404)
  })
})
