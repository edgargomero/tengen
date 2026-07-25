// Organismo TopBar (nav de app, spec no-scroll/nav 2026-07-25). Ancla las pantallas de tablero:
// arriba-izquierda la MARCA (vuelve al menú) + DÓNDE estás; a la derecha A DÓNDE podés ir (cambiar
// entre Jugar/Analizar). Convención de nav arriba-izquierda — antes el único "Volver" vivía enterrado
// en el footer del panel, sin anclaje. Composición atómica: marca (átomo botón-fantasma) + ubicación
// (átomo texto) + conmutador de modo (molécula SegmentedControl, mismo patrón que las pestañas del
// panel). Consume solo tokens.
import { route } from 'preact-router'

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
      </div>
      <nav class="topbar-modes" aria-label="Cambiar modo">
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
