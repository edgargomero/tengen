import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import app, { type Env } from '../src/index'

// Ampliación ambiental necesaria para que `env` de cloudflare:test tenga los bindings
// de Env tipados (no está en el brief original; sin esto tsc marca `env.MODELS`/`env.ASSETS`
// como inexistentes en `ProvidedEnv`, que por defecto está vacía).
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

describe('apps/worker — scaffold', () => {
  it('el binding MODELS existe en el entorno de test', () => {
    expect(env.MODELS).toBeDefined()
  })
  it('el binding ASSETS existe en el entorno de test', () => {
    expect(env.ASSETS).toBeDefined()
  })
})

describe('GET /models/:filename', () => {
  beforeEach(async () => {
    await env.MODELS.put('existe.onnx', new TextEncoder().encode('contenido-de-prueba'))
  })

  afterEach(async () => {
    await env.MODELS.delete('existe.onnx')
  })

  it('devuelve 200 con el contenido y headers de caché inmutable', async () => {
    const res = await app.request('/models/existe.onnx', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    const buf = await res.arrayBuffer()
    expect(new TextDecoder().decode(buf)).toBe('contenido-de-prueba')
  })

  it('devuelve 404 si el archivo no existe en el bucket', async () => {
    const res = await app.request('/models/no-existe.onnx', {}, env)
    expect(res.status).toBe(404)
  })

  it('el Content-Length coincide con el tamaño real del objeto', async () => {
    const res = await app.request('/models/existe.onnx', {}, env)
    expect(res.headers.get('Content-Length')).toBe(String('contenido-de-prueba'.length))
    // Consume the body to properly dispose of resources
    await res.arrayBuffer()
  })
})
