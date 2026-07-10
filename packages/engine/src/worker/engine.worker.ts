// Entrada del browser del MOTOR (standalone / smoke): SÓLO dentro de un dedicated worker real crea un
// `LocalEngine` con la factory por defecto (/models/<id>.onnx del dev server) y cablea `self`. La lógica
// pura del handler vive en `./handler` (reusada por este archivo y por apps/web con su propia factory).
// En Node/vitest `self` es `undefined` (guarda primaria); el chequeo de `document` descarta además un
// entorno tipo jsdom (donde `self` sería la ventana). Así, importar este módulo en la suite NO cablea
// `onmessage`.

import { LocalEngine } from '../engine'
import { createWorkerHandler } from './handler'
import type { WorkerRequest } from './protocol'

if (typeof self !== 'undefined' && typeof (self as { document?: unknown }).document === 'undefined') {
  const scope = self as unknown as {
    postMessage(message: unknown, transfer?: Transferable[]): void
    addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  }
  const engine = new LocalEngine() // factory por defecto (/models/<id>.onnx, servido por el dev server)
  const handle = createWorkerHandler(engine, (msg, transfer) => scope.postMessage(msg, transfer ?? []))
  scope.addEventListener('message', (ev) => handle(ev.data as WorkerRequest))
}
