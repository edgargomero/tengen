// Entrada de la SPA (Fase 2, Task 4 + Task 5): shell del "Modo Jugar". Gate de WebGPU (igual que
// en Fase 0/1) y, detrás de él, restauración de partida guardada / formulario de nueva partida /
// pantalla de juego.
//
// ── Import/restore por remonte de PlayView (Task 5, decisión #1 del brief) ─────────────────────
// Tanto restaurar una partida guardada como importar un SGF (o iniciar una nueva) necesitan un
// `PlayView` FRESCO: árbol nuevo y `EngineManager` nuevo (el viejo debe `dispose()`arse, no
// reusarse — cambiar de `boardSize`/red a mitad de sesión no lo soporta `ReadyPlayView`, que crea
// esas instancias UNA vez por montaje). Preact solo desmonta+monta si el TIPO de elemento cambia o
// si su `key` cambia; como `PlayView` es siempre el mismo componente, `sessionKey` (un contador) es
// el mecanismo: se bumpea en cada transición de sesión y se pasa como `key={sessionKey}` en
// `<PlayView>` más abajo. Sin esto, `onImport`/"Nueva partida" solo actualizarían las PROPS del
// `PlayView` ya montado, y sus refs (`treeRef`/`managerRef`) — creados con `if (!ref.current)` —
// seguirían apuntando al árbol/motor VIEJOS: el import/restore serían un no-op silencioso (con fuga
// del `EngineManager` viejo, que solo se dispone en el cleanup del desmontaje real).
import { Component, render } from 'preact'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { BUILD_ID } from './buildInfo'
import { summarizeUserAgent } from './diagnostics/userAgent'
import { webGpuAdvice } from './diagnostics/webGpuAdvice'
import { PwaToast } from './pwa/PwaToast'
import { useServiceWorker } from './pwa/useServiceWorker'
import { Router, Link as RouterLink, route } from 'preact-router'
import type { RoutableProps } from 'preact-router'
import '@sabaki/shudan/css/goban.css'
import './styles/app.css'
import type { GameConfig } from './game/gameConfig'
import { validateConfig } from './game/gameConfig'
import type { GameTree } from './game/gameTree'
import { clearGame, isRankLevel, loadGame, saveGame } from './game/persistence'
import { importSgf } from './game/sgf'
import { signInWithGoogle, signOut } from './cloud/authClient'
import { takePendingOpen } from './cloud/pendingOpen'
import { useSession } from './cloud/useSession'
import { AnalyzeView } from './ui/AnalyzeView'
import { AppFrame } from './ui/AppFrame'
import { AppVersionFooter } from './ui/AppVersionFooter'
import { DiagnosticoView } from './ui/DiagnosticoView'
import { NewGameForm } from './ui/NewGameForm'
import { PartidasView } from './ui/PartidasView'
import { PlayView } from './ui/PlayView'
import { detectWebGpu } from './webgpu'
import type { WebGpuDetection } from './webgpu'

// El tipo de `Link` en preact-router@4.1.2 usa `HTMLAttributes` (sin `href`) en vez de
// `AnchorHTMLAttributes` — desactualizado frente a los tipos más granulares de preact@10.24
// instalados aquí. Re-tipado local en vez de tocar node_modules.
const Link = RouterLink as (props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>) => JSX.Element

/** Ruta de la pantalla de diagnóstico. Se resuelve por `pathname`, fuera del router — ver `Root`. */
const DIAGNOSTICO_PATH = '/diagnostico'

/** El cartel del gate. Dice el MOTIVO, da un consejo que depende del dispositivo, y ofrece la salida:
 * sin el enlace al diagnóstico, alguien a quien la app no le arranca queda en una pantalla sin ninguna
 * acción posible, que es el estado en el que un iPhone nos dejó sin datos para depurar.
 *
 * El consejo NO puede ser genérico. "Abre esta página en Chrome o Edge" es, en un iPhone, el consejo
 * exactamente contrario al correcto: ahí Chrome corre sobre WKWebView, que no expone WebGPU hasta iOS 26,
 * mientras Safari sí puede. Confirmado con el volcado de un iPhone 12 real — ver `webGpuAdvice.ts`. */
