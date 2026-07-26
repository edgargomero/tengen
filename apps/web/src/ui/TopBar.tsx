// Organismo TopBar (nav de app). Ancla las pantallas de tablero: arriba-izquierda la MARCA (vuelve
// al menú) + DÓNDE estás; a la derecha A DÓNDE puedes ir (cambiar entre Jugar/Analizar). Convención
// de nav arriba-izquierda — antes el único "Volver" vivía enterrado en el footer del panel, sin
// anclaje. Composición atómica: marca (átomo botón-fantasma) + ubicación (átomo texto) + conmutador
// de modo (molécula `.segmented`, la misma que las pestañas del rail). Consume solo tokens.
//
// Es chrome de la VENTANA, no del contenido: la banda cruza el viewport entero y su alto es fijo
// (`--topbar-h`) porque el cálculo no-scroll del tablero depende de que no cambie con su contenido.
import { route } from 'preact-router'
import { useOnlineStatus } from '../pwa/useOnlineStatus'

interface TopBarProps {
  mode: 'jugar' | 'analizar'
  /** Cleanup antes de navegar fuera (p.ej. `cloud.finish()` → backup a Drive al salir). Opcional. */
  onLeave?(): void
  /** "Volver al menú" propio de la vista. Sin esto, home = `route('/')`. */
  onHome?(): void
}

const MODES: { id: 'jugar' | 'analizar'; label: string; path: string }[] = [
  { id: 'jugar', label: 'Jugar', path: '/jugar' },
  { id: 'analizar', label: 'Analizar', path: '/analizar' },
]

export function TopBar({ mode, onLeave, onHome }: TopBarProps) {
  const online = useOnlineStatus()
  function navTo(path: string): void {
    onLeave?.()
    route(path)
  }
  function goHome(): void {
    if (onHome) onHome()
    else navTo('/')
  }
  return (
    <header class="topbar">
      <div class="topbar-brand">
        <button type="button" class="topbar-home" onClick={goHome} title="Volver al menú">
          tengen
        </button>
        <span class="topbar-sep" aria-hidden="true">
          ·
        </span>
        <span class="topbar-location">{mode === 'jugar' ? 'Jugar' : 'Analizar'}</span>
        {/* Sin conexión NO es un error acá: el motor y los pesos están en el dispositivo, así que
            jugar y analizar siguen funcionando. Lo único que se apaga es el guardado en la nube. */}
        {!online && (
          <span class="offline-chip" title="El motor corre en tu dispositivo: puedes seguir jugando y analizando. No se guardará en la nube hasta que vuelva la conexión.">
            Sin conexión
          </span>
        )}
      </div>
      <nav class="segmented" aria-label="Cambiar modo">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-current={mode === m.id ? 'page' : undefined}
            class={mode === m.id ? 'active' : ''}
            onClick={() => mode !== m.id && navTo(m.path)}
          >
            {m.label}
          </button>
        ))}
      </nav>
    </header>
  )
}
