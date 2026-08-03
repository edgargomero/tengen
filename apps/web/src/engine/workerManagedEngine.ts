// Factory browser-only del `ManagedEngine` real (Fase 2). Archivo 100% de tengen.
//
// Construye el Worker real de apps/web (Vite lo empaqueta vía `new Worker(new URL(...))`) y lo
// envuelve en un `WorkerEngine`, cableando el evento 'error' del Worker (crash) al `onError` del
// contrato `ManagedEngine`. Es lo ÚNICO que referencia `Worker`/`import.meta.url`; por eso vive
// SEPARADO de `engineManager.ts` (Node-testeable). NO tiene test Node —Node no tiene `Worker`—; se
// ejercita en el browser en Task 4.

import { WorkerEngine } from '@tengen/engine'
import type { ManagedEngine } from './engineManager'
import type { ModelVariant } from '../models/netManifest'
import { variantMessage } from './variantMessage'

export function createWorkerManagedEngine(opts?: {
  /**
   * Fuerza la variante de precisión del modelo en vez de usar la del dispositivo. SÓLO la prueba
   * del motor de `/diagnostico`, para poder comparar fp32 contra mixto en el mismo aparato.
   *
   * Va como parámetro de ESTA función y no como un `postMessage` externo porque `EngineManager`
   * reconstruye el worker ante un crash llamando a la factory de nuevo: envuelta en la closure
   * (`() => createWorkerManagedEngine({ variant })`), la variante sobrevive a los rebuilds. Ver
   * `variantMessage.ts`. El parámetro es opcional, así que la función sigue siendo asignable a
   * `ManagedEngineFactory` sin cambios en producción.
   */
  variant?: ModelVariant
}): ManagedEngine {
  const worker = new Worker(new URL('../engine.worker.ts', import.meta.url), { type: 'module' })
  // ANTES de cualquier otra cosa: `postMessage` entrega en orden, así que este mensaje llega al
  // worker antes del `init` que dispare quien sea, que es cuando se lee la variante.
  if (opts?.variant !== undefined) worker.postMessage(variantMessage(opts.variant))
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