function NoWebGpu({ reason }: { reason: string }) {
  // Lectura del UA en el punto de PRESENTACIÓN, no dentro de `detectWebGpu()`: el gate sigue siendo un
  // gate (una pregunta, una respuesta) y no toma decisiones por navegador.
  const advice = webGpuAdvice(
    summarizeUserAgent({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }),
  )
  return (
    <main class="system-screen system-screen--centered">
      <h1>tengen</h1>
      <p>
        tengen necesita <strong>WebGPU</strong>.
      </p>
      {advice.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <p class="system-note">{reason}</p>
      {/* `<a href>` y no `<Link>`: el router vive dentro del gate, así que desde acá no existe. */}
      <a class="link-button" href={DIAGNOSTICO_PATH}>
        Ver diagnóstico
      </a>
    </main>
  )
}

interface Session {
  config: GameConfig
  /** Presente al restaurar desde localStorage o al importar un SGF; ausente en "Nueva partida". */
  initialTree?: GameTree
  /** Id de D1 (Fase 5): presente si la partida restaurada ya vivía en la nube — ver persistence.ts. */
  cloudId?: string
}

/** Intenta restaurar la partida guardada (síncrono: `localStorage.getItem` no es async, así que no
 * hace falta un efecto ni un estado "cargando" — se resuelve en el inicializador perezoso de
 * `useState`, sin parpadeo del formulario de nueva partida). `null` si no hay partida guardada, o
 * si la config reconstruida no pasa `validateConfig` (dato corrupto de una versión anterior: se
 * limpia y se arranca en "Nueva partida", nunca con una config a medio formar). */
/** Fase 5 Task 6 (decisión 3 del plan): reabrir desde "Mis partidas" tiene prioridad sobre la
 * partida local — `PartidasView` deja el pendingOpen y navega a `/jugar` ANTES de que este
 * componente monte. Espeja el resultado a localStorage DE INMEDIATO (con el `cloudId`): sin esto,
 * un refresh antes de la primera jugada restauraría la partida local vieja en vez de la recién
 * reabierta; con esto, el refresh post-reapertura funciona gratis por el camino normal de abajo. */
function restoreFromPendingOpen(): Session | null {
  const pendingGame = takePendingOpen('jugar')
  if (!pendingGame) return null
  try {
    const tree = importSgf(pendingGame.sgf)
    // Deja el cursor en el tip de la línea principal (mismo criterio que el import manual de SGF
    // en PlayView.handleImportFile): D1 no guarda el cursor exacto, solo el SGF.
    while (tree.toChild(0)) {
      /* avanza hasta el tip */
    }
    if (!isRankLevel(pendingGame.opponent)) {
      throw new Error('opponent inválido en la partida reabierta')
    }
    const config = validateConfig({
      boardSize: tree.meta.boardSize,
      komi: tree.meta.komi,
      rules: tree.meta.rules,
      handicap: tree.meta.handicap,
      opponent: pendingGame.opponent,
      // El SGF de D1 ya trae el color (vía TGHC): reabrir desde "Mis partidas" conserva tu color.
      humanColor: tree.meta.humanColor,
    })
    try {
      saveGame(window.localStorage, config.opponent, tree, pendingGame.id)
    } catch {
      // Best-effort, mismo espíritu que el resto de saveGame/persist.
    }
    return { config, initialTree: tree, cloudId: pendingGame.id }
  } catch {
    // Partida reabierta corrupta/con datos inválidos: cae al camino normal de abajo (localStorage
    // local), en vez de dejar la SPA en blanco.
    return null
  }
}

function restoreSession(): Session | null {
  const fromPendingOpen = restoreFromPendingOpen()
  if (fromPendingOpen) return fromPendingOpen

  const restored = loadGame(window.localStorage)
  if (!restored) return null
  try {
    const config = validateConfig({
      boardSize: restored.tree.meta.boardSize,
      komi: restored.tree.meta.komi,
      rules: restored.tree.meta.rules,
      handicap: restored.tree.meta.handicap,
      opponent: restored.opponent,
      // El color viaja en el SGF persistido (TGHC): recargar conserva tu color, no re-sortea nigiri.
      humanColor: restored.tree.meta.humanColor,
    })
    return { config, initialTree: restored.tree, cloudId: restored.cloudId }
  } catch {
    clearGame(window.localStorage)
    return null
  }
}

function PlayApp({ onBack }: { onBack(): void } & RoutableProps) {
  const [session, setSession] = useState<Session | null>(restoreSession)
  // Bumpea en CADA transición de sesión (nueva partida / import / "Nueva partida"): ver nota de
  // cabecera. Arranca en 0 y no importa su valor exacto, solo que cambie.
  const [sessionKey, setSessionKey] = useState(0)

  function handleStart(config: GameConfig): void {
    setSession({ config })
    setSessionKey((k) => k + 1)
  }

  function handleImport(config: GameConfig, tree: GameTree): void {
    setSession({ config, initialTree: tree })
    setSessionKey((k) => k + 1)
  }

  function handleNewGame(): void {
    try {
      clearGame(window.localStorage)
    } catch {
      // Best-effort: un storage bloqueado no debe impedir volver al formulario.
    }
    setSession(null)
    setSessionKey((k) => k + 1)
  }

  if (session === null) {
    return <NewGameForm onStart={handleStart} onBack={onBack} />
  }
  return (
    <PlayView
      key={sessionKey}
      config={session.config}
      initialTree={session.initialTree}
      cloudId={session.cloudId}
      onNewGame={handleNewGame}
      onImport={handleImport}
    />
  )
}

/** Mensaje legible de un `unknown` atrapado (mismo patrón que `errorMessage` en PlayView.tsx). */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

interface ErrorBoundaryState {
  error: unknown
}

/**
 * FIX 1 parte 2 (Important, fix wave post-Fase 2): red de última instancia. La validación in-try de
 * `PlayView.handleImportFile` (FIX 1 parte 1) cubre el import de un SGF ilegal en el momento en que
 * se importa, pero NO cubre variaciones importadas ilegales que sólo se descubren al NAVEGAR a
 * ellas después (`GameTree.boardAt()`/`boardFromMoves` lanza recién ahí, en pleno render) — ni
 * cualquier otro throw de render no previsto. Sin este boundary, Preact no re-renderiza tras un
 * throw de render y la SPA queda en blanco, sin forma de recuperarse salvo recargar. Degrada a un
 * mensaje recuperable + "Nueva partida" (que limpia la partida guardada y recarga desde cero) en vez
 * de pantalla blanca. NO sustituye a la validación in-try (que da el mensaje en el punto de origen,
 * sin perder el resto de la sesión); es el respaldo para lo que se cuele.
 */
class ErrorBoundary extends Component<{ children: ComponentChildren }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown): void {
    // Único diagnóstico disponible: no hay telemetría en Fase 2.
    console.error('Error no capturado en la SPA:', error)
  }

  handleReset = (): void => {
    try {
      clearGame(window.localStorage)
    } catch {
      // Best-effort: un storage bloqueado no debe impedir volver al formulario.
    }
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (error !== null) {
      return (
        <main class="system-screen system-screen--centered">
          <h1>tengen</h1>
          <p class="notice notice--danger">Algo salió mal: {errorMessage(error)}</p>
          <button onClick={this.handleReset}>Nueva partida</button>
        </main>
      )
    }
    return this.props.children
  }
}

