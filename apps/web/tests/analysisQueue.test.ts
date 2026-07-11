import { describe, expect, it } from 'vitest'
import {
  AnalysisQueue,
  AnalysisQueueCanceledError,
  AnalysisQueueStaleError,
} from '../src/analysis/vendor/web-katrain/analysisQueue'

// ─────────────────────────────────────────────────────────────────────────────
// El port es verbatim (ver cabecera del archivo + adaptaciones-upstream.md): no
// re-testeamos exhaustivamente la mecánica del vendor. Cubrimos solo los 4 puntos
// que `reviewScheduler.ts` (Task 6, Parte 2) necesita que se comporten como
// documenta el brief: prioridad+orden de llegada, `preempt`, `staleKey` (solo
// pendientes) y `cancelGroup` (pending+active). Sin timers reales: los jobs de
// prueba se controlan con promesas "deferred" propias.
// ─────────────────────────────────────────────────────────────────────────────

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AnalysisQueue.enqueue', () => {
  it('respeta prioridad + orden de llegada entre jobs pendientes (serial: uno activo a la vez)', async () => {
    const queue = new AnalysisQueue()
    const order: string[] = []
    const first = deferred<string>()

    // Ocupa el único slot activo con un job controlado manualmente (nunca completa por sí solo).
    const pA = queue.enqueue({
      group: 'g',
      priority: 1,
      run: async () => {
        order.push('A')
        return first.promise
      },
    })

    // Estos tres quedan PENDIENTES (A sigue activo): deben correr en orden prioridad desc,
    // empate → orden de llegada (sequence asc).
    const pB = queue.enqueue({ group: 'g', priority: 1, run: async () => (order.push('B'), 'b') })
    const pC = queue.enqueue({ group: 'g', priority: 5, run: async () => (order.push('C'), 'c') })
    const pD = queue.enqueue({ group: 'g', priority: 5, run: async () => (order.push('D'), 'd') })

    first.resolve('a')
    await Promise.all([pA, pB, pC, pD])

    expect(order).toEqual(['A', 'C', 'D', 'B'])
  })
})

describe('AnalysisQueue preempt', () => {
  it('cancela un job activo de prioridad igual o menor y arranca el nuevo YA', async () => {
    const queue = new AnalysisQueue()
    const active = deferred<string>()
    let abortedSeen = false
    const started: string[] = []

    const pActive = queue.enqueue({
      group: 'g',
      priority: 20,
      run: (ctx) => {
        ctx.signal.addAbortListener(() => {
          abortedSeen = true
          active.resolve('leftover, discarded by the queue')
        })
        return active.promise
      },
    })

    const pPreempt = queue.enqueue({
      group: 'g',
      priority: 20, // empate: preempt igual debe cancelar (comparación <=)
      preempt: true,
      run: async () => {
        started.push('preempt')
        return 'preempt-result'
      },
    })

    // El preempt es síncrono: para cuando enqueue() del segundo job retorna, ya abortó al primero
    // y arrancó el segundo (no espera un tick de microtask).
    expect(abortedSeen).toBe(true)
    expect(started).toEqual(['preempt'])

    await expect(pActive).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    await expect(pPreempt).resolves.toBe('preempt-result')
  })
})

describe('AnalysisQueue staleKey', () => {
  it('cancela solo jobs PENDIENTES con la misma clave; un job ACTIVO no se aborta de inmediato', async () => {
    const queue = new AnalysisQueue()
    const active = deferred<string>()
    let activeAborted = false

    const pActive = queue.enqueue({
      group: 'g',
      priority: 1,
      staleKey: 'pos-1',
      run: (ctx) => {
        ctx.signal.addAbortListener(() => {
          activeAborted = true
        })
        return active.promise
      },
    })

    const pPendingOld = queue.enqueue({
      group: 'g',
      priority: 1,
      staleKey: 'pos-1',
      run: async () => 'old-pending',
    })
    const pPendingNew = queue.enqueue({
      group: 'g',
      priority: 1,
      staleKey: 'pos-1',
      run: async () => 'new-pending',
    })

    // El pendiente viejo con la misma staleKey se cancela como "stale"; el activo NO se aborta
    // (staleKey solo actúa sobre `pending`, ver mecánica documentada en la cabecera del vendor).
    await expect(pPendingOld).rejects.toBeInstanceOf(AnalysisQueueStaleError)
    expect(activeAborted).toBe(false)

    // Consecuencia documentada: aunque no se abortó, cuando el activo SÍ resuelve por su cuenta, la
    // cola revisa `isStale()` en ese momento (ya se hicieron 2 supersedes desde que arrancó) y
    // descarta el resultado con AnalysisQueueStaleError en vez de resolver con él.
    active.resolve('active-result, but stale by the time it resolves')
    await expect(pActive).rejects.toBeInstanceOf(AnalysisQueueStaleError)

    await expect(pPendingNew).resolves.toBe('new-pending')
  })
})

describe('AnalysisQueue.cancelGroup', () => {
  it('cancela pending+active del grupo pedido; no afecta otros grupos; libera pump() para el resto', async () => {
    const queue = new AnalysisQueue()
    const active = deferred<string>()
    let activeAborted = false

    const pActiveA = queue.enqueue({
      group: 'A',
      priority: 1,
      run: (ctx) => {
        ctx.signal.addAbortListener(() => {
          activeAborted = true
          active.resolve('discarded')
        })
        return active.promise
      },
    })
    const pPendingA = queue.enqueue({ group: 'A', priority: 1, run: async () => 'a-pending' })
    const pPendingB = queue.enqueue({ group: 'B', priority: 1, run: async () => 'b-pending' })

    const count = queue.cancelGroup('A')

    expect(count).toBe(2) // 1 activo + 1 pendiente de A; B no cuenta
    expect(activeAborted).toBe(true)
    await expect(pActiveA).rejects.toBeInstanceOf(AnalysisQueueCanceledError)
    await expect(pPendingA).rejects.toBeInstanceOf(AnalysisQueueCanceledError)

    // B nunca arrancó (A ocupaba el único slot activo); tras cancelar A, pump() debe arrancarlo solo.
    await expect(pPendingB).resolves.toBe('b-pending')
  })
})
