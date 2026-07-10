// Worker propio de apps/web. Reusa la función pura createWorkerHandler del motor pero INYECTA la factory
// de la app (appEvaluatorFactory) en lugar de la factory por defecto /models/ del motor. Se ejecuta sólo
// como entrada de Worker (Vite lo empaqueta vía new Worker(new URL(...))), nunca en el hilo principal.
import { createWorkerHandler, LocalEngine } from '@tengen/engine'
import type { WorkerRequest } from '@tengen/engine'
import { appEvaluatorFactory } from './appFactory'

// `self` está tipado como Window (lib DOM); su postMessage tiene otra firma. Cast al contrato real del
// dedicated worker scope (mismo patrón que packages/engine/src/worker/engine.worker.ts).
const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
}

const engine = new LocalEngine({ evaluatorFactory: appEvaluatorFactory })
const handle = createWorkerHandler(engine, (msg, transfer) => scope.postMessage(msg, transfer ?? []))
scope.addEventListener('message', (ev) => handle(ev.data as WorkerRequest))
