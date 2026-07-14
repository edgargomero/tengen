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
import { Router, Link as RouterLink, route } from 'preact-router'
import type { RoutableProps } from 'preact-router'
import '@sabaki/shudan/css/goban.css'
import './styles/app.css'
import type { GameConfig } from './game/gameConfig'
import { validateConfig } from './game/gameConfig'
import type { GameTree } from './game/gameTree'
import { clearGame, loadGame } from './game/persistence'
import { signInWithGoogle, signOut } from './cloud/authClient'
import { useSession } from './cloud/useSession'
import { AnalyzeView } from './ui/AnalyzeView'
import { NewGameForm } from './ui/NewGameForm'
import { PlayView } from './ui/PlayView'
import { detectWebGpu } from './webgpu'

// El tipo de `Link` en preact-router@4.1.2 usa `HTMLAttributes` (sin `href`) en vez de
// `AnchorHTMLAttributes` — desactualizado frente a los tipos más granulares de preact@10.24
// instalados aquí. Re-tipado local en vez de tocar node_modules.
const Link = RouterLink as (props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>) => JSX.Element

function NoWebGpu() {
  return (
    <main class="no-webgpu">
      <h1>tengen</h1>
      <p>
        tengen necesita <strong>WebGPU</strong>. Abre esta página en <strong>Chrome o Edge</strong>{' '}
        recientes (WebGPU habilitado).
      </p>
    </main>
  )
}

interface Session {
  config: GameConfig
  /** Presente al restaurar desde localStorage o al importar un SGF; ausente en "Nueva partida". */
  initialTree?: GameTree
}

/** Intenta restaurar la partida guardada (síncrono: `localStorage.getItem` no es async, así que no
 * hace falta un efecto ni un estado "cargando" — se resuelve en el inicializador perezoso de
 * `useState`, sin parpadeo del formulario de nueva partida). `null` si no hay partida guardada, o
 * si la config reconstruida no pasa `validateConfig` (dato corrupto de una versión anterior: se
 * limpia y se arranca en "Nueva partida", nunca con una config a medio formar). */
function restoreSession(): Session | null {
  const restored = loadGame(window.localStorage)
  if (!restored) return null
  try {
    const config = validateConfig({
      boardSize: restored.tree.meta.boardSize,
      komi: restored.tree.meta.komi,
      rules: restored.tree.meta.rules,
      handicap: restored.tree.meta.handicap,
      opponent: restored.opponent,
    })
    return { config, initialTree: restored.tree }
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
      onNewGame={handleNewGame}
      onImport={handleImport}
      onBack={onBack}
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
        <main class="crash-recovery">
          <h1>tengen</h1>
          <p>Algo salió mal: {errorMessage(error)}</p>
          <button onClick={this.handleReset}>Nueva partida</button>
        </main>
      )
    }
    return this.props.children
  }
}

// ── Conmutador de modo Jugar/Analizar (Task 11), ruteo por URL (navegación + UX) ──────────────
// Se inserta ENTRE el gate de WebGPU y PlayApp/AnalyzeView: ambos modos lo necesitan, así que el
// gate sigue siendo lo primero (ver App() más abajo). La ruta decide el modo inicial (en vez de
// arrancar siempre en el menú); los 3 modos tienen botón "Volver" (`route('/')`), así que ya no
// hay modo sin salida.
function ModeApp() {
  return (
    <Router>
      <ModeMenu path="/" default />
      <PlayApp path="/jugar" onBack={() => route('/')} />
      <AnalyzeView path="/analizar" onBack={() => route('/')} />
    </Router>
  )
}

function ModeMenu(_props: RoutableProps) {
  const { user, pending } = useSession()
  return (
    <main class="mode-menu">
      <img src="/favicon.svg" alt="" class="mode-menu-icon" />
      <h1>tengen</h1>
      <p>¿Qué querés hacer?</p>
      <Link class="primary" href="/jugar">
        Jugar
      </Link>
      <Link href="/analizar">Analizar</Link>
      {user !== null && <Link href="/partidas">Mis partidas</Link>}
      {/* Login opcional (Fase 5): jugar/analizar sin cuenta sigue igual que siempre; loguearse
          solo habilita guardar/listar/reabrir en la nube. `pending` evita el parpadeo del botón
          de login mientras el get-session inicial está en vuelo. */}
      <div class="session-box">
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
    </main>
  )
}

function App() {
  const [webgpu, setWebgpu] = useState<boolean | null>(null)
  useEffect(() => {
    void detectWebGpu().then(setWebgpu)
  }, [])
  if (webgpu === null) {
    return (
      <main class="detecting">
        <p>detectando WebGPU…</p>
      </main>
    )
  }
  return webgpu ? <ModeApp /> : <NoWebGpu />
}

const root = document.getElementById('app')
if (root)
  render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
    root,
  )
