/// <reference types="vite-plugin-pwa/client" />
// Registro del service worker y estado de actualización, como SINGLETON de módulo.
//
// Por qué un singleton y no estado de componente: el registro del service worker es un recurso del
// DOCUMENTO, no de un árbol de Preact. Antes vivía dentro de `useServiceWorker`, y eso alcanzaba
// mientras el único consumidor era `Root` (que monta el aviso flotante). Ahora el menú también
// necesita leerlo —muestra la versión y ofrece "Buscar actualizaciones"—, y dos llamadas al hook
// habrían llamado `registerSW()` dos veces: dos juegos de callbacks sobre el mismo registro y dos
// intervalos de chequeo periódico corriendo en paralelo.
//
// Es el mismo patrón que `cloud/useSession.ts`: estado compartido en el módulo, hook suscriptor. Acá
// el store se escribe a mano en vez de usar nanostores (una dependencia menos para tres booleanos).
//
// Decisión que gobierna el archivo, heredada y no negociable: **nunca recargar solo.**
// `registerType: 'prompt'` (ver `vite.config.ts`) deja al service worker nuevo esperando en vez de
// activarse. Lo que este archivo agrega es el DISPARADOR del chequeo, no la activación: buscar
// versiones nuevas pasa a ser automático, aplicarlas la sigue eligiendo el usuario. Activar un shell
// nuevo mientras alguien piensa una jugada con el reloj corriendo cambiaría una partida por una
// mejora de CSS.
import { registerSW } from 'virtual:pwa-register'
import {
  classifyRegistration,
  MIN_AUTO_CHECK_INTERVAL_MS,
  PERIODIC_CHECK_MS,
  shouldAutoCheck,
} from './updatePolicy'
import type { UpdateCheckState } from './updatePolicy'

export interface SwSnapshot {
  /** Hay una versión nueva descargada y esperando. La app sigue usable con la vieja. */
  updateReady: boolean
  /** El shell quedó precacheado: a partir de acá la app abre sin conexión. */
  offlineReady: boolean
  /** Resultado del último chequeo pedido a mano (el automático no toca esto: no hay nadie mirando). */
  checkState: UpdateCheckState
}

let snapshot: SwSnapshot = { updateReady: false, offlineReady: false, checkState: 'idle' }
const listeners = new Set<(snap: SwSnapshot) => void>()

let started = false
let registration: ServiceWorkerRegistration | null = null
/** La función que aplica la actualización, que devuelve `registerSW`. Null hasta que registre. */
let applyUpdate: (() => Promise<void>) | null = null
let lastCheckMs: number | null = null

function emit(patch: Partial<SwSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener(snapshot)
}

/**
 * Corre el chequeo contra el servidor. `manual` cambia SOLO cuánto se cuenta hacia afuera: el chequeo
 * automático es silencioso (nadie pidió nada, así que un fallo de red no merece un mensaje), el manual
 * reporta siempre — un botón que no da señal de haber hecho algo es peor que no tener botón.
 */
async function runCheck(manual: boolean): Promise<void> {
  if (!registration) {
    // El registro es asíncrono: apretar el botón en el primer segundo de vida de la página puede caer
    // acá. También cae acá un navegador sin service workers.
    if (manual) emit({ checkState: 'error' })
    return
  }
  if (!navigator.onLine) {
    if (manual) emit({ checkState: 'offline' })
    return
  }
  if (!manual && !shouldAutoCheck({ visible: true, online: true, lastCheckMs, nowMs: Date.now() })) {
    return
  }
  lastCheckMs = Date.now()
  if (manual) emit({ checkState: 'checking' })
  try {
    await registration.update()
    const result = classifyRegistration(registration)
    // `ready` sin haber pasado por `onNeedRefresh` es posible (un worker que quedó esperando de una
    // sesión anterior, o una carrera entre el callback y este chequeo): se refleja igual, así el aviso
    // aparece en vez de perderse.
    if (result === 'ready') emit({ updateReady: true })
    if (manual) emit({ checkState: result })
  } catch {
    // `update()` rechaza con la red caída o si el servidor devuelve algo que no es un script válido.
    if (manual) emit({ checkState: 'error' })
  }
}

/**
 * Registra el service worker y monta los tres disparadores de chequeo. Idempotente: la primera
 * llamada gana y el resto no hace nada. Los listeners que monta viven lo que vive el documento y por
 * eso no se desmontan nunca — es deliberado, un singleton no tiene ciclo de vida de componente.
 */
export function startServiceWorker(): void {
  if (started) return
  started = true

  applyUpdate = registerSW({
    // Sin esperar el evento `load`: la app ya se monta con el HTML parseado.
    immediate: true,
    onNeedRefresh: () => emit({ updateReady: true }),
    onOfflineReady: () => emit({ offlineReady: true }),
    onRegisteredSW: (_swUrl, reg) => {
      if (reg) registration = reg
    },
  })

  // 1) Volver a la app. ES el caso de una PWA instalada: no se recarga, se vuelve a ella. Sin esto,
  //    una app que nunca se cierra no se enteraría nunca de un deploy.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void runCheck(false)
  })
  // 2) Recuperar la red. El chequeo anterior pudo haber caído justo en un tramo sin conexión (en un
  //    teléfono, el caso normal), y ese fallo consumió el piso del throttle igual.
  window.addEventListener('online', () => void runCheck(false))
  // 3) Reloj de pared, para la sesión que queda abierta horas sin cambiar de pestaña.
  setInterval(() => {
    if (document.visibilityState === 'visible') void runCheck(false)
  }, PERIODIC_CHECK_MS)
}

export function subscribeSw(listener: (snap: SwSnapshot) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSwSnapshot(): SwSnapshot {
  return snapshot
}

/** Activa la versión nueva y recarga. Sólo debe llamarse desde un gesto explícito del usuario. */
export function applySwUpdate(): void {
  if (applyUpdate) void applyUpdate()
}

/** Descarta el aviso sin actualizar; vuelve a aparecer en el próximo chequeo o en la próxima visita. */
export function dismissSwUpdate(): void {
  emit({ updateReady: false })
}

/** Chequeo pedido a mano. Nunca throttleado — ver `MIN_AUTO_CHECK_INTERVAL_MS`. */
export function checkSwUpdate(): void {
  void runCheck(true)
}

export { MIN_AUTO_CHECK_INTERVAL_MS, PERIODIC_CHECK_MS }
export type { UpdateCheckState }
