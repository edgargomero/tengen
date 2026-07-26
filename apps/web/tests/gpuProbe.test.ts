// El sondeo corre en Node con la GPU inyectada por `ProbeEnv` — de ahí que `probeGpu` reciba su entorno
// en vez de leer globals. Lo que se protege acá es que las cuatro causas de fallo lleguen SEPARADAS
// (`unsupported` / `null` / `error` / `timeout`): colapsarlas en un booleano es el bug que motivó el
// archivo, y es fácil de reintroducir sin darse cuenta.
import { describe, expect, it, vi } from 'vitest'
import { probeGpu } from '../src/diagnostics/gpuProbe'
import type { MinimalGpu } from '../src/diagnostics/gpuProbe'

/** Entorno base: reloj determinista, timeouts cortos para que el test no espere de verdad. */
function env(gpu: MinimalGpu | undefined, overrides: Partial<Parameters<typeof probeGpu>[0]> = {}) {
  return {
    scope: 'main' as const,
    gpu,
    crossOriginIsolated: true,
    hasSharedArrayBuffer: true,
    hardwareConcurrency: 8,
    timeoutMs: 30,
    lostGraceMs: 5,
    now: () => 0,
    ...overrides,
  }
}

/** Adapter completo, del tipo que devolvería un Chrome de escritorio sano. */
function healthyAdapter(overrides: Record<string, unknown> = {}) {
  return {
    info: { vendor: 'apple', architecture: 'common-3', device: '', description: '' },
    features: new Set(['shader-f16', 'timestamp-query']),
    limits: { maxBufferSize: 4294967296, maxStorageBufferBindingSize: 2147483644, noEsUnNumero: 'x' },
    requestDevice: () => Promise.resolve({ lost: new Promise<never>(() => {}), destroy: () => {} }),
    ...overrides,
  }
}

describe('probeGpu', () => {
  it('sin navigator.gpu: `unsupported` en los dos pasos, sin inventar un error', async () => {
    const probe = await probeGpu(env(undefined))
    expect(probe.hasNavigatorGpu).toBe(false)
    expect(probe.adapter).toBe('unsupported')
    expect(probe.device).toBe('unsupported')
    expect(probe.adapterError).toBeUndefined()
  })

  it('adapter null ≠ adapter que lanza: son dos diagnósticos distintos', async () => {
    const nullAdapter = await probeGpu(env({ requestAdapter: () => Promise.resolve(null) }))
    expect(nullAdapter.adapter).toBe('null')
    expect(nullAdapter.adapterError).toContain('devolvió null')

    const throwing = await probeGpu(
      env({
        requestAdapter: () => Promise.reject(new TypeError('sin backend')),
      }),
    )
    expect(throwing.adapter).toBe('error')
    expect(throwing.adapterError).toBe('TypeError: sin backend')
  })

  it('un requestAdapter que nunca resuelve se reporta como timeout, no cuelga la pantalla', async () => {
    const probe = await probeGpu(env({ requestAdapter: () => new Promise(() => {}) }))
    expect(probe.adapter).toBe('timeout')
    expect(probe.adapterError).toContain('no resolvió')
  })

  it('camino sano: recoge info, features y SÓLO los límites numéricos conocidos', async () => {
    const probe = await probeGpu(env({ requestAdapter: () => Promise.resolve(healthyAdapter()) }))
    expect(probe.adapter).toBe('ok')
    expect(probe.device).toBe('ok')
    expect(probe.deviceLost).toBeUndefined()
    expect(probe.adapterInfo).toEqual({ vendor: 'apple', architecture: 'common-3', device: '', description: '' })
    // Ordenadas, para que dos volcados de dispositivos distintos se puedan comparar línea a línea.
    expect(probe.features).toEqual(['shader-f16', 'timestamp-query'])
    expect(probe.limits).toEqual({ maxBufferSize: 4294967296, maxStorageBufferBindingSize: 2147483644 })
  })

  it('EL modo de fallo que el gate deja pasar: adapter sí, device no', async () => {
    const probe = await probeGpu(
      env({
        requestAdapter: () =>
          Promise.resolve(
            healthyAdapter({
              requestDevice: () => Promise.reject(new Error('límites insuficientes')),
            }),
          ),
      }),
    )
    expect(probe.adapter).toBe('ok')
    expect(probe.device).toBe('error')
    expect(probe.deviceError).toBe('Error: límites insuficientes')
  })

  it('un device que se pierde solo queda registrado (el fallo "device lost" de Safari 26)', async () => {
    const probe = await probeGpu(
      env({
        requestAdapter: () =>
          Promise.resolve(
            healthyAdapter({
              requestDevice: () =>
                Promise.resolve({
                  lost: Promise.resolve({ reason: 'unknown', message: 'GPUDevice was lost' }),
                  destroy: () => {},
                }),
            }),
          ),
      }),
    )
    expect(probe.device).toBe('ok')
    expect(probe.deviceLost).toBe('unknown: GPUDevice was lost')
  })

  it('destruye el device DESPUÉS de la gracia, para no reportarse a sí mismo como pérdida', async () => {
    const destroy = vi.fn()
    let lostResolve: ((value: { reason: string; message: string }) => void) | undefined
    const lost = new Promise<{ reason: string; message: string }>((resolve) => {
      lostResolve = resolve
    })
    const probe = await probeGpu(
      env({
        requestAdapter: () =>
          Promise.resolve(
            healthyAdapter({
              requestDevice: () =>
                Promise.resolve({
                  lost,
                  destroy: () => {
                    destroy()
                    // Un `destroy()` real resuelve `lost`; si el sondeo lo esperara después, se
                    // reportaría su propia limpieza como el síntoma que está buscando.
                    lostResolve?.({ reason: 'destroyed', message: 'destroy()' })
                  },
                }),
            }),
          ),
      }),
    )
    expect(destroy).toHaveBeenCalledOnce()
    expect(probe.deviceLost).toBeUndefined()
  })

  it('un adapter sin requestDevice no es un crash, es un dato', async () => {
    const probe = await probeGpu(
      env({ requestAdapter: () => Promise.resolve({ info: { vendor: 'x' } }) }),
    )
    expect(probe.adapter).toBe('ok')
    expect(probe.device).toBe('unsupported')
    expect(probe.deviceError).toContain('requestDevice')
  })

  it('el scope y el aislamiento viajan tal como se los pasa: main y worker pueden discrepar', async () => {
    const probe = await probeGpu(
      env({ requestAdapter: () => Promise.resolve(healthyAdapter()) }, { scope: 'worker', crossOriginIsolated: false }),
    )
    expect(probe.scope).toBe('worker')
    expect(probe.crossOriginIsolated).toBe(false)
  })
})
