// Canal de variante hilo-principal → worker. 100 % de apps/web: NO toca el protocolo del motor.
//
// ── Por qué existe un mensaje fuera de `WorkerRequest` ─────────────────────────────────────────
// La prueba del motor de `/diagnostico` necesita medir una variante ELEGIDA (fp32 vs mixto en el
// mismo aparato), no la que le tocaría a ese dispositivo. Las dos formas obvias de conseguirlo
// tienen un costo que este canal evita:
//
// · Extender `WorkerRequest.init` cascadea por `packages/engine`: `types.ts` (interfaz `Engine`),
//   `worker/protocol.ts`, `engine.ts` y `worker/handler.ts`. Es cambiarle el contrato al motor para
//   una necesidad que es puramente de la app.
// · Dejar que el worker lo deduzca por su cuenta no sirve: entonces la sonda mediría siempre la
//   variante del dispositivo mientras reporta la pedida.
//
// `apps/web/src/engine.worker.ts` es de la app y ya posee su propio `addEventListener`, así que
// puede atender un mensaje propio y devolver antes de delegar en `createWorkerHandler`. El motor
// nunca lo ve.
//
// ── Las dos propiedades de las que depende que esto sea correcto ───────────────────────────────
// 1. ORDEN. El mensaje tiene que llegar antes del `init`. Se postea en `createWorkerManagedEngine`,
//    apenas construido el Worker y antes de que nadie pueda pedir un init; `postMessage` entrega en
//    orden FIFO y encola lo posteado antes de que el worker registre su listener, así que el orden
//    está garantizado sin sincronización.
// 2. RE-ENVÍO EN CADA REBUILD. `EngineManager.reconcile()` reconstruye el worker ante un crash o un
//    cambio de red llamando `this.factory()` otra vez. Por eso la variante viaja en la CLOSURE de la
//    factory (`() => createWorkerManagedEngine({ variant })`) y no en un `postMessage` suelto: un
//    worker reconstruido a mitad de corrida volvería a la variante del dispositivo y la medición
//    cambiaría de sujeto justo en el tramo donde el aparato está por morir, que es el que importa.
import type { ModelVariant } from '../models/netManifest'

/** `type` con prefijo de app: no puede colisionar con ningún `WorkerRequest` presente ni futuro. */
export const VARIANT_MESSAGE_TYPE = 'tengen:web:variant'

export interface VariantMessage {
  type: typeof VARIANT_MESSAGE_TYPE
  variant: ModelVariant
}

export function variantMessage(variant: ModelVariant): VariantMessage {
  return { type: VARIANT_MESSAGE_TYPE, variant }
}

/** Estrecha lo que llega al worker. Se aplica ANTES de `createWorkerHandler`, que lanza ante un
 *  `type` desconocido — de ahí que este mensaje deba reconocerse y consumirse primero. */
export function isVariantMessage(data: unknown): data is VariantMessage {
  if (typeof data !== 'object' || data === null) return false
  const msg = data as { type?: unknown; variant?: unknown }
  return msg.type === VARIANT_MESSAGE_TYPE && (msg.variant === 'fp32' || msg.variant === 'mixed16')
}
