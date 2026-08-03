// Organismo AppFrame — el marco que TODA ruta hereda por construcción.
//
// El problema que resuelve es estructural, no cosmético: la `TopBar` la montaban las VISTAS
// (`PlayView` y `AnalyzeView` eran sus dos únicos usos), así que una pantalla nueva no heredaba
// nada y olvidarse era el camino por defecto — y se olvidó cuatro veces. Nueva partida quedó sin
// una sola ancla de navegación en el viewport inicial, con su "Volver" a 1196px de scroll. Al
// montarse UNA vez alrededor del `<Router>`, el marco pasa de opt-in a opt-out.
//
// ── Alcance: cuatro pantallas quedan FUERA, a propósito ────────────────────────────────────────
// El marco envuelve el `<Router>`, así que cubre RUTAS. Estas cuatro no lo son, y ninguna es un
// olvido que haya que "arreglar":
//   · `/diagnostico` y el cartel de sin-WebGPU viven fuera del router (`Root` compara `pathname`)
//     justamente para abrir en un aparato donde la app no arranca — el router está DENTRO del gate
//     de WebGPU. Darles un marco que depende del router reintroduce el fallo que esa decisión evita.
//   · "Detectando WebGPU…" y el fallback del `ErrorBoundary` se pintan antes/por encima de `ModeApp`.
// Las cuatro conservan su propia salida (`<a href>` o botón).
//
// ── Las dos formas del marco ───────────────────────────────────────────────────────────────────
// El criterio es la FORMA del viewport, no el dispositivo. En el ancho (≥768px, que incluye
// cualquier teléfono APAISADO: 844px de ancho) los destinos van arriba, en el conmutador. En el
// angosto Y alto van abajo, en una barra fija al alcance del pulgar. Ese corte cierra por
// construcción el único caso donde la barra inferior costaba tablero: en retrato el goban lo fija
// el ANCHO (`min(374, …)` en un iPhone 12), pero en apaisado lo fija el alto — y apaisado cae del
// lado ancho, donde la barra inferior no existe.
//
// El markup es el MISMO en las dos formas y la que sobra se apaga con CSS. No es pereza: el hook
// que dimensiona el goban MIDE la barra inferior (`useBoundedBoardSize`), y un nodo que siempre
// existe le da 0 gratis donde está oculta, sin duplicar el media query en TypeScript.
import type { ComponentChildren } from 'preact'
import { useRef } from 'preact/hooks'
import { getCurrentUrl, route, useRouter } from 'preact-router'
import { signInWithGoogle } from '../cloud/authClient'
import { useSession } from '../cloud/useSession'
import { useOnlineStatus } from '../pwa/useOnlineStatus'
import { NAV_DESTINATIONS, activeDestinationFor, locationLabelFor, normalizePath } from './navDestinations'
import { NavigationGuardContext, type NavigationGuardRegistry } from './navigationGuard'

interface AppFrameProps {
  children: ComponentChildren
}

