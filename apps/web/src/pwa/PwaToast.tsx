// Avisos de la PWA: "hay versión nueva" y "ya funciona sin conexión". Presentación pura — recibe el
// estado de `useServiceWorker` y devuelve eventos.
//
// Se dibujan como un aviso flotante abajo al centro, deliberadamente discreto: el héroe de la
// pantalla es el tablero, y ninguno de estos dos mensajes es urgente. El de actualización NO se
// autodescarta (es una acción que el usuario debe poder tomar cuando quiera); el de "sin conexión"
// sí, porque es informativo y ya cumplió su función al leerse.
import { useEffect } from 'preact/hooks'

interface PwaToastProps {
  updateReady: boolean
  offlineReady: boolean
  onUpdate(): void
  onDismiss(): void
  onDismissOfflineReady(): void
}

/** Cuánto queda visible el aviso de "listo sin conexión" antes de irse solo. */
const OFFLINE_READY_MS = 6000

export function PwaToast({
  updateReady,
  offlineReady,
  onUpdate,
  onDismiss,
  onDismissOfflineReady,
}: PwaToastProps) {
  useEffect(() => {
    if (!offlineReady) return
    const timer = setTimeout(onDismissOfflineReady, OFFLINE_READY_MS)
    return () => clearTimeout(timer)
  }, [offlineReady, onDismissOfflineReady])

  if (updateReady) {
    return (
      <div class="pwa-toast" role="status" aria-live="polite">
        <p class="pwa-toast-text">Hay una versión nueva de tengen.</p>
        <div class="pwa-toast-actions">
          <button type="button" class="primary" onClick={onUpdate}>
            Actualizar
          </button>
          <button type="button" class="ghost" onClick={onDismiss}>
            Ahora no
          </button>
        </div>
      </div>
    )
  }

  if (offlineReady) {
    return (
      <div class="pwa-toast" role="status" aria-live="polite">
        <p class="pwa-toast-text">Listo: tengen ya funciona sin conexión.</p>
      </div>
    )
  }

  return null
}
