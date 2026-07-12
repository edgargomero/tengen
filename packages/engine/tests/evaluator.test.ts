import { describe, expect, it } from 'vitest'
import type * as ort from 'onnxruntime-web'
import { OnnxEvaluator } from '../src/nn/evaluator'

/** Sesión ORT fake que replica la guarda real de onnxruntime-web: un solo `run()` en vuelo por
 *  instancia — un segundo `run()` mientras el primero no resolvió tira `Error('Session already
 *  started')` (comportamiento verificado leyendo `node_modules/onnxruntime-web/dist/ort.all.bundle.min.mjs`,
 *  guarda `e.Yc`; ver evaluator.ts). `runDelayMs` simula el tiempo real de inferencia para abrir una
 *  ventana de solapamiento entre dos `evaluate()` concurrentes contra la MISMA instancia. */
function makeGuardedFakeSession(runDelayMs: number): ort.InferenceSession {
  let running = false
  return {
    inputNames: ['bin', 'global'],
    outputNames: ['policy', 'value', 'miscvalue'],
    async run(): Promise<Record<string, ort.Tensor>> {
      if (running) throw new Error('Session already started')
      running = true
      await new Promise((resolve) => setTimeout(resolve, runDelayMs))
      running = false
      return {
        policy: { type: 'float32', dims: [1, 1, 2], data: new Float32Array([0, 0]) } as unknown as ort.Tensor,
        value: { type: 'float32', dims: [1, 3], data: new Float32Array(3) } as unknown as ort.Tensor,
        miscvalue: { type: 'float32', dims: [1, 10], data: new Float32Array(10) } as unknown as ort.Tensor,
      }
    },
  } as unknown as ort.InferenceSession
}

function makeEvaluator(session: ort.InferenceSession): OnnxEvaluator {
  return new OnnxEvaluator({
    session,
    boardSize: 1,
    dtype: 'float32',
    inputNames: { bin: 'bin', global: 'global' },
    outputNames: { policy: 'policy', value: 'value', miscvalue: 'miscvalue' },
  })
}

function evalArgs() {
  return { bin: new Float32Array(22), global: new Float32Array(19), meta: null, batch: 1, includeOwnership: false }
}

describe('OnnxEvaluator — serialización de session.run()', () => {
  it('dos evaluate() concurrentes contra la misma sesión no chocan con "Session already started"', async () => {
    const evaluator = makeEvaluator(makeGuardedFakeSession(10))

    const results = await Promise.all([evaluator.evaluate(evalArgs()), evaluator.evaluate(evalArgs())])

    expect(results[0]!.policy).toBeInstanceOf(Float32Array)
    expect(results[1]!.policy).toBeInstanceOf(Float32Array)
  })

  it('si el primer evaluate() falla, el segundo igual corre (la cola no queda envenenada)', async () => {
    let calls = 0
    let running = false
    const session = {
      inputNames: ['bin', 'global'],
      outputNames: ['policy', 'value', 'miscvalue'],
      async run(): Promise<Record<string, ort.Tensor>> {
        calls++
        if (running) throw new Error('Session already started')
        running = true
        await new Promise((resolve) => setTimeout(resolve, 5))
        running = false
        if (calls === 1) throw new Error('fallo simulado del primer run')
        return {
          policy: { type: 'float32', dims: [1, 1, 2], data: new Float32Array([0, 0]) } as unknown as ort.Tensor,
          value: { type: 'float32', dims: [1, 3], data: new Float32Array(3) } as unknown as ort.Tensor,
          miscvalue: { type: 'float32', dims: [1, 10], data: new Float32Array(10) } as unknown as ort.Tensor,
        }
      },
    } as unknown as ort.InferenceSession
    const evaluator = makeEvaluator(session)

    const first = evaluator.evaluate(evalArgs())
    const second = evaluator.evaluate(evalArgs())

    await expect(first).rejects.toThrow('fallo simulado del primer run')
    await expect(second).resolves.toMatchObject({})
  })
})
