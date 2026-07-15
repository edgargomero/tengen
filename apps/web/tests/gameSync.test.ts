// Fase 5 Task 5: motor de guardado a la nube. `fetch` y los timers (`schedule`/`cancel`) van
// inyectados — nunca se toca el `fetch` global ni `setTimeout` real, así que los tests de retry
// son deterministas (se dispara el retry a mano, no se espera tiempo real).
import { describe, expect, it } from 'vitest'
import type { FetchLike, GameSnapshot } from '../src/cloud/api'
import { GameSync, type SyncStatus } from '../src/cloud/gameSync'

const SNAPSHOT: GameSnapshot = { name: 'partida', sgf: '(;GM[1])', boardSize: 9, mode: 'jugar' }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Cola FIFO de handlers síncronos envueltos en una promesa async (simula fetch real: async pero
 * sin awaits reales de I/O). Cada `save()`/`finish()` consume el siguiente handler en orden. */
function makeFetchQueue() {
  const handlers: Array<() => Response> = []
  const calls: Array<{ input: string; init?: RequestInit }> = []
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ input, init })
    const handler = handlers.shift()
    if (!handler) throw new Error(`fetch inesperado sin handler encolado: ${input}`)
    return handler()
  }
  return {
    fetchImpl,
    calls,
    push: (handler: () => Response) => handlers.push(handler),
  }
}

/** Fetch con resolución DIFERIDA (para simular "un request en vuelo" en el test de coalescing). */
function makeDeferredFetchQueue() {
  const calls: Array<{ input: string; init?: RequestInit }> = []
  const deferred: Array<(r: Response) => void> = []
  const fetchImpl: FetchLike = (input, init) => {
    calls.push({ input, init })
    return new Promise<Response>((resolve) => deferred.push(resolve))
  }
  return { fetchImpl, calls, deferred }
}

/** Scheduler fake: captura los retries programados sin usar timers reales; `fire` dispara uno a
 * mano (simula que pasó el backoff). */
function makeFakeScheduler() {
  let nextHandle = 0
  const pending = new Map<number, () => void>()
  const scheduled: { handle: number; delayMs: number }[] = []
  return {
    schedule: (fn: () => void, delayMs: number): unknown => {
      const handle = ++nextHandle
      pending.set(handle, fn)
      scheduled.push({ handle, delayMs })
      return handle
    },
    cancel: (handle: unknown): void => {
      pending.delete(handle as number)
    },
    fire: (handle: unknown): void => {
      const fn = pending.get(handle as number)
      pending.delete(handle as number)
      fn?.()
    },
    scheduled,
  }
}

/** Deja correr la microtask queue lo suficiente para que una cadena async/await de unos pocos
 * niveles (fetch → ensureOk → res.json() → continuación de flush) termine de resolver. */
