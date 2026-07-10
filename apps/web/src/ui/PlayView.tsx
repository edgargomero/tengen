// Pantalla de juego (Fase 2, Task 4): tablero Shudan + panel lateral + bucle de juego
// usuario(Negro)↔IA(Blanco). Decisiones fijadas (ver brief de Task 4 / plan de fase engine):
// humano=Negro fijo, handicap≥2 arranca Blanco, navegación view-only fuera del tip.
//
// ── Ciclo de vida ────────────────────────────────────────────────────────────────────────────
// El `GameTree` y el `EngineManager` viven en refs creados UNA sola vez (no en cada render).
// Preact no re-renderiza porque se mute un ref, así que cada mutación del árbol (jugada o
// navegación) va seguida de `bump()` (un contador en useState que solo existe para forzar el
// repintado); el tablero/turno/capturas se derivan en cada render leyendo `tree.current` fresco —
// no hay estado duplicado del árbol.
//
// `staleRef` sigue el mismo patrón que `ModelGate`: marca el componente desmontado. Toda
// continuación async (tras `await` a `ensureReady`/`genMove`/`analyzeToScore`) lo comprueba antes
// de tocar el árbol o el estado, para no mutar un árbol ya descartado (p.ej. "Nueva partida" a
// mitad de la jugada de la IA) ni actualizar un componente ya desmontado.
//
// ── Por qué la navegación se deshabilita mientras `busy` ────────────────────────────────────
// `GameTree.addMove` opera siempre desde `tree.current` (el cursor). Si se permitiera navegar
// MIENTRAS la IA está pensando, el cursor podría alejarse del tip antes de que el `genMove` en
// vuelo resuelva; al llegar la jugada de la IA, `addMove` la colgaría de donde quedó el cursor (no
// del tip real), corrompiendo el árbol con una variación no pedida. Esta Task no implementa
// variaciones (YAGNI: Task 5), así que la invariante que mantenemos es simple: mientras `busy` es
// true, el cursor SIEMPRE está en el tip; alcanza con deshabilitar la navegación durante `busy`.
import { useEffect, useRef, useState } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import type { Marker } from '@sabaki/shudan'
import type { BoardSize, Move, NetworkId, RankLevel } from '@tengen/engine'
import { EngineManager } from '../engine/engineManager'
import { createWorkerManagedEngine } from '../engine/workerManagedEngine'
import { formatResult, isGameOverByTwoPasses } from '../game/endgame'
import type { GameConfig } from '../game/gameConfig'
import { networkForOpponent } from '../game/gameConfig'
import { GameTree } from '../game/gameTree'
import { capturesOf, signMapOf, validateMove } from '../game/rules'
import { engineToSabakiVertex, sabakiToEngineVertex } from '../game/coords'
import { ModelGate } from '../models/ModelGate'

interface PlayViewProps {
  config: GameConfig
  onNewGame(): void
}

/** Visitas fijas para la estimación de score de fin de partida (`analyzeToScore`). Valor modesto:
 * suficiente para una estimación razonable sin bloquear la UI muchos segundos al terminar. */
const SCORE_VISITS = 100

/** vertexSize por tamaño de tablero: mantiene un ancho físico de tablero similar entre 9/13/19
 * (más grande en 9×9, donde hay pocas líneas y conviene que se vea cómodo). */
const VERTEX_SIZE: Record<BoardSize, number> = { 9: 44, 13: 32, 19: 24 }

