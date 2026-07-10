// `WorkerEngine implements Engine` — fachada del hilo principal sobre el Worker. Archivo 100% de
// tengen. Expone la MISMA interfaz `Engine` que `LocalEngine` (intercambiables desde apps/web).
// Correlaciona requests/responses por `id` incremental; el streaming de `analyze` se entrega vía el
// callback `onUpdate` registrado por id, y la `CancelFn` postea `stop`.

import type { Analysis, BoardSize, CancelFn, Engine, Move, NetworkId, Position, RankLevel } from '../types'
import { decodeResponse, encodeRequest, type WorkerRequest } from './protocol'

/**
 * Supertipo ESTRUCTURAL mínimo de `Worker` (DOM). El plan pedía `constructor(worker: Worker)`, pero
 * `Worker` es un tipo del DOM inexistente en Node → el round-trip no se podría testear con un canal
 * mock. `WorkerLike` captura lo ÚNICO que `WorkerEngine` usa: un `Worker` real lo satisface y el mock
 * del test también. Refinamiento justificado por testabilidad (documentado en el reporte de Task 13).
 */
export type WorkerLike = {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void }

export class WorkerEngine implements Engine {
  private readonly worker: WorkerLike
  private nextId = 1
  /** Operaciones de resultado único (init/genMove) en vuelo, por id. */
  private readonly pending = new Map<number, Pending>()
  /** Callbacks de streaming de `analyze` en vuelo, por id. */
  private readonly analyzers = new Map<number, (a: Analysis) => void>()

  constructor(worker: WorkerLike) {
    this.worker = worker
    worker.addEventListener('message', (ev) => this.onMessage(ev.data))
  }

  init(config: { network: NetworkId; boardSize: BoardSize }): Promise<void> {
    const id = this.nextId++
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.post({ type: 'init', id, network: config.network, boardSize: config.boardSize })
    })
  }

  genMove(pos: Position, opts: { level: RankLevel }): Promise<Move> {
    const id = this.nextId++
    return new Promise<Move>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.post({ type: 'genMove', id, pos, level: opts.level })
    })
  }

  analyze(pos: Position, opts: { visits: number }, onUpdate: (a: Analysis) => void): CancelFn {
    const id = this.nextId++
    this.analyzers.set(id, onUpdate)
    this.post({ type: 'analyze', id, pos, visits: opts.visits })
    return () => {
      // La cancelación se resuelve client-side: dejar de escuchar este id + avisar al Worker. El
      // Worker NO emite mensaje de cancelación (contrato de `final`), así que la limpieza es local.
      this.analyzers.delete(id)
      this.post({ type: 'stop', id })
    }
  }

  stop(): void {
    // Paridad con `LocalEngine.stop` (flag único que corta TODO lo en vuelo). El Worker cancela
    // globalmente con un único `stop`; limpiamos además los callbacks locales de análisis (la
    // cancelación no trae `final`). Un genMove kata en vuelo lo aborta el `engine.stop()` del Worker,
    // que igualmente resuelve su promesa con la mejor jugada hallada.
    const id = this.nextId++
    this.analyzers.clear()
    this.post({ type: 'stop', id })
  }

  private post(req: WorkerRequest): void {
    this.worker.postMessage(encodeRequest(req))
  }

  private onMessage(data: unknown): void {
    const res = decodeResponse(data)
    switch (res.type) {
      case 'ready': {
        const p = this.pending.get(res.id)
        if (p !== undefined) {
          this.pending.delete(res.id)
          p.resolve(undefined)
        }
        break
      }
      case 'move': {
        const p = this.pending.get(res.id)
        if (p !== undefined) {
          this.pending.delete(res.id)
          p.resolve(res.move)
        }
        break
      }
      case 'analysis': {
        const cb = this.analyzers.get(res.id)
        if (cb !== undefined) {
          cb(res.analysis)
          if (res.final) this.analyzers.delete(res.id) // completado natural → ya no llegan más chunks
        }
        break
      }
      case 'error': {
        const p = this.pending.get(res.id)
        if (p !== undefined) {
          this.pending.delete(res.id)
          p.reject(new Error(res.message))
        } else {
          // Error durante un `analyze`: dejar de escuchar ese id.
          this.analyzers.delete(res.id)
        }
        break
      }
    }
  }
}