async function tick(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

describe('GameSync — POST inicial / PUT posterior', () => {
  it('sin gameId hace POST y captura el id devuelto', async () => {
    const q = makeFetchQueue()
    q.push(() => jsonResponse(201, { id: 'game-1' }))
    const statuses: SyncStatus[] = []
    let capturedId: string | undefined
    const sync = new GameSync({
      fetchImpl: q.fetchImpl,
      onStatus: (s) => statuses.push(s),
      onGameId: (id) => (capturedId = id),
    })

    sync.save(SNAPSHOT)
    await tick()

    expect(capturedId).toBe('game-1')
    expect(sync.gameId).toBe('game-1')
    expect(q.calls).toHaveLength(1)
    expect(q.calls[0]!.input).toBe('/api/games')
    expect(q.calls[0]!.init?.method).toBe('POST')
    expect(statuses).toEqual(['saving', 'saved'])
  })

  it('con gameId (partida reabierta) hace PUT desde el primer save', async () => {
    const q = makeFetchQueue()
    q.push(() => jsonResponse(200, { ok: true }))
    const sync = new GameSync({ initialGameId: 'game-existente', fetchImpl: q.fetchImpl })

    sync.save(SNAPSHOT)
    await tick()

    expect(q.calls).toHaveLength(1)
    expect(q.calls[0]!.input).toBe('/api/games/game-existente')
    expect(q.calls[0]!.init?.method).toBe('PUT')
    expect(sync.gameId).toBe('game-existente') // no lo pisa un id nuevo
  })

  it('un segundo save tras completar el primero (ya con id) hace PUT, no otro POST', async () => {
    const q = makeFetchQueue()
    q.push(() => jsonResponse(201, { id: 'game-2' }))
    q.push(() => jsonResponse(200, { ok: true }))
    const sync = new GameSync({ fetchImpl: q.fetchImpl })

    sync.save(SNAPSHOT)
    await tick()
    sync.save({ ...SNAPSHOT, sgf: '(;GM[1];B[ee])' })
    await tick()

    expect(q.calls).toHaveLength(2)
    expect(q.calls[1]!.init?.method).toBe('PUT')
    expect(q.calls[1]!.input).toBe('/api/games/game-2')
  })
})

describe('GameSync — coalescing última-gana', () => {
  it('un save durante un request en vuelo NO dispara un segundo fetch inmediato; se flushea al terminar', async () => {
    const q = makeDeferredFetchQueue()
    const sync = new GameSync({ fetchImpl: q.fetchImpl })

    sync.save(SNAPSHOT) // dispara el POST, queda "en vuelo" (la promesa no resolvió)
    await tick()
    expect(q.calls).toHaveLength(1)

    sync.save({ ...SNAPSHOT, sgf: '(;GM[1];B[ee])' }) // llega mientras el POST vuela
    await tick()
    expect(q.calls).toHaveLength(1) // NO un segundo POST — evita la fila duplicada

    q.deferred[0]!(jsonResponse(201, { id: 'game-3' })) // resuelve el POST
    await tick()

    // el snapshot más nuevo se manda ahora, como PUT (ya hay id) — última-gana, un solo POST total.
    expect(q.calls).toHaveLength(2)
    expect(q.calls[1]!.init?.method).toBe('PUT')
    expect(q.calls[1]!.input).toBe('/api/games/game-3')
    expect(q.calls[1]!.init?.body).toContain('B[ee]')
  })
})

describe('GameSync — retry con backoff', () => {
  it('un fallo programa un retry a 2s, luego 5s; el tercer intento puede tener éxito', async () => {
    const q = makeFetchQueue()
    q.push(() => jsonResponse(500, {}))
    const sched = makeFakeScheduler()
    const statuses: SyncStatus[] = []
    const sync = new GameSync({
      fetchImpl: q.fetchImpl,
      schedule: sched.schedule,
      cancel: sched.cancel,
      onStatus: (s) => statuses.push(s),
    })

    sync.save(SNAPSHOT)
    await tick()
    expect(statuses).toEqual(['saving', 'error'])
    expect(sched.scheduled).toEqual([{ handle: 1, delayMs: 2000 }])

    q.push(() => jsonResponse(500, {}))
    sched.fire(1)
    await tick()
    expect(q.calls).toHaveLength(2)
    expect(sched.scheduled).toHaveLength(2)
    expect(sched.scheduled[1]).toEqual({ handle: 2, delayMs: 5000 })

    q.push(() => jsonResponse(201, { id: 'game-4' }))
    sched.fire(2)
    await tick()
    expect(sync.gameId).toBe('game-4')
    expect(statuses.at(-1)).toBe('saved')
  })

  it('retryNow() cancela el backoff pendiente y reintenta de inmediato', async () => {
    const q = makeFetchQueue()
    q.push(() => jsonResponse(500, {}))
    const sched = makeFakeScheduler()
    const sync = new GameSync({ fetchImpl: q.fetchImpl, schedule: sched.schedule, cancel: sched.cancel })

    sync.save(SNAPSHOT)
    await tick()
    expect(sched.scheduled).toHaveLength(1)

    q.push(() => jsonResponse(201, { id: 'game-5' }))
    sync.retryNow()
    await tick()

    expect(sync.gameId).toBe('game-5')
    expect(q.calls).toHaveLength(2)
  })

  it('un fetch que RECHAZA (error de red, no solo !ok) tampoco se propaga fuera de save()', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('network down')
    }
    const statuses: SyncStatus[] = []
    const sync = new GameSync({ fetchImpl, onStatus: (s) => statuses.push(s) })

    expect(() => sync.save(SNAPSHOT)).not.toThrow()
    await tick()
    expect(statuses.at(-1)).toBe('error')
  })
})

describe('GameSync — finish() / backup a Drive', () => {
  it('sin gameId (nunca se guardó nada) finish() no dispara ningún request', async () => {
    const q = makeFetchQueue()
    const sync = new GameSync({ fetchImpl: q.fetchImpl })

    sync.finish()
    await tick()

    expect(q.calls).toHaveLength(0)
  })

  it('dispara el backup recién cuando el último save llegó a D1 (no antes, no en paralelo)', async () => {
    const q = makeFetchQueue()
    q.push(() => jsonResponse(201, { id: 'game-6' })) // POST del save
    q.push(() => jsonResponse(200, { driveFileId: 'drive-1' })) // drive-backup
    const sync = new GameSync({ fetchImpl: q.fetchImpl })

    sync.save(SNAPSHOT)
    sync.finish() // llega MIENTRAS el POST todavía no resolvió (mismo tick síncrono)
    await tick()

    expect(q.calls).toHaveLength(2)
    expect(q.calls[0]!.input).toBe('/api/games')
    expect(q.calls[1]!.input).toBe('/api/games/game-6/drive-backup')
    expect(q.calls[1]!.init?.method).toBe('POST')
  })

  it('un fallo del backup a Drive es silencioso (best-effort, no reintenta, no lanza)', async () => {
    const q = makeFetchQueue()
    q.push(() => jsonResponse(201, { id: 'game-7' }))
    q.push(() => jsonResponse(502, {}))
    const statuses: SyncStatus[] = []
    const sync = new GameSync({ fetchImpl: q.fetchImpl, onStatus: (s) => statuses.push(s) })

    sync.save(SNAPSHOT)
    sync.finish()
    await tick()

    expect(q.calls).toHaveLength(2)
    expect(statuses.at(-1)).toBe('saved') // el fallo de Drive no pisa el estado del save (que sí tuvo éxito)
  })
})

describe('GameSync — dispose', () => {
  it('tras dispose(), save() no dispara más requests ni notifica estado', async () => {
    const q = makeFetchQueue()
    const statuses: SyncStatus[] = []
    const sync = new GameSync({ fetchImpl: q.fetchImpl, onStatus: (s) => statuses.push(s) })

    sync.dispose()
    sync.save(SNAPSHOT)
    await tick()

    expect(q.calls).toHaveLength(0)
    expect(statuses).toHaveLength(0)
  })
})
