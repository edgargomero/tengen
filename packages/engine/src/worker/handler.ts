// Manejador PURO del protocolo del Worker (sin tocar `self`): gestiona la cola serial de operaciones,
// el streaming de `analyze` y el BYPASS de `stop`. Se testea en Node con un canal mock
// (tests/worker.test.ts) y se reusa desde `engine.worker.ts` (entrada del browser del motor) y desde
// `apps/web/src/engine.worker.ts` (entrada del browser de la app, con su propia factory). Movido aquí
// desde `engine.worker.ts` para que importarlo NO arrastre el side-effect de auto-cableado del browser.

import type { Analysis } from '../types'
import { LocalEngine } from '../engine'
import { transferablesOf, type WorkerRequest, type WorkerResponse } from './protocol'

/** Canal de salida (Worker → hilo principal). El browser lo respalda con `self.postMessage`; el test
 *  con un canal mock. El segundo argumento son los Transferables (`transferablesOf`). */
export type PostFn = (msg: WorkerResponse, transfer?: Transferable[]) => void

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Fábrica del manejador de mensajes del Worker. Recibe un `LocalEngine` (la extensión de `analyze`
 * con hooks `onDone`/`onError` vive en la clase concreta, no en la interfaz pública `Engine`) y un
 * `post` para responder. Devuelve `(req) => void` para cablear a `onmessage`.
 *
 * Concurrencia:
 * - `init`/`genMove`/`analyze` se ENCOLAN en serie (`queue = queue.then(...)`) y se esperan a
 *   completar: el scratch del MCTS (`expandScratch` en analyzeMcts.ts) es global y no reentrante.
 * - `stop` se maneja al RECIBIR, FUERA de la cola. Si pasara por la misma cola quedaría encolado
 *   detrás del `analyze` en vuelo —que sólo termina al cancelarse— produciendo un DEADLOCK: `stop`
 *   nunca correría y `analyze` nunca pararía. Sólo hace `engine.stop()` (flip del flag cooperativo) y
 *   resuelve la entrada de cola del `analyze` activo. Esa resolución es imprescindible: la cancelación
 *   NO dispara `onDone`/`onError` (contrato de `final`), así que sin ella la entrada quedaría colgada.
 *
 * Nota (sub-especificado, documentado en el reporte de Task 13): una operación de búsqueda encolada
 * INMEDIATAMENTE tras un `stop` puede reiniciar el flag `cancelled` mientras el IIFE de `analyze`
 * cancelado aún se desenrolla. Al ser JS mono-hilo no hay corrupción del scratch (buffer transitorio,
 * sin `await` en su ventana viva); el residuo es lógico (un `onUpdate` tardío para un id ya detenido,
 * que el cliente ignora porque borró su callback). Cerrarlo requeriría una señal de asentamiento de
 * cancelación que el set fijo de dos hooks omite a propósito → fuera de scope.
 */
export function createWorkerHandler(engine: LocalEngine, post: PostFn): (req: WorkerRequest) => void {
  let queue: Promise<void> = Promise.resolve()
  // Resolutor de la entrada de cola del `analyze` en vuelo (undefined si no hay ninguno). Lo invoca el
  // handler de `stop` para desbloquear la cola al cancelar (ver doc arriba).
  let resolveActiveAnalyze: (() => void) | undefined

  const enqueue = (task: () => Promise<void>): void => {
    // `.catch` defensivo: una tarea nunca debe dejar la cola en estado rechazado (colgaría las
    // siguientes). Cada handler ya captura sus errores y los traduce a un mensaje 'error'.
    queue = queue.then(task).catch(() => {})
  }

  const handleInit = async (req: Extract<WorkerRequest, { type: 'init' }>): Promise<void> => {
    try {
      await engine.init({ network: req.network, boardSize: req.boardSize })
      post({ type: 'ready', id: req.id })
    } catch (e) {
      post({ type: 'error', id: req.id, message: errorMessage(e) })
    }
  }

  const handleGenMove = async (req: Extract<WorkerRequest, { type: 'genMove' }>): Promise<void> => {
    try {
      const move = await engine.genMove(req.pos, { level: req.level })
      post({ type: 'move', id: req.id, move })
    } catch (e) {
      post({ type: 'error', id: req.id, message: errorMessage(e) })
    }
  }

  const handleAnalyze = (req: Extract<WorkerRequest, { type: 'analyze' }>): Promise<void> => {
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolveActiveAnalyze = undefined
        resolve()
      }
      const emit = (analysis: Analysis, final: boolean): void => {
        const msg: WorkerResponse = { type: 'analysis', id: req.id, analysis, final }
        post(msg, transferablesOf(msg))
      }
      // Registrar el resolutor ANTES de lanzar: un `stop` puede llegar en cuanto el primer `await`
      // interno ceda el control.
      resolveActiveAnalyze = finish
      engine.analyze(
        req.pos,
        { visits: req.visits },
        (a) => emit(a, false),
        {
          // Completado natural (target ≥ visits): emite el `final:true` y desbloquea la cola.
          onDone: (a) => {
            emit(a, true)
            finish()
          },
          // Error: lo traduce a mensaje y desbloquea la cola.
          onError: (e) => {
            post({ type: 'error', id: req.id, message: errorMessage(e) })
            finish()
          },
        },
      )
    })
  }

  return (req: WorkerRequest): void => {
    switch (req.type) {
      case 'stop':
        // BYPASS de la cola (ver doc de la fábrica): se maneja de inmediato para no caer en deadlock.
        engine.stop()
        resolveActiveAnalyze?.()
        break
      case 'init':
        enqueue(() => handleInit(req))
        break
      case 'genMove':
        enqueue(() => handleGenMove(req))
        break
      case 'analyze':
        enqueue(() => handleAnalyze(req))
        break
    }
  }
}
