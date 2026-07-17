import { describe, expect, it } from 'vitest'
import { LocalEngine } from '../src/engine'
import { WorkerEngine, type WorkerLike } from '../src/worker/client'
import { createWorkerHandler, type PostFn } from '../src/worker/handler'
import type { WorkerRequest, WorkerResponse } from '../src/worker/protocol'
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

  it('genMove con reloj: el round-trip no rompe y devuelve una jugada legal', async () => {
    const we = connect(async (_n, N) => makeMock(N))
    await we.init({ network: 'b18', boardSize: 9 })
    const clock = {
      config: { mainTimeMs: 60_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 },
      state: { mainTimeRemainingMs: 60_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
    }
    const move = await we.genMove(EMPTY_9, { level: { kind: 'kata', visits: 100 }, clock })
    expect(move.color).toBe('black')
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

  it('cancelar un analyze encolado detrás NO afecta al analyze en curso (cancelación por-id)', async () => {
    // El brief describe el escenario como "cancelar el primero (en curso), verificar que el segundo
    // (en cola) completa". Esa dirección NO discrimina: `LocalEngine.analyze` resetea su flag de
    // cancelación al entrar, así que apenas arranca el segundo (en cola) el propio reset "des-cancela"
    // al primero por accidente — pasa igual con el flag único viejo que con el fix. La dirección que sí
    // discrimina es la inversa: cancelar el SEGUNDO (encolado, aún no arrancado) y verificar que el
    // PRIMERO (en curso) sigue intacto. Confirmado empíricamente contra el código pre-fix (ver reporte).
    //
    // Además, el registro `WorkerEngine.analyzers` se borra localmente al cancelar (en AMBOS diseños),
    // así que `onUpdate` de B nunca ver nada pase lo que pase en el Worker — no sirve como testigo. Se
    // intercepta el canal CRUDO worker→cliente (verdad de terreno) para comprobar si el `engine.analyze`
    // real de B llegó a invocarse o no.
    const rawLog: WorkerResponse[] = []
    const listeners: Array<(ev: { data: unknown }) => void> = []
    const post: PostFn = (msg) => {
      rawLog.push(msg)
      queueMicrotask(() => {
        for (const l of listeners) l({ data: msg })
      })
    }
    const engine = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N) })
    const handle = createWorkerHandler(engine, post)
    const workerLike: WorkerLike = {
      postMessage(message) {
        queueMicrotask(() => handle(message as WorkerRequest))
      },
      addEventListener(_type, cb) {
        listeners.push(cb)
      },
    }
    const we = new WorkerEngine(workerLike)

    await we.init({ network: 'b18', boardSize: 9 }) // id=1

    const POS_B: Position = {
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      moves: [{ color: 'black', vertex: { x: 4, y: 4 } }],
    }

    const updatesA: Analysis[] = []
    // A con visits ENORME: nunca completa por sí solo → queda "en curso" de forma estable (mismo
    // patrón que el test de arriba), sin depender de ganar una carrera contra el reloj.
    const cancelA = we.analyze(EMPTY_9, { visits: 100_000 }, (a) => updatesA.push(a)) // id=2
    await until(() => updatesA.length >= 1) // A arrancó y ocupa la cola serial (en curso, indefinido)

    // B se postea DETRÁS de A (id=3): la cola FIFO no invoca su `engine.analyze` real hasta que A
    // libere la cola, así que en este instante B está encolado pero NO arrancado.
    const cancelB = we.analyze(POS_B, { visits: 200 }, () => {}) // id=3
    cancelB() // cancela SOLO B (targetId). Con el flag único viejo esto cancelaba a A (el activo).

    const updatesABeforeCancelB = updatesA.length
    // A debe SEGUIR emitiendo updates después de cancelar B (sanity check; no discrimina por sí solo,
    // ver nota arriba — el discriminante real es `rawLog` más abajo).
    await until(() => updatesA.length > updatesABeforeCancelB)

    cancelA() // cancelación explícita de A (nunca completa por sí solo)
    await we.init({ network: 'b18', boardSize: 9 }) // drena la cola: nada quedó colgado

    // Verdad de terreno: el `engine.analyze` REAL de B nunca se invocó (nunca posteó ninguna
    // `analysis` con su propio id) — quedó pre-cancelado en la cola, jamás arrancó.
    expect(rawLog.some((m) => m.type === 'analysis' && m.id === 3)).toBe(false)
  })

  it('cancelar el analyze en curso deja que el siguiente en cola complete normalmente', async () => {
    // Escenario positivo del brief ("verificar que el [otro] llega a completarse normalmente"): cancelar
    // la operación ACTIVA (A) libera la cola de inmediato y deja que la encolada detrás (B, con visits
    // FINITAS) arranque y complete hasta su `final:true` sin verse afectada por la cancelación de A.
    const we = connect(async (_n, N) => makeMock(N))
    await we.init({ network: 'b18', boardSize: 9 })

    const POS_B: Position = {
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      moves: [{ color: 'black', vertex: { x: 4, y: 4 } }],
    }

    const updatesA: Analysis[] = []
    const updatesB: Analysis[] = []
    const cancelA = we.analyze(EMPTY_9, { visits: 100_000 }, (a) => updatesA.push(a))
    await until(() => updatesA.length >= 1) // A en curso, ocupa la cola

    we.analyze(POS_B, { visits: 100 }, (a) => updatesB.push(a)) // B encolado detrás, visits FINITAS
    cancelA() // cancela A (el activo): libera la cola para que B arranque

    await until(() => updatesB.some((a) => a.visits >= 100)) // B completa normalmente hasta su target
  })

  it('propaga un error del engine al `onError` de un analyze (analyze sin init)', async () => {
    // Cobertura dedicada de M-2 (canal de error público): a diferencia de genMove (que rechaza una
    // promesa), un `analyze` fallido debe llegar por el 4º parámetro `onError`, no perderse en silencio.
    const we = connect(async (_n, N) => makeMock(N))
    // Sin init previo: LocalEngine.analyze lanza dentro de su try/catch (requireInit) → el Worker lo
    // traduce a un mensaje 'error' → el cliente invoca `onError` de esta llamada específica.
    const updates: Analysis[] = []
    const errors: unknown[] = []
    we.analyze(EMPTY_9, { visits: 10 }, (a) => updates.push(a), (e) => errors.push(e))
    await until(() => errors.length >= 1)
    expect(updates.length).toBe(0)
    expect(errors[0]).toBeInstanceOf(Error)
    expect((errors[0] as Error).message).toMatch(/init/)
  })

  it('propaga un error del engine como rechazo de la promesa (genMove sin init)', async () => {
    const we = connect(async (_n, N) => makeMock(N))
    // Sin init previo: LocalEngine.genMove lanza; el Worker lo traduce a 'error' y el cliente rechaza.
    await expect(
      we.genMove(EMPTY_9, { level: { kind: 'kata', visits: 10 } }),
    ).rejects.toThrow(/init/)
  })
})
