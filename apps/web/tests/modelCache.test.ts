import { describe, expect, it } from 'vitest'
import { ensureModel } from '../src/models/modelCache'
import { requireManifestEntry } from '../src/models/netManifest'
import type { DownloadProgress } from '../src/models/progress'
import type { ModelStore, WritableSink } from '../src/models/modelStore'

// ─────────────────────────────────────────────────────────────────────────────
// Nota de tamaño (CRÍTICA): NO materializamos el modelo real de 115 MB. `ensureModel`
// valida `received` contra `requireManifestEntry(net).bytes` (kata = 115_800_125), así
// que el stream de prueba DEBE sumar ese total exacto para el happy path. Para no retener
// >100 MB en RAM:
//   - el mock sink solo CUENTA longitudes de chunk (no retiene bytes);
//   - el mock store commitea la LONGITUD (Map<string, number>), no un Uint8Array;
//   - `streamOfTotal` es pull-based (un chunk por pull) → a lo sumo ~2 chunks vivos.
// Lo que se valida es la LÓGICA (orquestación, ruta de fallo, disciplina del marcador,
// progreso), no bytes reales. `readArrayBuffer` (ruta del worker, Task 4) no se ejercita aquí.
// ─────────────────────────────────────────────────────────────────────────────

/** Mock ModelStore en memoria con espías. `committed` guarda la LONGITUD, no los bytes. */
class MockModelStore implements ModelStore {
  /** name → byteLength commiteado (el archivo "virtual"). */
  readonly committed = new Map<string, number>()
  /** name → bytes marcados como completos. */
  readonly markers = new Map<string, number>()

  markCompleteCalls: Array<{ name: string; bytes: number }> = []
  openWritableCalls = 0
  abortCalls = 0
  closeCalls = 0
  /** Bytes totales que pasaron por `write` (para probar escritura parcial pre-abort). */
  bytesWritten = 0

  async isComplete(name: string, bytes: number): Promise<boolean> {
    // Marcador presente Y tamaño del archivo coincide (espeja la impl OPFS real).
    return this.markers.get(name) === bytes && this.committed.get(name) === bytes
  }

  async readArrayBuffer(_name: string): Promise<ArrayBuffer> {
    // No se ejercita en Task 2 (es la ruta del worker, Task 4). Lanza en vez de
    // asignar ~110 MB: si un refactor futuro enrutara ensureModel por aquí, falla ruidoso.
    throw new Error('mock: readArrayBuffer no ejercitado en Task 2')
  }

  async openWritable(name: string): Promise<WritableSink> {
    this.openWritableCalls++
    let written = 0
    return {
      write: async (chunk: Uint8Array): Promise<void> => {
        written += chunk.byteLength // cuenta; no retiene bytes
        this.bytesWritten += chunk.byteLength
      },
      close: async (): Promise<void> => {
        this.closeCalls++
        this.committed.set(name, written) // commit = longitud
      },
      abort: async (): Promise<void> => {
        this.abortCalls++ // descarta el parcial: NO commitea
      },
    }
  }

  async markComplete(name: string, bytes: number): Promise<void> {
    this.markCompleteCalls.push({ name, bytes })
    this.markers.set(name, bytes)
  }
}

/** Spy de fetchFn: registra URLs y sirve un Response construido por `makeResponse`. */
function makeFetchFn(makeResponse: () => Response): {
  fetchFn: (url: string) => Promise<Response>
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    fetchFn: async (url: string): Promise<Response> => {
      calls.push(url)
      return makeResponse()
    },
  }
}

/**
 * ReadableStream pull-based que emite exactamente `numChunks` chunks sumando `total`
 * bytes (un chunk por pull → RAM plana). Los chunks son ceros; el sink solo cuenta.
 */
function streamOfTotal(total: number, numChunks = 8): ReadableStream<Uint8Array> {
  const base = Math.floor(total / numChunks)
  let sent = 0
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      index++
      const size = index >= numChunks ? total - sent : base
      sent += size
      controller.enqueue(new Uint8Array(size))
      if (index >= numChunks) controller.close()
    },
  })
}

