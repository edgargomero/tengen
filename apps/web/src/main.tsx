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
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import '@sabaki/shudan/css/goban.css'
import './styles/app.css'
import type { GameConfig } from './game/gameConfig'
import { validateConfig } from './game/gameConfig'
import type { GameTree } from './game/gameTree'
import { clearGame, loadGame } from './game/persistence'
import { NewGameForm } from './ui/NewGameForm'
import { PlayView } from './ui/PlayView'
import { detectWebGpu } from './webgpu'

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

function PlayApp() {
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
    return <NewGameForm onStart={handleStart} />
  }
  return (
    <PlayView
      key={sessionKey}
      config={session.config}
      initialTree={session.initialTree}
      onNewGame={handleNewGame}
      onImport={handleImport}
    />
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
  return webgpu ? <PlayApp /> : <NoWebGpu />
}

const root = document.getElementById('app')
if (root) render(<App />, root)
