// Manejador PURO del protocolo del Worker (sin tocar `self`): gestiona la cola serial de operaciones,
// el streaming de `analyze` y el BYPASS de `stop`. Se testea en Node con un canal mock
// (tests/worker.test.ts) y se reusa desde `engine.worker.ts` (entrada del browser del motor) y desde
// `apps/web/src/engine.worker.ts` (entrada del browser de la app, con su propia factory). Movido aquí
// desde `engine.worker.ts` para que importarlo NO arrastre el side-effect de auto-cableado del browser.

import type { Analysis, CancelFn } from '../types'
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
 * con hook `onDone`/canal `onError` vive en la clase concreta, no en la interfaz pública `Engine`) y un
 * `post` para responder. Devuelve `(req) => void` para cablear a `onmessage`.
 *
 * Concurrencia:
 * - `init`/`genMove`/`analyze` se ENCOLAN en serie (`queue = queue.then(...)`) y se esperan a
 *   completar: el scratch del MCTS (`expandScratch` en analyzeMcts.ts) es global y no reentrante.
 * - `stop`/`stopAll` se manejan al RECIBIR, FUERA de la cola. Si pasaran por la misma cola quedarían
 *   encolados detrás del `analyze` en vuelo —que sólo termina al cancelarse— produciendo un DEADLOCK.
 *
 * Cancelación por-id (Fase 3a Task 1, M-1): `activeCancels`/`activeFinishers` registran, por `id` de
 * request, la `CancelFn` y el resolutor de cola de cada `analyze` justo al arrancar. `stop{targetId}`
 * cancela SÓLO esa entrada: si ya está en los Maps (en vuelo), la cancela y libera su entrada de cola;
 * si aún no arrancó (encolado detrás de otra operación), se marca en `preCancelled` para que
 * `handleAnalyze` la salte por completo cuando la cola la alcance — nunca llega a invocar
 * `engine.analyze`. `stopAll` es el comportamiento global de antes (teardown/crash-recovery): corta
 * TODO lo activo vía `engine.stop()` + drena todos los resolutores en vuelo + limpia los tres registros.
 *
 * Nota (sub-especificado, heredado del diseño de Task 13): cancelar la operación ACTIVA libera su
 * entrada de cola de inmediato (vía `finish()`), lo que puede dejar arrancar a la siguiente encolada
 * ANTES de que el IIFE de la cancelada termine de desenrollarse (aún no llegó a su próximo chequeo de
 * `shouldAbort`). Al ser JS mono-hilo esto NO corrompe el scratch del MCTS (`expandScratch`, global y
 * no reentrante): cada uso del scratch es una sección síncrona sin `await` en su ventana viva, así que
 * dos operaciones nunca lo tocan A LA VEZ, sólo en sucesión — el residuo es lógico (un `onUpdate`
 * tardío para un id ya detenido, que el cliente ignora porque borró su callback), no de datos
 * compartidos.
 */
export function createWorkerHandler(engine: LocalEngine, post: PostFn): (req: WorkerRequest) => void {
  let queue: Promise<void> = Promise.resolve()
  // `CancelFn`/resolutor de cola de cada `analyze` REGISTRADO (en vuelo o recién arrancado), por `id`.
  const activeCancels = new Map<number, CancelFn>()
  const activeFinishers = new Map<number, () => void>()
  // Ids cancelados MIENTRAS seguían encolados (aún no llegaron a `activeCancels`): `handleAnalyze` los
  // consulta al arrancar y, si están aquí, se salta por completo (nunca invoca `engine.analyze`).
  const preCancelled = new Set<number>()

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
      // Se canceló mientras seguía encolado (nunca llegó a `activeCancels`): saltar por completo, sin
      // invocar `engine.analyze`. `.delete` consume la marca (uso único).
      if (preCancelled.delete(req.id)) {
        resolve()
        return
      }
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        activeCancels.delete(req.id)
        activeFinishers.delete(req.id)
        resolve()
      }
      const emit = (analysis: Analysis, final: boolean): void => {
        const msg: WorkerResponse = { type: 'analysis', id: req.id, analysis, final }
        post(msg, transferablesOf(msg))
      }
      const cancelFn = engine.analyze(
        req.pos,
        { visits: req.visits },
        (a) => emit(a, false),
        // Error: lo traduce a mensaje y desbloquea la cola.
        (e) => {
          post({ type: 'error', id: req.id, message: errorMessage(e) })
          finish()
        },
        {
          // Completado natural (target ≥ visits): emite el `final:true` y desbloquea la cola.
          onDone: (a) => {
            emit(a, true)
            finish()
          },
        },
      )
      // Registrar ANTES de que el próximo mensaje pueda procesarse: un `stop{targetId:req.id}` para
      // ESTE id sólo puede llegar en un mensaje posterior (JS mono-hilo), así que esto ya corre a
      // tiempo para cualquier cancelación dirigida a esta operación.
      activeCancels.set(req.id, cancelFn)
      activeFinishers.set(req.id, finish)
    })
  }

  return (req: WorkerRequest): void => {
    switch (req.type) {
      case 'stop': {
        // BYPASS de la cola (ver doc de la fábrica): se maneja de inmediato para no caer en deadlock.
        // Cancela SÓLO `req.targetId`, nunca lo que esté activo si no coincide.
        const cancelTarget = activeCancels.get(req.targetId)
        if (cancelTarget !== undefined) {
          cancelTarget()
          // Esa resolución es imprescindible: la cancelación NO dispara `onDone`/`onError` (contrato
          // de `final`), así que sin ella la entrada de cola quedaría colgada.
          activeFinishers.get(req.targetId)?.()
        } else {
          // Aún no arrancó (sigue encolado detrás de otra operación): marcarlo para que se salte por
          // completo cuando la cola lo alcance.
          preCancelled.add(req.targetId)
        }
        break
      }
      case 'stopAll': {
        // BYPASS de la cola: comportamiento global de antes (teardown/crash-recovery). Corta TODO lo
        // activo y drena cualquier entrada de cola pendiente.
        engine.stop()
        for (const finish of Array.from(activeFinishers.values())) finish()
        activeCancels.clear()
        activeFinishers.clear()
        preCancelled.clear()
        break
      }
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