function okResponse(body: ReadableStream<Uint8Array>, contentLength: number | null): Response {
  const headers = new Headers()
  if (contentLength !== null) headers.set('content-length', String(contentLength))
  return new Response(body, { status: 200, headers })
}

const NET = 'b18' as const
const ENTRY = requireManifestEntry(NET)

describe('ensureModel', () => {
  it('happy path: streamea `bytes` en varios chunks → commit + markComplete; 2ª llamada no re-fetchea', async () => {
    const store = new MockModelStore()
    const { fetchFn, calls } = makeFetchFn(() => okResponse(streamOfTotal(ENTRY.bytes), ENTRY.bytes))

    await ensureModel(NET, store, fetchFn)

    // fetchFn llamado 1 vez con la sourceUrl exacta.
    expect(calls).toEqual([ENTRY.sourceUrl])
    // commit + marcador tras validar bytes.
    expect(store.closeCalls).toBe(1)
    expect(store.abortCalls).toBe(0)
    expect(store.markCompleteCalls).toEqual([{ name: ENTRY.opfsName, bytes: ENTRY.bytes }])
    expect(store.committed.get(ENTRY.opfsName)).toBe(ENTRY.bytes)
    expect(await store.isComplete(ENTRY.opfsName, ENTRY.bytes)).toBe(true)

    // 2ª llamada: isComplete true → NO se vuelve a llamar fetchFn (contador sigue en 1).
    await ensureModel(NET, store, fetchFn)
    expect(calls).toEqual([ENTRY.sourceUrl])
    expect(store.markCompleteCalls).toHaveLength(1)
  })

  it('fallo a mitad de stream: chunks escritos → abort, sin markComplete; 2ª llamada re-fetchea', async () => {
    const store = new MockModelStore()
    // Emite 2 chunks reales (leídos + escritos al sink) y luego revienta en un pull posterior.
    const makeStream = (): ReadableStream<Uint8Array> => {
      let pulls = 0
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls++
          if (pulls <= 2) {
            controller.enqueue(new Uint8Array(1000))
            return
          }
          controller.error(new Error('boom'))
        },
      })
    }
    const { fetchFn, calls } = makeFetchFn(() => okResponse(makeStream(), ENTRY.bytes))

    await expect(ensureModel(NET, store, fetchFn)).rejects.toThrow('boom')

    // Prueba que fue un fallo A MITAD (no inmediato): se escribieron 2 chunks reales al sink
    // ANTES de que reventara → exactamente la clase "datos parciales escritos → abortado → nada aceptado".
    expect(store.bytesWritten).toBe(2000)
    // Se escribieron chunks parciales pero NADA se aceptó: abort llamado, sin commit ni marcador.
    expect(store.openWritableCalls).toBe(1)
    expect(store.abortCalls).toBe(1)
    expect(store.closeCalls).toBe(0)
    expect(store.markCompleteCalls).toHaveLength(0)
    expect(store.committed.has(ENTRY.opfsName)).toBe(false)
    expect(await store.isComplete(ENTRY.opfsName, ENTRY.bytes)).toBe(false)

    // 2ª llamada re-descarga (fetchFn 1→2).
    await expect(ensureModel(NET, store, fetchFn)).rejects.toThrow('boom')
    expect(calls).toHaveLength(2)
  })

  it('byte mismatch (de menos): stream limpio pero total < bytes → rechaza, abort, sin markComplete; re-fetchea', async () => {
    const store = new MockModelStore()
    const { fetchFn, calls } = makeFetchFn(() => okResponse(streamOfTotal(ENTRY.bytes - 4096), ENTRY.bytes))

    await expect(ensureModel(NET, store, fetchFn)).rejects.toThrow()

    expect(store.abortCalls).toBe(1)
    expect(store.closeCalls).toBe(0)
    expect(store.markCompleteCalls).toHaveLength(0)
    expect(store.committed.has(ENTRY.opfsName)).toBe(false)
    expect(await store.isComplete(ENTRY.opfsName, ENTRY.bytes)).toBe(false)

    await expect(ensureModel(NET, store, fetchFn)).rejects.toThrow()
    expect(calls).toHaveLength(2)
  })

  it('byte mismatch (de más): stream limpio pero total > bytes → rechaza, abort, sin markComplete', async () => {
    const store = new MockModelStore()
    const { fetchFn } = makeFetchFn(() => okResponse(streamOfTotal(ENTRY.bytes + 4096), ENTRY.bytes))

    await expect(ensureModel(NET, store, fetchFn)).rejects.toThrow()

    expect(store.abortCalls).toBe(1)
    expect(store.markCompleteCalls).toHaveLength(0)
    expect(store.committed.has(ENTRY.opfsName)).toBe(false)
  })

  it('progreso monotónico: receivedBytes estrictamente creciente, último === bytes; percent no-decreciente y ≤ 100', async () => {
    const store = new MockModelStore()
    const { fetchFn } = makeFetchFn(() => okResponse(streamOfTotal(ENTRY.bytes), ENTRY.bytes))
    const events: DownloadProgress[] = []

    await ensureModel(NET, store, fetchFn, (p) => events.push(p))

    expect(events.length).toBeGreaterThan(0)
    // receivedBytes estrictamente creciente entre chunks.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.receivedBytes).toBeGreaterThan(events[i - 1]!.receivedBytes)
    }
    // último receivedBytes === bytes.
    expect(events.at(-1)!.receivedBytes).toBe(ENTRY.bytes)
    // percent (totalBytes no null) no-decreciente y ≤ 100; el último === 100.
    let prevPercent = -1
    for (const e of events) {
      expect(e.totalBytes).toBe(ENTRY.bytes)
      expect(e.percent).not.toBeNull()
      expect(e.percent!).toBeGreaterThanOrEqual(prevPercent)
      expect(e.percent!).toBeLessThanOrEqual(100)
      prevPercent = e.percent!
    }
    expect(events.at(-1)!.percent).toBe(100)
  })

  it('progreso sin Content-Length: totalBytes null, percent null, receivedBytes sigue creciendo', async () => {
    const store = new MockModelStore()
    // Sin content-length → getContentLength devuelve null → percent null.
    const { fetchFn } = makeFetchFn(() => okResponse(streamOfTotal(ENTRY.bytes), null))
    const events: DownloadProgress[] = []

    await ensureModel(NET, store, fetchFn, (p) => events.push(p))

    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.totalBytes).toBeNull()
      expect(e.percent).toBeNull()
    }
    expect(events.at(-1)!.receivedBytes).toBe(ENTRY.bytes)
    // Aun sin total, el commit + marcador ocurren (validación usa entry.bytes, no total).
    expect(store.markCompleteCalls).toHaveLength(1)
  })

  it('isComplete true de entrada: retorna sin llamar fetchFn', async () => {
    const store = new MockModelStore()
    // Pre-sembrar el store como ya-completo.
    store.committed.set(ENTRY.opfsName, ENTRY.bytes)
    store.markers.set(ENTRY.opfsName, ENTRY.bytes)
    const { fetchFn, calls } = makeFetchFn(() => {
      throw new Error('fetchFn no debería llamarse')
    })

    await ensureModel(NET, store, fetchFn)

    expect(calls).toHaveLength(0)
    expect(store.openWritableCalls).toBe(0)
    expect(store.markCompleteCalls).toHaveLength(0) // no re-marca
  })

  it('!res.ok: rechaza con el status, sin abrir sink ni markComplete', async () => {
    const store = new MockModelStore()
    const { fetchFn } = makeFetchFn(() => new Response('nope', { status: 404 }))

    await expect(ensureModel(NET, store, fetchFn)).rejects.toThrow('404')

    expect(store.openWritableCalls).toBe(0)
    expect(store.markCompleteCalls).toHaveLength(0)
  })

  it('res.body null: rechaza con error claro, sin abrir sink ni markComplete', async () => {
    const store = new MockModelStore()
    const { fetchFn } = makeFetchFn(() => new Response(null, { status: 200 }))

    await expect(ensureModel(NET, store, fetchFn)).rejects.toThrow()

    expect(store.openWritableCalls).toBe(0)
    expect(store.markCompleteCalls).toHaveLength(0)
  })
})
