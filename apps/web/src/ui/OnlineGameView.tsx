// Pantalla de una partida online — esqueleto (Task 5): conectando / no existe / esperando rival.
// El tablero de juego se suma en la Task 6 sobre este mismo componente.
//
// Vive FUERA del router y del gate de WebGPU (ver `online/onlineRoute.ts`), por eso tampoco usa
// `AppFrame` (suscrito al router: sus enlaces llaman `route()`, que sin `<Router>` no navega) y toda
// salida es un `<a href>` de verdad (navegación completa del documento).
import { useEffect, useMemo, useState } from 'preact/hooks'
import { project } from '@tengen/go-rules'
import type { StorageLike } from '../game/persistence'
import type { FetchLike } from '../online/identity'
import { connectRoom, type RoomConnectionState } from '../online/roomClient'

interface OnlineGameViewProps {
  roomId: string
  storage?: StorageLike
  socketFactory?: (url: string) => WebSocket
  fetchFn?: FetchLike
}

export function OnlineGameView({ roomId, storage, socketFactory, fetchFn }: OnlineGameViewProps) {
  const [conn, setConn] = useState<RoomConnectionState>({ status: 'connecting', events: [] })

  useEffect(() => {
    const handle = connectRoom(roomId, {
      storage: storage ?? window.localStorage,
      socketFactory,
      fetchFn,
      onState: setConn,
    })
    return () => handle.close()
    // Las dependencias inyectables sólo cambian en tests; la sala se reconecta por `roomId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  const phase = useMemo(() => (conn.events.length > 0 ? project(conn.events).phase : null), [conn.events])

  if (conn.status === 'not-found') {
    return (
      <main class="card-screen">
        <h1>Partida online</h1>
        <p class="notice notice--danger">Esta partida no existe o ya expiró</p>
        <div class="action-row">
          <a class="link-button primary" href="/jugar">
            Nueva partida
          </a>
        </div>
      </main>
    )
  }

  if (phase === 'waiting') {
    return (
      <main class="card-screen">
        <h1>Esperando rival</h1>
        <ShareLink roomId={roomId} />
      </main>
    )
  }

  if (phase === null) {
    return (
      <main class="card-screen">
        <h1>Partida online</h1>
        <p class="hint">Conectando…</p>
      </main>
    )
  }

  // playing / ended: el tablero llega en la Task 6.
  return (
    <main class="card-screen">
      <h1>Partida online</h1>
      <p class="hint">{conn.status === 'reconnecting' ? 'Reconectando…' : 'Partida en curso'}</p>
    </main>
  )
}

function ShareLink({ roomId }: { roomId: string }) {
  const url = `${window.location.origin}/online/${encodeURIComponent(roomId)}`
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator.share === 'function'

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      /* portapapeles bloqueado: el link sigue visible para copiarlo a mano */
    }
  }

  async function share(): Promise<void> {
    try {
      await navigator.share({ title: 'tengen', text: 'Te invito a una partida de Go', url })
    } catch {
      /* el usuario canceló el diálogo */
    }
  }

  return (
    <>
      <p class="hint">Pasale este link a tu rival. La partida empieza cuando entre.</p>
      <p class="notice notice--accent">{url}</p>
      <div class="action-row">
        <button type="button" class="primary" onClick={copy}>
          Copiar
        </button>
        {canShare && (
          <button type="button" class="ghost" onClick={share}>
            Compartir
          </button>
        )}
      </div>
      {copied && (
        <p class="hint" role="status">
          Link copiado
        </p>
      )}
    </>
  )
}