function opponentLabel(opponent: RankLevel): string {
  return opponent.kind === 'human' ? `Human SL ${opponent.rank}` : `KataGo (${opponent.visits} visitas)`
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Envuelve la pantalla de juego en `ModelGate`: garantiza el ONNX de la red del oponente en OPFS
 * antes de montar nada que asuma el modelo listo (`ReadyPlayView`). */
export function PlayView({ config, onNewGame }: PlayViewProps) {
  const net = networkForOpponent(config.opponent)
  return (
    <ModelGate net={net}>
      <ReadyPlayView config={config} net={net} onNewGame={onNewGame} />
    </ModelGate>
  )
}

interface ReadyPlayViewProps {
  config: GameConfig
  net: NetworkId
  onNewGame(): void
}

function ReadyPlayView({ config, net, onNewGame }: ReadyPlayViewProps) {
  // Árbol y motor: UNA instancia por montaje (una partida = un ReadyPlayView montado; "Nueva
  // partida" desmonta este árbol vía main.tsx y monta uno nuevo desde cero).
  const treeRef = useRef<GameTree | null>(null)
  if (!treeRef.current) treeRef.current = GameTree.fromConfig(config)
  const tree = treeRef.current

  const managerRef = useRef<EngineManager | null>(null)
  if (!managerRef.current) managerRef.current = new EngineManager(createWorkerManagedEngine)
  const manager = managerRef.current

  const staleRef = useRef(false)
  // true desde el instante en que la partida terminó (resign o fin por dos pases), ANTES de que
  // el `setResult` correspondiente siquiera re-renderice. Es la guarda que usan las continuaciones
  // async (tras el `await` de `genMove`/`analyzeToScore`) para no pisar un resign con una jugada o
  // un score que ya no corresponden: sin esto, resignarse MIENTRAS la IA piensa (o mientras se
  // estima el score final) dejaría que esa operación en vuelo, al resolver, añadiera una jugada
  // post-resign o sobreescribiera el resultado. Los handlers síncronos (click/pasar/resign) la
  // usan como única fuente de verdad en vez de leer `result` (que puede ir un render por detrás).
  const endedRef = useRef(false)
  // Contador puramente para forzar el repintado tras mutar `tree` (ver nota de ciclo de vida
  // arriba); el valor en sí no se lee nunca.
  const [, setTick] = useState(0)
  const bump = (): void => setTick((t) => t + 1)
  const [busy, setBusy] = useState(true) // arranca ocupado: hasta que ensureReady (+ apertura IA) resuelva
  const [scoring, setScoring] = useState(false) // solo para el texto del panel ("Estimando…" vs "IA pensando…")
  const [result, setResult] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  /** Llamar SIEMPRE justo después de aplicar una jugada (humana o de la IA) y su `bump()`. */
  async function finishTurn(): Promise<void> {
    if (isGameOverByTwoPasses(tree.movesTo())) {
      setScoring(true)
      try {
        const analysis = await manager.analyzeToScore(tree.positionAt(), SCORE_VISITS)
        if (staleRef.current || endedRef.current) return
        endedRef.current = true
        setResult(formatResult(analysis.scoreLead))
      } catch {
        if (staleRef.current || endedRef.current) return
        endedRef.current = true
        setResult('No se pudo estimar el resultado.')
      } finally {
        if (!staleRef.current) {
          setBusy(false)
          setScoring(false)
        }
      }
      return
    }
    if (tree.currentTurnAt() === 'white') {
      await aiTurn()
    } else {
      setBusy(false)
    }
  }

  /** Exactamente UNA jugada de la IA (Blanco) desde el tip actual; NO se auto-repite. */
  async function aiTurn(): Promise<void> {
    setBusy(true)
    try {
      const move = await manager.genMove(tree.positionAt(), config.opponent)
      if (staleRef.current || endedRef.current) return
      tree.addMove(move)
      bump()
      await finishTurn()
    } catch (e) {
      if (staleRef.current || endedRef.current) return
      setErrorMsg(`La IA no pudo jugar (${errorMessage(e)}). Puedes iniciar una nueva partida.`)
      setBusy(false)
    }
  }

  useEffect(() => {
    staleRef.current = false

    async function boot(): Promise<void> {
      try {
        await manager.ensureReady(net, config.boardSize)
        // `endedRef` también se comprueba aquí: si el usuario se rinde MIENTRAS el motor todavía
        // inicializa (posible en una partida con handicap, donde este bloque dispararía la
        // apertura de la IA), no hay que arrancar `aiTurn` sobre una partida ya terminada.
        if (staleRef.current || endedRef.current) return
        if (tree.currentTurnAt() === 'white') {
          await aiTurn() // handicap≥2: la IA (Blanco) abre la partida
        } else {
          setBusy(false)
        }
      } catch (e) {
        if (staleRef.current) return
        setErrorMsg(`No se pudo inicializar el motor (${errorMessage(e)}). Puedes iniciar una nueva partida.`)
        setBusy(false)
      }
    }
    void boot()

    return () => {
      staleRef.current = true
      manager.dispose()
    }
    // Se ejecuta una sola vez: `config`/`net`/`manager`/`tree` son fijos durante la vida de este
    // componente (una partida = un montaje).
  }, [])

  function handleVertexClick(v: [number, number]): void {
    if (busy || endedRef.current) return
    if (tree.current.children.length !== 0) return // view-only: solo se juega parado en el tip
    if (tree.currentTurnAt() !== 'black') return
    const vertex = sabakiToEngineVertex(v)
    const validation = validateMove(tree.boardAt(), 'black', vertex)
    if (!validation.legal) return // jugada ilegal: se ignora en silencio (sin feedback por ahora)
    tree.addMove({ color: 'black', vertex })
    bump()
    setBusy(true)
    void finishTurn()
  }

  function handlePass(): void {
    if (busy || endedRef.current) return
    if (tree.current.children.length !== 0) return
    if (tree.currentTurnAt() !== 'black') return
    tree.addMove({ color: 'black', vertex: 'pass' })
    bump()
    setBusy(true)
    void finishTurn()
  }

  function handleResign(): void {
    if (endedRef.current) return
    // Humano (Negro) se rinde → gana Blanco → "W+R". Detiene el bucle: no se dispara más genMove
    // (marca `endedRef` YA, antes del `setResult`, para que un genMove/analyzeToScore en vuelo que
    // resuelva después no pise este resultado — ver comentario de `endedRef` arriba). Puede
    // resignarse MIENTRAS la IA piensa (`busy===true`): `setBusy(false)` aquí es indispensable,
    // porque la continuación de `aiTurn` que sigue en vuelo va a cortar por `endedRef` ANTES de
    // llegar a su propio `setBusy(false)` — sin esto, `busy` quedaría pegado en true para siempre
    // (tablero/nav deshabilitados en una partida ya terminada).
    endedRef.current = true
    setResult(formatResult(0, 'black'))
    setBusy(false)
  }

  function goFirst(): void {
    tree.toRoot()
    bump()
  }
  function goPrev(): void {
    if (tree.toParent()) bump()
  }
  function goNext(): void {
    if (tree.toChild(0)) bump()
  }
  function goLast(): void {
    let moved = false
    while (tree.toChild(0)) moved = true
    if (moved) bump()
  }

  const board = tree.boardAt()
  const signMap = signMapOf(board)
  const captures = capturesOf(board)
  const turn = tree.currentTurnAt()
  const atTip = tree.current.children.length === 0
  const markerMap = buildMarkerMap(config.boardSize, tree.current.move)

  return (
    <div class="play-view">
      <div class="play-board">
        <Goban
          signMap={signMap}
          markerMap={markerMap}
          vertexSize={VERTEX_SIZE[config.boardSize]}
          showCoordinates
          busy={busy}
          onVertexClick={(_evt, v) => handleVertexClick(v)}
        />
      </div>
      <aside class="play-panel">
        <p class="play-opponent">Oponente: {opponentLabel(config.opponent)}</p>
        <p class="play-turn">
          {result !== null
            ? 'Partida terminada'
            : scoring
              ? 'Estimando resultado…'
              : busy
                ? 'IA pensando…'
                : turn === 'black'
                  ? 'Tu turno (Negro)'
                  : 'Turno de la IA (Blanco)'}
        </p>
        <p class="play-captures">
          Capturas — Negro: {captures.black} · Blanco: {captures.white}
        </p>

        {errorMsg !== null && <p class="play-error">{errorMsg}</p>}
        {result !== null && <p class="play-result">Resultado: {result}</p>}

        <div class="play-controls">
          <button onClick={handlePass} disabled={busy || result !== null || !atTip || turn !== 'black'}>
            Pasar
          </button>
          <button onClick={handleResign} disabled={result !== null}>
            Rendirse
          </button>
        </div>

        <div class="play-nav">
          <button onClick={goFirst} disabled={busy} title="Primera jugada">
            ⏮
          </button>
          <button onClick={goPrev} disabled={busy} title="Jugada anterior">
            ◀
          </button>
          <button onClick={goNext} disabled={busy} title="Jugada siguiente">
            ▶
          </button>
          <button onClick={goLast} disabled={busy} title="Última jugada">
            ⏭
          </button>
        </div>

        <button class="play-new-game" onClick={onNewGame}>
          Nueva partida
        </button>

        {/* Task 5: exportar/importar SGF + panel de árbol de variaciones va aquí. */}
      </aside>
    </div>
  )
}

/** markerMap boardSize×boardSize (indexado [y][x], igual que signMap) con un círculo en la última
 * jugada MOSTRADA (la del cursor, no necesariamente el tip real si se está revisando); sin marca
 * en la raíz (move===null) ni en un pase. */
function buildMarkerMap(boardSize: BoardSize, move: Move | null): (Marker | null)[][] {
  const map: (Marker | null)[][] = Array.from({ length: boardSize }, () =>
    Array<Marker | null>(boardSize).fill(null),
  )
  if (move && move.vertex !== 'pass') {
    const [x, y] = engineToSabakiVertex(move.vertex)
    const row = map[y]
    if (row) row[x] = { type: 'circle' }
  }
  return map
}
