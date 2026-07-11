import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
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

// referencia a `app` para que tsc no marque el import como no usado hasta Task 2
void app
