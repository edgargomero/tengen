// Pantalla de una partida online: conectando / no existe / llena / abierta en otro dispositivo /
// esperando rival (con elección de asiento para quien llega a una sala sin invitado) / partida en
// juego (jugadores y espectadores) / conteo / fin con descarga de SGF.
//
// Vive FUERA del router y del gate de WebGPU (ver `online/onlineRoute.ts`), por eso no usa `AppFrame`
// (suscrito al router: sus enlaces llaman `route()`, que sin `<Router>` no navega) sino `OnlineFrame`,
// que repite su encabezado con las mismas clases y la marca como `<a href="/">`; envuelve TODAS las
// pantallas. Toda salida es un `<a href>` de verdad (navegación completa del documento).
//
// Elegir asiento: quien entra a una sala en espera sin tener asiento llega como espectador; el
// servidor sólo le da el asiento libre de invitado si lo pide (`joinAsPlayer` → `join=1`), así que la
// pantalla ofrece "Jugar contra tu rival" o "Solo mirar". `replaced`: el mismo dueño abrió el asiento
// en otra pestaña o dispositivo y el servidor cerró éste (4001); es terminal.
//
// La verdad vive en el servidor: el tablero se dibuja SOLO desde el log de eventos proyectado, sin
// jugada optimista — la piedra aparece cuando llega el evento `move`. La cuenta regresiva del reloj
// es puro display (`displayClock`); quien decide un timeout es el Durable Object.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import type { Marker } from '@sabaki/shudan'
import type { StoneColor } from '@tengen/engine/types'
import { boardFromMoves, capturesOf, ownershipMap, project, scoreGame, scoringDeadline, signMapOf } from '@tengen/go-rules'
import type { Intent, RejectReason, RoomState } from '@tengen/go-rules'
import type { StorageLike } from '../game/persistence'
import { displayClock, formatClockMs } from '../game/clockFormat'
import type { FetchLike } from '../online/identity'
import { connectRoom, type RoomConnectionState } from '../online/roomClient'
import { roomToSgf } from '../online/roomSgf'
import { flaggedColor, rejectMessage, resultText, scoreLines } from '../online/roomText'
import { OnlineFrame } from './OnlineFrame'
import { useBoundedBoardSize, type BoundedBoardSize } from './useBoundedBoardSize'

const VERTEX_SIZE = { 9: 70, 13: 50, 19: 38 } as const

interface OnlineGameViewProps {
  roomId: string
  storage?: StorageLike
  socketFactory?: (url: string) => WebSocket
  fetchFn?: FetchLike
  /** Sólo tests: jsdom no mide layout, así que se inyecta la caja del tablero. */
  boardBounds?: BoundedBoardSize
}