export function AppFrame({ children }: AppFrameProps) {
  // `useRouter()` acá es la SUSCRIPCIÓN a los cambios de ruta, no la fuente del valor. Montado
  // FUERA del `<Router>` (el contexto es el default global), el hook se registra en la lista de
  // suscriptores de preact-router y este componente se re-renderiza en cada navegación — que es lo
  // que un ancestro del router no consigue de otro modo.
  //
  // El VALOR sale de `getCurrentUrl()` porque en el primer render el estado del contexto todavía no
  // se actualizó: el `<Router>` es hijo, así que muta ese objeto durante su propio render (después
  // del nuestro) y la suscripción recién existe tras el efecto. `location` en cambio ya es verdad
  // en los dos casos: `route()` hace `pushState` ANTES de notificar.
  useRouter()
  const path = normalizePath(getCurrentUrl())
  const active = activeDestinationFor(path)
  const online = useOnlineStatus()
  const { user, pending } = useSession()

  // Registro de guards estable durante toda la vida del marco: si su identidad cambiara, el efecto
  // de `useNavigationGuard` (que la tiene como dependencia) daría de baja y volvería a registrar en
  // cada render del marco — y el marco re-renderiza en cada navegación y en cada cambio de sesión.
  const guardsRef = useRef<Set<() => void>>(new Set())
  const registryRef = useRef<NavigationGuardRegistry | null>(null)
  if (!registryRef.current) {
    const guards = guardsRef.current
    registryRef.current = {
      register(fn) {
        guards.add(fn)
        return () => {
          guards.delete(fn)
        }
      },
    }
  }

  /** Corre los cleanups registrados por la vista montada y navega. Un guard que lanza no puede
   * dejar al usuario encerrado en la pantalla: se registra y se sigue. */
  function navTo(to: string): void {
    for (const guard of guardsRef.current) {
      try {
        guard()
      } catch (e) {
        console.error('Guard de navegación falló:', e)
      }
    }
    route(to)
  }

  const destinations = NAV_DESTINATIONS.map((d) => (
    <button
      key={d.id}
      type="button"
      aria-current={active?.id === d.id ? 'page' : undefined}
      class={active?.id === d.id ? 'active' : ''}
      onClick={() => active?.id !== d.id && navTo(d.path)}
    >
      {d.label}
    </button>
  ))

  return (
    <NavigationGuardContext.Provider value={registryRef.current}>
      <div class="app-frame">
        <header class="topbar">
          <div class="topbar-brand">
            <button type="button" class="topbar-home" onClick={() => navTo('/')} title="Volver al menú">
              tengen
            </button>
            <span class="topbar-sep" aria-hidden="true">
              ·
            </span>
            <span class="topbar-location">{locationLabelFor(path)}</span>
            {/* Sin conexión NO es un error acá: el motor y los pesos están en el dispositivo, así que
                jugar y analizar siguen funcionando. Lo único que se apaga es el guardado en la nube. */}
            {!online && (
              <span
                class="offline-chip"
                title="El motor corre en tu dispositivo: puedes seguir jugando y analizando. No se guardará en la nube hasta que vuelva la conexión."
              >
                Sin conexión
              </span>
            )}
          </div>
          <div class="topbar-end">
            {/* Los destinos, forma ANCHA. El CSS lo apaga exactamente donde enciende `.appbar`, para
                que no exista un viewport sin ninguno de los dos. */}
            <nav class="segmented" aria-label="Ir a">
              {destinations}
            </nav>
            <SessionBadge user={user} pending={pending} />
          </div>
        </header>

        <div class="app-frame-main">{children}</div>

        {/* Los destinos, forma ANGOSTA Y ALTA. Se renderiza siempre (ver cabecera). */}
        <nav class="appbar" aria-label="Navegación principal">
          {destinations}
        </nav>
      </div>
    </NavigationGuardContext.Provider>
  )
}

interface SessionBadgeProps {
  user: { email: string; image?: string | null } | null
  pending: boolean
}

/** El estado de sesión, presente en TODA pantalla y no sólo en el menú. Lo que arregla es concreto:
 * jugando una partida no había forma de saber si estabas logueado, y sin sesión la partida no se
 * guarda en la nube sin que nada lo diga.
 *
 * Con sesión es un `<span>`, no un botón: el marco INFORMA el estado y la única acción que ofrece es
 * la que arregla el problema (loguearse). "Cerrar sesión" se queda en el menú a propósito — un toque
 * accidental sobre el chrome no puede desconectarte a mitad de una partida. */
function SessionBadge({ user, pending }: SessionBadgeProps) {
  // Mientras el get-session inicial vuela no se sabe nada, y afirmar "sin sesión" para corregirse
  // medio segundo después es peor que no decir nada (mismo criterio que el pie del menú).
  if (pending) return null
  if (user === null) {
    return (
      <button type="button" class="topbar-session" onClick={signInWithGoogle}>
        Iniciar sesión
      </button>
    )
  }
  const title = `Sesión iniciada como ${user.email}. Tus partidas se guardan en la nube.`
  return (
    <span class="topbar-session topbar-session--in" title={title}>
      {user.image ? (
        <img src={user.image} alt="" class="session-avatar" />
      ) : (
        // Sin foto de Google, la inicial del email. Presencia > exactitud: lo que el usuario tiene
        // que poder leer de un vistazo es "hay alguien logueado", no quién.
        <span class="session-avatar session-avatar--initial" aria-hidden="true">
          {user.email.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span class="topbar-session-email">{user.email}</span>
    </span>
  )
}