// ── Ruteo por URL + marco de navegación ────────────────────────────────────────────────────────
// Se inserta ENTRE el gate de WebGPU y PlayApp/AnalyzeView: todas las pantallas lo necesitan, así
// que el gate sigue siendo lo primero (ver App() más abajo). La ruta decide qué se monta.
//
// `AppFrame` envuelve al `<Router>`, no al revés, y ahí está el punto entero del cambio: el marco
// (ubicación, salida, destinos, sesión, chip de conexión) lo hereda toda ruta PRESENTE Y FUTURA sin
// hacer nada. Antes lo montaban las vistas —`PlayView` y `AnalyzeView` eran sus dos únicos usos—,
// así que las cuatro pantallas sin tablero quedaron sin ningún chrome. Ver el alcance declarado en
// `AppFrame.tsx`: lo que queda fuera (diagnóstico, cartel de sin-WebGPU) es deliberado.
function ModeApp() {
  return (
    <AppFrame>
      <Router>
        <ModeMenu path="/" default />
        <PlayApp path="/jugar" onBack={() => route('/')} />
        <AnalyzeView path="/analizar" onBack={() => route('/')} />
        <PartidasView path="/partidas" />
      </Router>
    </AppFrame>
  )
}

function ModeMenu(_props: RoutableProps) {
  const { user, pending } = useSession()
  // Se suscribe al MISMO singleton que `Root` (ver `pwa/swController.ts`): dos llamadas al hook no
  // registran el service worker dos veces.
  const sw = useServiceWorker()
  return (
    <main class="card-screen mode-menu">
      <img src="/favicon.svg" alt="" class="mode-menu-icon" />
      <h1>tengen</h1>
      <p>¿Qué quieres hacer?</p>
      {/* `.link-button` explícito, no heredado de un `.mode-menu a`: ver el átomo en app.css. */}
      <Link class="link-button primary" href="/jugar">
        Jugar
      </Link>
      <Link class="link-button" href="/analizar">
        Analizar
      </Link>
      {user !== null && (
        <Link class="link-button" href="/partidas">
          Mis partidas
        </Link>
      )}
      {/* Login opcional (Fase 5): jugar/analizar sin cuenta sigue igual que siempre; loguearse
          solo habilita guardar/listar/reabrir en la nube. `pending` evita el parpadeo del botón
          de login mientras el get-session inicial está en vuelo. */}
      <div class="menu-footer menu-footer--session">
        {pending ? null : user !== null ? (
          <>
            <span class="session-identity">
              {user.image ? <img src={user.image} alt="" class="session-avatar" /> : null}
              {user.email}
            </span>
            <button onClick={signOut}>Cerrar sesión</button>
          </>
        ) : (
          <button onClick={signInWithGoogle}>Iniciar sesión con Google</button>
        )}
      </div>
      {/* Qué versión corre este dispositivo + chequeo manual. El menú es el lugar: es la única
          pantalla sin tablero ni reloj, así que nada de esto compite con la partida. */}
      <AppVersionFooter
        buildId={BUILD_ID}
        checkState={sw.checkState}
        updateReady={sw.updateReady}
        onCheck={sw.checkForUpdate}
      />
    </main>
  )
}

