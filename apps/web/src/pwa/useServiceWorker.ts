/// <reference types="vite-plugin-pwa/client" />
// Registro del service worker + estado de actualización. Preact-side del `src/sw.ts`.
//
// Decisión que gobierna todo este archivo: **nunca recargar solo.** `registerType: 'prompt'` en la
// config de Vite hace que un service worker nuevo se quede esperando en vez de activarse; acá se
// expone ese estado para que la UI ofrezca actualizar y sea el usuario quien elija el momento.
// Recargar por nuestra cuenta podría hacerlo justo mientras alguien piensa una jugada con el reloj
// corriendo, o a mitad de un review de 40 posiciones — una partida perdida por una mejora de CSS es
// un mal negocio.
import { useEffect, useState } from 'preact/hooks'
import { registerSW } from 'virtual:pwa-register'

export interface ServiceWorkerState {
  /** Hay una versión nueva descargada y esperando. La app sigue usable con la vieja. */
  updateReady: boolean
  /** El shell quedó precacheado: a partir de acá la app abre sin conexión. */
  offlineReady: boolean
  /** Activa la versión nueva y recarga. Solo debe llamarse desde un gesto explícito del usuario. */
  update(): void
  /** Descarta el aviso sin actualizar; vuelve a aparecer en la próxima visita. */
  dismiss(): void
}

export function useServiceWorker(): ServiceWorkerState {
  const [updateReady, setUpdateReady] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  // `registerSW` devuelve la función que aplica la actualización; se guarda en estado porque el
  // registro es asíncrono y el componente puede renderizar antes de que exista.
  const [applyUpdate, setApplyUpdate] = useState<(() => Promise<void>) | null>(null)

  useEffect(() => {
    // El registro se hace UNA vez por vida del documento. `immediate: true` lo dispara sin esperar
    // al evento `load` (la app ya se monta después de que el HTML está parseado).
    const update = registerSW({
      immediate: true,
      onNeedRefresh: () => setUpdateReady(true),
      onOfflineReady: () => setOfflineReady(true),
    })
    // Se envuelve en función porque `useState` trata una función como actualizador perezoso.
    setApplyUpdate(() => update)
  }, [])

  return {
    updateReady,
    offlineReady,
    update: () => {
      if (applyUpdate) void applyUpdate()
    },
    dismiss: () => setUpdateReady(false),
  }
}
