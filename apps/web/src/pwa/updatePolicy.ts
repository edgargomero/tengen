// Política de "cuándo buscar una versión nueva" — la parte DECIDIBLE del ciclo de actualización de la
// PWA, separada del hook a propósito: `useServiceWorker.ts` importa `virtual:pwa-register`, un módulo
// que sólo existe dentro de Vite, así que nada de lo que viva ahí se puede testear en Node. Acá no hay
// imports; son funciones puras con sus tests en `tests/updatePolicy.test.ts`.
//
// El problema que resuelve: `registerSW({ immediate: true })` sólo busca versiones nuevas AL CARGAR LA
// PÁGINA. Una PWA instalada no se recarga — se vuelve a ella. Sin un disparador propio, un dispositivo
// puede quedar semanas en un shell viejo, y (peor) sin ver ninguna corrección futura, incluida la
// pantalla de diagnóstico que sirve para averiguar por qué está roto.

/** Cada cuánto se busca sola una versión nueva mientras la app está abierta. Una hora: los deploys de
 * tengen se cuentan por día, no por minuto, y cada chequeo es una request a la red. */
export const PERIODIC_CHECK_MS = 60 * 60 * 1000

/** Piso entre dos chequeos AUTOMÁTICOS. Sin esto, alternar pestañas en un teléfono dispararía un
 * `registration.update()` por cada toque: `visibilitychange` es barato de emitir y costoso de atender.
 * NO aplica al chequeo manual — si el usuario aprieta el botón, el botón tiene que hacer algo. */
export const MIN_AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000

export interface AutoCheckInput {
  /** `document.visibilityState === 'visible'`. En segundo plano no se gasta red. */
  visible: boolean
  /** `navigator.onLine`. Miente hacia el lado optimista, nunca hacia el pesimista (ver
   * `useOnlineStatus.ts`): si dice `false`, seguro no hay red y el chequeo fallaría igual. */
  online: boolean
  /** Marca del último chequeo (de cualquier tipo), o `null` si todavía no hubo ninguno. */
  lastCheckMs: number | null
  nowMs: number
}

/** ¿Corresponde un chequeo automático ahora? Sólo con la app visible, con red, y pasado el piso. */
export function shouldAutoCheck({ visible, online, lastCheckMs, nowMs }: AutoCheckInput): boolean {
  if (!visible || !online) return false
  if (lastCheckMs === null) return true
  return nowMs - lastCheckMs >= MIN_AUTO_CHECK_INTERVAL_MS
}

/** Resultado visible de un chequeo. `installing` existe porque `registration.update()` resuelve cuando
 * terminó de BAJAR el service worker nuevo, no cuando terminó de precachear los 25 MB del WASM de ORT:
 * decir "ya estás al día" en ese momento sería mentir justo cuando algo sí está pasando. */
export type UpdateCheckState =
  | 'idle'
  | 'checking'
  | 'installing'
  | 'ready'
  | 'uptodate'
  | 'offline'
  | 'error'

/** Estado de un `ServiceWorkerRegistration` justo después de un `update()`, en lo único que nos
 * importa. Tipado local (en vez de usar el lib.dom) para que el test pueda pasar objetos planos. */
export interface RegistrationSnapshot {
  installing: unknown
  waiting: unknown
}

/**
 * Traduce el estado del registro tras `update()`:
 *   · `waiting`   → ya hay una versión nueva lista esperando activación.
 *   · `installing` → está bajando/precacheando; el aviso llegará cuando termine.
 *   · ninguno     → no hay nada nuevo del otro lado.
 * `waiting` se chequea PRIMERO: durante el precacheo del segundo de dos deploys seguidos pueden
 * coexistir un `waiting` (listo) y un `installing` (el siguiente), y lo accionable es el que ya está.
 */
export function classifyRegistration(reg: RegistrationSnapshot): 'installing' | 'ready' | 'uptodate' {
  if (reg.waiting) return 'ready'
  if (reg.installing) return 'installing'
  return 'uptodate'
}
