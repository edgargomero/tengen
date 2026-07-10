// Factory browser-only del `ManagedEngine` real (Fase 2). Archivo 100% de tengen.
//
// Construye el Worker real de apps/web (Vite lo empaqueta vía `new Worker(new URL(...))`) y lo
// envuelve en un `WorkerEngine`, cableando el evento 'error' del Worker (crash) al `onError` del
// contrato `ManagedEngine`. Es lo ÚNICO que referencia `Worker`/`import.meta.url`; por eso vive
// SEPARADO de `engineManager.ts` (Node-testeable). NO tiene test Node —Node no tiene `Worker`—; se
// ejercita en el browser en Task 4.

import { WorkerEngine } from '@tengen/engine'
import type { ManagedEngine } from './engineManager'

export function createWorkerManagedEngine(): ManagedEngine {
  const worker = new Worker(new URL('../engine.worker.ts', import.meta.url), { type: 'module' })
  const engine = new WorkerEngine(worker)
  return {
    engine,
    terminate: () => worker.terminate(),
    // El evento 'error' del Worker (hilo principal) dispara ante un error no capturado del worker
    // (crash). `WorkerEngine` no lo escucha; el `EngineManager` lo usa para su race-contra-crash.
    onError: (cb) => {
      worker.addEventListener('error', (ev) => cb(ev))
    },
  }
}
