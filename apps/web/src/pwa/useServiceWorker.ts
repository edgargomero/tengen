// Vista de Preact sobre `swController.ts` (el singleton que registra el service worker). Este archivo
// ya no tiene lógica: suscribe, devuelve el snapshot y pasa las acciones. La lógica del registro y de
// los disparadores de chequeo vive en el controller —porque es estado del documento, no del árbol— y
// la parte decidible ("¿corresponde chequear ahora?") en `updatePolicy.ts`, testeada en Node.
import { useEffect, useState } from 'preact/hooks'
import {
  applySwUpdate,
  checkSwUpdate,
  dismissSwUpdate,
  getSwSnapshot,
  startServiceWorker,
  subscribeSw,
} from './swController'
import type { UpdateCheckState } from './updatePolicy'

export interface ServiceWorkerState {
  /** Hay una versión nueva descargada y esperando. La app sigue usable con la vieja. */
  updateReady: boolean
  /** El shell quedó precacheado: a partir de acá la app abre sin conexión. */
  offlineReady: boolean
  /** Resultado del último chequeo pedido a mano; `'idle'` si nunca se pidió ninguno. */
  checkState: UpdateCheckState
  /** Activa la versión nueva y recarga. Sólo debe llamarse desde un gesto explícito del usuario. */
  update(): void
  /** Descarta el aviso sin actualizar; vuelve a aparecer en el próximo chequeo o visita. */
  dismiss(): void
  /** Busca una versión nueva ahora mismo, sin esperar al chequeo automático. */
  checkForUpdate(): void
}

export function useServiceWorker(): ServiceWorkerState {
  const [snapshot, setSnapshot] = useState(getSwSnapshot)

  useEffect(() => {
    // Idempotente: el primero en montar registra, el resto sólo se suscribe.
    startServiceWorker()
    // Re-sincroniza al suscribirse: entre el `useState` inicial y este efecto el controller pudo
    // haber emitido (el registro es asíncrono, pero un segundo consumidor monta cuando ya emitió).
    setSnapshot(getSwSnapshot())
    return subscribeSw(setSnapshot)
  }, [])

  return {
    ...snapshot,
    update: applySwUpdate,
    dismiss: dismissSwUpdate,
    checkForUpdate: checkSwUpdate,
  }
}
