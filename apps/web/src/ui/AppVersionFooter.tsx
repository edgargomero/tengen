// Pie del menú: qué versión corre este dispositivo + "Buscar actualizaciones". Presentación pura —
// recibe el estado del service worker y devuelve un evento.
//
// Las dos mitades resuelven problemas distintos. La versión visible hace DEPURABLE un reporte de "me
// pasa algo raro": sin ella no hay forma de saber si el aparato ya recibió la corrección de la que se
// está hablando. El botón es la salida de emergencia del chequeo automático: los tres disparadores de
// `swController.ts` cubren el caso normal, pero cuando alguien está esperando un arreglo concreto,
// "volvé mañana" no es una respuesta.
//
// Vive en el menú y no en la barra del tablero a propósito: es información del PROGRAMA, no de la
// partida (el mismo criterio por el que `PwaToast` y el chip de conexión están fuera del rail).
import type { UpdateCheckState } from '../pwa/updatePolicy'

interface AppVersionFooterProps {
  /** Identificador del build (`BUILD_ID`), tal cual se muestra y se pega en un reporte. */
  buildId: string
  checkState: UpdateCheckState
  /** Si ya hay una versión nueva esperando, lo que corresponde decir es eso — no el resultado del
   * chequeo que la encontró. */
  updateReady: boolean
  onCheck(): void
}

/**
 * Qué decir bajo el botón. `null` = nada: el estado inicial no merece una línea de texto ocupando
 * lugar, y el chequeo automático es silencioso por diseño (nadie pidió nada).
 *
 * `updateReady` gana sobre todo lo demás porque es el único estado con una consecuencia para el
 * usuario; los otros son el relato de un trámite.
 */
export function checkMessage(state: UpdateCheckState, updateReady: boolean): string | null {
  if (updateReady) return 'Hay una versión nueva lista para instalar.'
  switch (state) {
    case 'checking':
      return 'Buscando…'
    case 'installing':
      // `registration.update()` ya resolvió, pero el precache del WASM de ORT (25 MB) sigue en curso;
      // el aviso de "versión nueva" llega recién cuando termina.
      return 'Descargando la versión nueva…'
    case 'uptodate':
      return 'Estás en la última versión.'
    case 'offline':
      return 'Sin conexión: se buscará al recuperar la red.'
    case 'error':
      return 'No se pudo comprobar. Vuelve a intentarlo.'
    case 'ready':
    case 'idle':
      // 'ready' sin `updateReady` no debería existir (el controller sincroniza ambos), y si pasara,
      // el aviso flotante es el que corresponde — no una línea de texto acá.
      return null
  }
}

export function AppVersionFooter({ buildId, checkState, updateReady, onCheck }: AppVersionFooterProps) {
  const message = checkMessage(checkState, updateReady)
  return (
    <div class="menu-footer menu-footer--stacked">
      <div class="menu-footer-row">
        <span class="system-note">{buildId}</span>
        <button type="button" class="ghost" onClick={onCheck} disabled={checkState === 'checking'}>
          Buscar actualizaciones
        </button>
        {/* `<a href>` y no `<Link>`: la pantalla de diagnóstico se resuelve fuera del router, antes del
            gate de WebGPU, así que necesita una navegación completa del documento (ver `main.tsx`). */}
        <a class="link-button ghost" href="/diagnostico">
          Diagnóstico
        </a>
      </div>
      {message !== null && (
        <p class="hint" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  )
}