function App() {
  // `null` sigue significando "todavía detectando" (no colapsar el tri-estado en `detection.ok`: si no,
  // habría un parpadeo del cartel de WebGPU en cada carga, antes de saber la respuesta).
  const [detection, setDetection] = useState<WebGpuDetection | null>(null)
  useEffect(() => {
    void detectWebGpu().then(setDetection)
  }, [])
  if (detection === null) {
    return (
      <main class="system-screen system-screen--centered">
        <p class="system-note">Detectando WebGPU…</p>
      </main>
    )
  }
  return detection.ok ? <ModeApp /> : <NoWebGpu reason={detection.reason} />
}

/** Raíz de la app + avisos de la PWA. El service worker se registra acá, FUERA del gate de WebGPU:
 * el precache del shell es útil incluso en un navegador sin WebGPU (la pantalla que explica por qué
 * hace falta Chrome también debería abrir sin conexión), y registrar más adentro lo ataría a un
 * árbol que se desmonta al cambiar de modo. */
function Root() {
  const sw = useServiceWorker()
  const [offlineToast, setOfflineToast] = useState(true)
  // El diagnóstico se decide ACÁ, antes del gate de WebGPU y antes incluso de la pantalla "Detectando
  // WebGPU…": en un dispositivo donde `requestAdapter()` no resuelve nunca, `App` se queda en ese estado
  // para siempre — y ese es exactamente el aparato que hay que diagnosticar. Se compara el `pathname` en
  // vez de usar el router porque el router vive DENTRO del gate. Como se llega con `<a href>` (navegación
  // completa del documento), el valor no cambia mientras este componente está montado.
  const diagnostico = window.location.pathname === DIAGNOSTICO_PATH
  return (
    <>
      {diagnostico ? <DiagnosticoView /> : <App />}
      <PwaToast
        updateReady={sw.updateReady}
        offlineReady={sw.offlineReady && offlineToast}
        onUpdate={sw.update}
        onDismiss={sw.dismiss}
        onDismissOfflineReady={() => setOfflineToast(false)}
      />
    </>
  )
}

const root = document.getElementById('app')
if (root)
  render(
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>,
    root,
  )