export function OnlineGameView({ roomId, storage, socketFactory, fetchFn, boardBounds }: OnlineGameViewProps) {
  const [conn, setConn] = useState<RoomConnectionState>({ status: 'connecting', events: [], rejectCount: 0, serverOffsetMs: 0 })
  const sendRef = useRef<((intent: Intent) => RejectReason | null) | null>(null)
  const joinRef = useRef<(() => void) | null>(null)
  // "Solo mirar": el visitante declinó el asiento de invitado y queda en la espera de espectador.
  const [watchOnly, setWatchOnly] = useState(false)

  useEffect(() => {
    const handle = connectRoom(roomId, {
      storage: storage ?? window.localStorage,
      socketFactory,
      fetchFn,
      onState: setConn,
    })
    sendRef.current = handle.send
    joinRef.current = handle.joinAsPlayer
    return () => {
      sendRef.current = null
      joinRef.current = null
      handle.close()
    }
    // Las dependencias inyectables sólo cambian en tests; la sala se reconecta por `roomId`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  const state = useMemo(() => (conn.events.length > 0 ? project(conn.events) : null), [conn.events])

  if (conn.status === 'not-found') {
    return (
      <OnlineFrame>
        <main class="card-screen mode-menu">
          <h1>Partida online</h1>
          <p class="notice notice--danger">Esta partida no existe o ya expiró</p>
          <div class="action-row">
            <a class="link-button primary" href="/jugar">
              Nueva partida
            </a>
          </div>
        </main>
      </OnlineFrame>
    )
  }

  if (conn.status === 'replaced') {
    return (
      <OnlineFrame>
        <main class="card-screen mode-menu">
          <h1>Partida online</h1>
          <p class="notice notice--danger">Abriste esta partida en otra pestaña o dispositivo</p>
          <div class="action-row">
            <a class="link-button primary" href="/jugar">
              Nueva partida
            </a>
          </div>
        </main>
      </OnlineFrame>
    )
  }

  if (conn.status === 'full') {
    return (
      <OnlineFrame>
        <main class="card-screen mode-menu">
          <h1>Partida online</h1>
          <p class="notice notice--danger">La sala está llena</p>
          <div class="action-row">
            <a class="link-button primary" href="/jugar">
              Nueva partida
            </a>
          </div>
        </main>
      </OnlineFrame>
    )
  }

  if (state === null) {
    return (
      <OnlineFrame>
        <main class="card-screen mode-menu">
          <h1>Partida online</h1>
          <p class="hint">Conectando…</p>
        </main>
      </OnlineFrame>
    )
  }

  if (state.phase === 'waiting') {
    // Espectador en una sala sin invitado: puede tomar el asiento libre o quedarse mirando.
    if (conn.seat === 'spectator' && !watchOnly) {
      return (
        <OnlineFrame>
          <main class="card-screen mode-menu">
            <h1>Esta partida espera un rival</h1>
            <p class="hint">Todavía no tiene invitado: podés ser el rival o sólo mirar.</p>
            <div class="action-row">
              <button type="button" class="primary" onClick={() => joinRef.current?.()}>
                Jugar contra tu rival
              </button>
              <button type="button" class="ghost" onClick={() => setWatchOnly(true)}>
                Solo mirar
              </button>
            </div>
          </main>
        </OnlineFrame>
      )
    }
    return (
      <OnlineFrame>
        <main class="card-screen mode-menu">
          <h1>Esperando rival</h1>
          <ShareLink roomId={roomId} />
        </main>
      </OnlineFrame>
    )
  }

  return (
    <OnlineFrame>
      <RoomBoard
        state={state}
        conn={conn}
        boardBounds={boardBounds}
        send={(intent) => (sendRef.current ? sendRef.current(intent) : 'illegal')}
      />
    </OnlineFrame>
  )
}

const colorName = (c: StoneColor): string => (c === 'black' ? 'Negro' : 'Blanco')

interface RoomBoardProps {
  state: RoomState
  conn: RoomConnectionState
  boardBounds?: BoundedBoardSize
  send(intent: Intent): RejectReason | null
}

/** Tablero + rail de una partida ya empezada. Componente aparte para que `useBoundedBoardSize`
 * monte con el `.study-board` ya en el DOM (el hook mide una sola vez al montar). */
function RoomBoard({ state, conn, boardBounds, send }: RoomBoardProps) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const measured = useBoundedBoardSize(boardRef)
  const bounds = boardBounds ?? measured
  const [hint, setHint] = useState<string | null>(null)
  const [confirmingResign, setConfirmingResign] = useState(false)
  const [, setTick] = useState(0)

  const { boardSize, handicap, clock } = state.config
  const seat = conn.seat
  const isPlayer = seat === 'creator' || seat === 'guest'
  const myColor = isPlayer ? state.colors?.[seat] : undefined
  const playing = state.phase === 'playing'
  const scoring = state.phase === 'scoring'
  const open = conn.status === 'open'
  const myTurn = playing && myColor !== undefined && myColor === state.toPlay
  const eventCount = conn.events.length

  // Un evento nuevo (jugada propia, del rival o fin) deja obsoleto cualquier aviso anterior.
  const seenEvents = useRef(eventCount)
  useEffect(() => {
    if (seenEvents.current === eventCount) return
    seenEvents.current = eventCount
    setHint(null)
  }, [eventCount])
  // El rechazo del servidor llega por `conn.lastRejected`; se dispara por el contador (no por el
  // motivo) para que el mismo rechazo dos veces seguidas se vuelva a mostrar.
  useEffect(() => {
    if (conn.rejectCount > 0 && conn.lastRejected) setHint(rejectMessage(conn.lastRejected))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.rejectCount])
  useEffect(() => {
    if (!playing && !scoring) setConfirmingResign(false)
  }, [playing, scoring])

  // Cuenta regresiva: sólo repinta; el valor sale de `turnStartedAt` del estado proyectado.
  const ticking = playing && clock !== undefined
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [ticking])
  // Conteo: la cuenta regresiva de 5 min también es puro display; el que decide es la alarm del DO.
  useEffect(() => {
    if (!scoring) return
    const id = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [scoring])

  const board = useMemo(() => boardFromMoves(boardSize, handicap, state.moves), [boardSize, handicap, state.moves])
  const signMap = useMemo(() => signMapOf(board), [board])
  const captures = useMemo(() => capturesOf(board), [board])
  const markerMap = useMemo(() => {
    const map: (Marker | null)[][] = Array.from({ length: boardSize }, () => Array<Marker | null>(boardSize).fill(null))
    const last = state.moves[state.moves.length - 1]
    if (last && last.vertex !== 'pass') {
      const row = map[last.vertex.y]
      if (row) row[last.vertex.x] = { type: 'circle' }
    }
    return map
  }, [boardSize, state.moves])

  // Muertas y territorio se ven en el conteo y en un final POR conteo (`state.score`). Condicionar a
  // `score` y no a `ended`: una rendición durante el conteo o un B+F/W+F dejan `state.dead` poblado
  // pero sin puntaje, y pintarlas ahí mostraría un conteo que nadie acordó.
  const showCount = scoring || (state.phase === 'ended' && state.score !== undefined)
  const dimmed = useMemo<[number, number][]>(() => (showCount ? state.dead.map((v) => [v.x, v.y]) : []), [showCount, state.dead])
  const paintMap = useMemo(
    () => (showCount ? ownershipMap({ boardSize, handicap, moves: state.moves, dead: state.dead }) : undefined),
    [showCount, boardSize, handicap, state.moves, state.dead],
  )
  const liveScore = useMemo(
    () => (scoring ? scoreLines(scoreGame({ boardSize, handicap, moves: state.moves, dead: state.dead, rules: state.rules, komi: state.config.komi })) : null),
    [scoring, boardSize, handicap, state.moves, state.dead, state.rules, state.config.komi],
  )
  const endScore = state.phase === 'ended' && state.score ? scoreLines(state.score) : null
  const deadline = scoringDeadline(state)
  const countdownMs = deadline === undefined ? null : Math.max(0, deadline - (Date.now() + conn.serverOffsetMs))

  function sendIntent(intent: Intent): void {
    setHint(null)
    const rejected = send(intent)
    if (rejected) setHint(rejectMessage(rejected))
  }

  function handleVertexClick(v: [number, number]): void {
    if (!isPlayer || !open) return
    if (scoring) {
      // Sólo las piedras se marcan: tocar un punto vacío no hace nada.
      if (signMap[v[1]]?.[v[0]]) sendIntent({ type: 'toggle-dead', x: v[0], y: v[1], seq: state.nextSeq })
      return
    }
    if (!playing) return
    sendIntent({ type: 'move', x: v[0], y: v[1], seq: state.nextSeq })
  }

  function displayedClock(color: StoneColor) {
    if (!clock || !state.clocks) return null
    // Perdió por tiempo: el último valor guardado es el de su jugada anterior; se muestra en cero.
    const flagged = flaggedColor(state)
    if (flagged === color) return { ms: 0, periodsRemaining: 0, inByoyomi: false }
    const live = ticking && state.toPlay === color && state.turnStartedAt !== undefined
    // Hora del servidor estimada: el reloj del cliente puede estar adelantado o atrasado.
    const elapsed = live ? Math.max(0, Date.now() + conn.serverOffsetMs - state.turnStartedAt!) : 0
    return displayClock(state.clocks[color], clock, elapsed)
  }

  function downloadSgf(): void {
    const blob = new Blob([roomToSgf(state)], { type: 'application/x-go-sgf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    a.href = url
    a.download = `tengen-online-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.sgf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const opponentSeat = seat === 'creator' ? 'guest' : 'creator'
  const opponentAbsent = isPlayer && playing && conn.presence !== undefined && !conn.presence[opponentSeat]

  const playerLine = (color: StoneColor) => {
    const label = myColor === undefined ? colorName(color) : `${colorName(color)} (${color === myColor ? 'vos' : 'rival'})`
    const dc = displayedClock(color)
    return (
      <p class={playing && state.toPlay === color ? 'play-clock-active' : ''}>
        <span class="eyebrow">{label}</span>
        {dc && (
          <span class="play-clock-value">
            {formatClockMs(dc.ms)}
            {dc.inByoyomi && ` · byoyomi ${dc.periodsRemaining}`}
          </span>
        )}
      </p>
    )
  }

  const myAccepted = myColor !== undefined && state.accepted[myColor]
  const rivalAccepted = myColor !== undefined && state.accepted[myColor === 'black' ? 'white' : 'black']

  // Confirmación inline de la rendición: la misma en juego y en conteo.
  const resignConfirm = (
    <>
      <p class="hint">¿Seguro que querés rendirte?</p>
      <div class="action-row">
        <button
          type="button"
          class="primary"
          disabled={!open}
          onClick={() => {
            setConfirmingResign(false)
            sendIntent({ type: 'resign', seq: state.nextSeq })
          }}
        >
          Sí, rendirme
        </button>
        <button type="button" class="ghost" onClick={() => setConfirmingResign(false)}>
          Cancelar
        </button>
      </div>
    </>
  )

  const turnText = scoring
    ? 'Conteo'
    : !playing
    ? 'Partida terminada'
    : myColor === undefined
      ? `Turno de ${colorName(state.toPlay ?? 'black')}`
      : myTurn
        ? 'Tu turno'
        : 'Turno del rival'

  return (
    <div class="study-shell">
      <div class="study-main">
        <div class="study-board" ref={boardRef}>
          {bounds && (
            <BoundedGoban
              signMap={signMap}
              markerMap={markerMap}
              dimmedVertices={dimmed}
              paintMap={paintMap}
              maxWidth={bounds.maxWidth}
              maxHeight={bounds.maxHeight}
              maxVertexSize={VERTEX_SIZE[boardSize]}
              showCoordinates
              onVertexClick={(_evt, v) => handleVertexClick(v)}
            />
          )}
        </div>
        <aside class="study-rail">
          <div class="rail-header">
            <div class="play-clock">
              {playerLine('black')}
              {playerLine('white')}
            </div>
            <p class="play-turn">{turnText}</p>
            <div class="rail-meta">
              <p class="meta-row">
                <span class="eyebrow">Capturas</span>
                <span>
                  ● {captures.black} · ○ {captures.white}
                </span>
              </p>
            </div>
            {seat === 'spectator' && (
              <p class="notice notice--accent">Esta partida ya tiene dos jugadores: estás mirando</p>
            )}
            {conn.status === 'reconnecting' && <p class="notice notice--danger">Reconectando…</p>}
            {opponentAbsent && <p class="notice notice--danger">Rival desconectado</p>}
            {hint !== null && (
              <p class="notice notice--danger" role="status">
                {hint}
              </p>
            )}
            {liveScore && (
              <div class="rail-meta">
                <p class="hint">{liveScore.black}</p>
                <p class="hint">{liveScore.white}</p>
              </div>
            )}
            {scoring && countdownMs !== null && (
              <p class="meta-row">
                <span class="eyebrow">Tiempo para acordar</span>
                <span class="play-clock-value">{formatClockMs(countdownMs)}</span>
              </p>
            )}
            {scoring && isPlayer && rivalAccepted && <p class="notice notice--accent">El rival aceptó</p>}
            {scoring && !isPlayer && (state.accepted.black || state.accepted.white) && (
              <p class="notice notice--accent">
                {[state.accepted.black && 'Negro aceptó', state.accepted.white && 'Blanco aceptó'].filter(Boolean).join(' · ')}
              </p>
            )}
            {state.phase === 'ended' && state.result !== undefined && (
              <p class="notice notice--accent">
                <strong>{resultText(state.result)}</strong>
              </p>
            )}
            {endScore && (
              <div class="rail-meta">
                <p class="hint">{endScore.black}</p>
                <p class="hint">{endScore.white}</p>
              </div>
            )}
          </div>

          {isPlayer && playing && (
            <div class="rail-footer">
              {confirmingResign ? (
                resignConfirm
              ) : (
                <div class="action-row">
                  <button type="button" disabled={!open || !myTurn} onClick={() => sendIntent({ type: 'pass', seq: state.nextSeq })}>
                    Pasar
                  </button>
                  <button type="button" disabled={!open} onClick={() => setConfirmingResign(true)}>
                    Rendirse
                  </button>
                </div>
              )}
            </div>
          )}

          {isPlayer && scoring && (
            <div class="rail-footer">
              {confirmingResign ? (
                resignConfirm
              ) : (
                <div class="action-row">
                  <button
                    type="button"
                    class="primary"
                    disabled={!open || myAccepted}
                    onClick={() => sendIntent({ type: 'accept', seq: state.nextSeq })}
                  >
                    {myAccepted ? 'Aceptaste, esperando al rival' : 'Aceptar'}
                  </button>
                  <button type="button" disabled={!open} onClick={() => sendIntent({ type: 'resume', seq: state.nextSeq })}>
                    Seguir jugando
                  </button>
                  <button type="button" disabled={!open} onClick={() => setConfirmingResign(true)}>
                    Rendirse
                  </button>
                </div>
              )}
            </div>
          )}

          {state.phase === 'ended' && (
            <div class="rail-footer">
              <div class="action-row">
                <button type="button" class="primary" onClick={downloadSgf}>
                  Descargar SGF
                </button>
                <a class="link-button" href="/jugar">
                  Nueva partida online
                </a>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
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
