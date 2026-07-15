// Pantalla "Mis partidas" (Fase 5 Task 6): lista las partidas guardadas del usuario y reabre una
// en el modo correcto. Solo útil con sesión activa — sin ella, invita a loguearse (mismo patrón
// que el resto de la app: nunca un callejón sin salida, siempre un "Volver").
import { useEffect, useState } from 'preact/hooks'
import type { RoutableProps } from 'preact-router'
import { route } from 'preact-router'
import type { FetchLike, GameSummary } from '../cloud/api'
import { getGame, listGames } from '../cloud/api'
import { signInWithGoogle } from '../cloud/authClient'
import { setPendingOpen } from '../cloud/pendingOpen'
import { useSession } from '../cloud/useSession'

/** fetch del browser, sin envoltorio inyectable: este componente no tiene test Node (el repo no
 * testea UI — ver Task 4), así que no hace falta la indirección que sí usa gameSync.ts. */
const browserFetch: FetchLike = (input, init) => fetch(input, init)

const MODE_LABELS: Record<GameSummary['mode'], string> = { jugar: 'Jugar', analizar: 'Analizar' }

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Fecha corta para la columna "Fecha" de la tabla (mismo formato que el resto de la app). */
function formatDate(epochMs: number): string {
  const d = new Date(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface PartidasViewProps extends RoutableProps {
  onBack(): void
}

export function PartidasView({ onBack }: PartidasViewProps) {
  const { user, pending: sessionPending } = useSession()
  const [games, setGames] = useState<GameSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)

  function load(): void {
    setError(null)
    setGames(null)
    listGames(browserFetch).then(
      setGames,
      (e: unknown) => setError(`No se pudo cargar "Mis partidas" (${errorMessage(e)}).`),
    )
  }

  useEffect(() => {
    if (user !== null) load()
    // Recarga si la sesión pasa de nula a activa (p.ej. login en otra pestaña); `user` como única
    // dependencia evita re-listar en cada render por otras razones (openingId, etc).
  }, [user])

  function handleOpen(g: GameSummary): void {
    if (openingId !== null) return // evita doble click mientras la primera apertura está en vuelo
    setOpeningId(g.id)
    setError(null)
    getGame(browserFetch, g.id).then(
      (full) => {
        setPendingOpen({ id: full.id, mode: full.mode, sgf: full.sgf, opponent: full.opponent ?? undefined })
        route(full.mode === 'jugar' ? '/jugar' : '/analizar')
      },
      (e: unknown) => {
        setOpeningId(null)
        setError(`No se pudo abrir la partida (${errorMessage(e)}).`)
      },
    )
  }

  if (sessionPending) {
    return (
      <main class="partidas-view">
        <p>Cargando…</p>
      </main>
    )
  }

  if (user === null) {
    return (
      <main class="partidas-view">
        <h1>Mis partidas</h1>
        <p>Iniciá sesión con Google para ver tus partidas guardadas en la nube.</p>
        <button class="primary" onClick={signInWithGoogle}>
          Iniciar sesión con Google
        </button>
        <button onClick={onBack}>Volver</button>
      </main>
    )
  }

  return (
    <main class="partidas-view">
      <h1>Mis partidas</h1>
      {error !== null && (
        <p class="play-error">
          {error} <button onClick={load}>Reintentar</button>
        </p>
      )}
      {games === null && error === null && <p>Cargando…</p>}
      {games !== null && games.length === 0 && <p>Todavía no guardaste ninguna partida.</p>}
      {games !== null && games.length > 0 && (
        <table class="partidas-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Fecha</th>
              <th>Tamaño</th>
              <th>Resultado</th>
              <th>Modo</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.id} onClick={() => handleOpen(g)} class={openingId === g.id ? 'opening' : ''}>
                <td>{g.name}</td>
                <td>{formatDate(g.updatedAt)}</td>
                <td>
                  {g.boardSize}×{g.boardSize}
                </td>
                <td>{g.result ?? '—'}</td>
                <td>{MODE_LABELS[g.mode]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={onBack}>Volver</button>
    </main>
  )
}
