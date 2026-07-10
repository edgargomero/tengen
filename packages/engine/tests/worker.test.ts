import { describe, expect, it } from 'vitest'
import { LocalEngine } from '../src/engine'
import { WorkerEngine, type WorkerLike } from '../src/worker/client'
import { createWorkerHandler, type PostFn } from '../src/worker/handler'
import type { WorkerRequest } from '../src/worker/protocol'
import type { NNEvaluator, RawEval } from '../src/nn/evaluator'
import type { Analysis, BoardSize, NetworkId, Position } from '../src/types'

// Round-trip end-to-end del Web Worker SIN Worker real: un canal MOCK en Node conecta un
// `WorkerEngine` (hilo principal) con un `createWorkerHandler(new LocalEngine(mock))` (hilo del
// worker). Es la ÚNICA cobertura de client.ts + engine.worker.ts (archivo extra respecto al `Files`
// del plan, pedido por el texto del usuario "round-trip init→genMove"). NO carga ONNX ni Worker real.

// Mock kata inline (patrón de tests/mcts.test.ts / tests/engine.test.ts): policy con un pico en el
// centro (produce mejor jugada NO-pase con ≥100 visitas). CEDE un macrotask por evaluación: sin esto,
// con un canal de microtasks, un `analyze` de larga duración monopolizaría la cola de microtasks y
// completaría antes de que el test pudiera cancelarlo en vuelo (no probaría el bypass de `stop`).
function makeMock(N: number): NNEvaluator {
  const area = N * N
  const favorite = ((N / 2) | 0) * N + ((N / 2) | 0) // centro
  return {
    boardSize: N,
    hasMeta: false,
    async evaluate({ batch }): Promise<RawEval> {
      await new Promise((r) => setTimeout(r, 0)) // cede al event loop → analyze interrumpible
      const policy = new Float32Array(batch * area)
      const policyPass = new Float32Array(batch)
      const value = new Float32Array(batch * 3)
      const scoreValue = new Float32Array(batch * 4)
      for (let b = 0; b < batch; b++) {
        for (let i = 0; i < area; i++) policy[b * area + i] = i === favorite ? 3 : 0
        policyPass[b] = -5
        value[b * 3 + 0] = 0.2
        value[b * 3 + 1] = -0.2
        value[b * 3 + 2] = -50 // noResult ≈ 0
      }
      return { policy, policyPass, value, scoreValue }
    },
  }
}

const EMPTY_9: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }

// Canal mock bidireccional: `postMessage` (cliente→worker) entrega al handler; el `post` del handler
// (worker→cliente) entrega al listener del cliente. Ambas direcciones son asíncronas (microtask) para
// imitar el boundary del Worker sin acoplar el orden síncrono.
function connect(
  evaluatorFactory: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>,
): WorkerEngine {
  const listeners: Array<(ev: { data: unknown }) => void> = []
  const post: PostFn = (msg) => {
    queueMicrotask(() => {
      for (const l of listeners) l({ data: msg })
    })
  }
  const engine = new LocalEngine({ evaluatorFactory })
  const handle = createWorkerHandler(engine, post)
  const workerLike: WorkerLike = {
    postMessage(message) {
      queueMicrotask(() => handle(message as WorkerRequest))
    },
    addEventListener(_type, cb) {
      listeners.push(cb)
    },
  }
  return new WorkerEngine(workerLike)
}

const until = async (pred: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until: timeout esperando la condición')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('WorkerEngine round-trip (canal mock, sin Worker real)', () => {
  it('init → genMove devuelve una jugada legal en perspectiva de Negro', async () => {
    const we = connect(async (_n, N) => makeMock(N))
    await we.init({ network: 'b18', boardSize: 9 }) // resuelve sólo si llegó 'ready'
    const move = await we.genMove(EMPTY_9, { level: { kind: 'kata', visits: 100 } })
    expect(move.color).toBe('black')
    expect(move.vertex).not.toBe('pass')
  })

  it('analyze emite ≥1 update y la CancelFn lo corta saltando la cola (sin bypass: deadlock)', async () => {
    const we = connect(async (_n, N) => makeMock(N))
    await we.init({ network: 'b18', boardSize: 9 })

    const updates: Analysis[] = []
    // visits enorme: el analyze NO completa por sí solo → bloquea la cola serial hasta cancelarse.
    const cancel = we.analyze(EMPTY_9, { visits: 100_000 }, (a) => updates.push(a))
    await until(() => updates.length >= 1) // confirma que streamea y sigue en vuelo

    // Con el analyze en vuelo, `init` de abajo queda ENCOLADO detrás. Sólo el BYPASS de `stop` (fuera
    // de la cola) permite que la CancelFn resuelva la entrada del analyze y drene la cola. Sin él, el
    // `init` colgaría (deadlock) → timeout del test.
    cancel()
    await we.init({ network: 'b18', boardSize: 9 }) // resuelve sólo si la cola drenó tras el bypass
    expect(updates.length).toBeGreaterThan(0)
  })

  it('stop() también corta un analyze en vuelo y libera la cola', async () => {
    const we = connect(async (_n, N) => makeMock(N))
    await we.init({ network: 'b18', boardSize: 9 })

    const updates: Analysis[] = []
    we.analyze(EMPTY_9, { visits: 100_000 }, (a) => updates.push(a))
    await until(() => updates.length >= 1)

    we.stop()
    await we.init({ network: 'b18', boardSize: 9 }) // drena sólo si stop() disparó el bypass
    expect(updates.length).toBeGreaterThan(0)
  })

  it('propaga un error del engine como rechazo de la promesa (genMove sin init)', async () => {
    const we = connect(async (_n, N) => makeMock(N))
    // Sin init previo: LocalEngine.genMove lanza; el Worker lo traduce a 'error' y el cliente rechaza.
    await expect(
      we.genMove(EMPTY_9, { level: { kind: 'kata', visits: 10 } }),
    ).rejects.toThrow(/init/)
  })
})
