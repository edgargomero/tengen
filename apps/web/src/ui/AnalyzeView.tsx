// Pantalla de análisis (Fase 3a, Tasks 9-10): "analizar una posición de punta a punta" + el review
// de fondo de toda la partida. Carga un SGF (reusa `importSgf`), muestra el tablero Shudan con
// overlays (`analysis/overlays.ts`) y un panel winrate/score simple, ofrece "Analizar esta
// posición" (botón manual — NO se auto-dispara al navegar) que pide un análisis interactivo vía
// `ReviewScheduler`, arranca `GameReview` (el review de fondo, Task 7) al montar, y renderiza los
// tres paneles de presentación pura que lo visualizan/consumen (Task 10):
// `WinrateGraphPanel`/`GameReviewPanel`/`GuessMovePanel`.
//
// Alcance deliberadamente acotado (frontera con Task 11, ver brief): NO se referencia desde
// `main.tsx` — el conmutador Jugar/Analizar es Task 11.
//
// Mismo lenguaje de ciclo de vida que `PlayView.tsx`/`ReadyPlayView`: refs creados UNA vez (`if
// (!ref.current)`), `staleRef` para descartar continuaciones async tras el desmontaje, y un
// `[, setTick]`/`bump()` para forzar el repintado tras mutar el `GameTree` (ref, no estado). Todo lo
// pintado se DERIVA de `tree`/`store` frescos en cada render — nunca hay estado duplicado del árbol
// ni del análisis.
import { useEffect, useRef, useState } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import type { BoardSize, NetworkId, Vertex as TengenVertex } from '@tengen/engine'
import { EngineManager } from '../engine/engineManager'
import { createWorkerManagedEngine } from '../engine/workerManagedEngine'
import { GameTree, type GameNode } from '../game/gameTree'
import { isMoveSequenceLegal, signMapOf } from '../game/rules'
import { importSgf } from '../game/sgf'
import { ModelGate } from '../models/ModelGate'
import { AnalysisStore } from '../analysis/analysisStore'
import { ReviewScheduler } from '../analysis/reviewScheduler'
import { buildGhostStoneMap, buildHeatMap, buildPvLines } from '../analysis/overlays'
import { formatAnalysisScoreLead, formatAnalysisWinRate } from '../analysis/vendor/web-katrain/analysisSummary'
import { isAnalysisQueueCanceledError, isAnalysisQueueStaleError } from '../analysis/vendor/web-katrain/analysisQueue'
import { GameReview, getReportTurningPoints } from '../analysis/gameReview'
import type { MoveReportEntry } from '../analysis/gameReview'
import { buildWinrateGraphData } from '../analysis/winrateGraphData'
import type { WinrateGraphPoint } from '../analysis/winrateGraphData'
import { guessAgainstEngine } from '../analysis/guessAgainstEngine'
import type { GuessAgainstEngineResult } from '../analysis/guessAgainstEngine'
import { GameTreePanel } from './GameTreePanel'
import { WinrateGraphPanel } from './WinrateGraphPanel'
import { GameReviewPanel } from './GameReviewPanel'
import { GuessMovePanel } from './GuessMovePanel'

/** Analizar SIEMPRE usa la red b18 (MCTS fuerte), nunca Human SL — heatmap/PV/winrate necesitan
 * "la mejor jugada según el motor", no la política de imitación humana (esa es exclusiva de Modo
 * Jugar). Ver Notas del plan. */
const ANALYZE_NETWORK: NetworkId = 'b18'

/** Visitas del análisis interactivo puntual ("Analizar esta posición"). Decisión de esta tarea (el
 * plan no fija el número, igual que SCORE_VISITS en PlayView.tsx:58-60): 200, más que las 100 de
 * SCORE_VISITS porque aquí el usuario pide explícitamente un análisis y está dispuesto a esperar un
 * poco más por una estimación más sólida (a diferencia del score de fin de partida, que corre
 * siempre sin pedirlo). Trivialmente ajustable, no es una constante de dominio. */
const INTERACTIVE_VISITS = 200

/** Visitas del review de fondo (por nodo). Decisión de esta tarea (mismo espíritu que
 * `INTERACTIVE_VISITS`): 100 — menos que las 200 interactivas porque el review corre sin que el
 * usuario lo pida, sobre TODA la partida; priorizar cobertura amplia sobre profundidad por nodo.
 * Mismo valor que `SCORE_VISITS` de `PlayView.tsx` (Fase 2), coincidencia razonable, no un
 * acoplamiento real entre ambos módulos. */
const REVIEW_VISITS = 100

/** vertexSize por tamaño de tablero: MISMA tabla que `PlayView.tsx` (duplicada a propósito — ese
 * archivo no la exporta; 1 línea de duplicación, mismo patrón ya aceptado que `errorMessage`). */
const VERTEX_SIZE: Record<BoardSize, number> = { 9: 44, 13: 32, 19: 24 }

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Mismo cálculo que `vertexLabel` (privado) de `GameTreePanel.tsx` — duplicado a propósito, mismo
 * patrón ya aceptado en Task 9 para `VERTEX_SIZE`/`errorMessage` (ese archivo no exporta nada). */
function formatVertexLabel(v: TengenVertex, boardSize: BoardSize): string {
  if (v === 'pass') return 'pasa'
  const GTP_COLUMNS = 'ABCDEFGHJKLMNOPQRST'
  const col = GTP_COLUMNS.charAt(v.x) || '?'
  const row = boardSize - v.y
  return `${col}${row}`
}

interface AnalyzeViewProps {
  /** Vuelve al menú/selector de modo (lo cablea Task 11 en main.tsx; hoy nadie pasa esta prop). */
  onBack(): void
}

export function AnalyzeView({ onBack }: AnalyzeViewProps) {
  const [tree, setTree] = useState<GameTree | null>(null)

  if (tree === null) {
    return <SgfPicker onLoad={setTree} onBack={onBack} />
  }

  return (
    <ModelGate net={ANALYZE_NETWORK}>
      <ReadyAnalyzeView tree={tree} onBack={onBack} onLoadAnother={() => setTree(null)} />
    </ModelGate>
  )
}

interface SgfPickerProps {
  onLoad(tree: GameTree): void
  onBack(): void
}

/** Pantalla mostrada cuando aún no hay árbol cargado. A diferencia de `NewGameForm`, Analizar NO
 * junta config (boardSize/komi/rules/handicap): todo eso ya viene DENTRO del SGF importado
 * (`tree.meta`), no hay nada que el usuario deba elegir antes de cargar el archivo. */
function SgfPicker({ onLoad, onBack }: SgfPickerProps) {
  const [error, setError] = useState<string | null>(null)

  async function handleFile(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    input.value = '' // permite reimportar el mismo archivo dos veces seguidas (mismo motivo que PlayView)
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const loaded = importSgf(text)
      // Deja el cursor en el tip de la línea principal (mismo UX que import de PlayView: se ve la
      // partida completa de inmediato). Validar DESPUÉS de avanzar, para cubrir exactamente la
      // línea que se va a mostrar/analizar.
      while (loaded.toChild(0)) {
        /* avanza hasta el tip */
      }
      if (!isMoveSequenceLegal(loaded.meta.boardSize, loaded.meta.handicap, loaded.movesTo())) {
        throw new Error('el SGF contiene jugadas ilegales en la línea principal')
      }
      onLoad(loaded)
    } catch (e) {
      setError(`No se pudo cargar el SGF (${errorMessage(e)}).`)
    }
  }

  return (
    <div class="analyze-picker">
      <h1>Modo Analizar</h1>
      <p>Elige un archivo SGF para analizar.</p>
      <input type="file" accept=".sgf" onChange={(e) => void handleFile(e)} />
      {error !== null && <p class="form-error">{error}</p>}
      <button onClick={onBack}>Volver</button>
    </div>
  )
}

interface ReadyAnalyzeViewProps {
  tree: GameTree
  onBack(): void
  onLoadAnother(): void
}

/** Envuelta en `ModelGate` desde `AnalyzeView`: garantiza el ONNX de `ANALYZE_NETWORK` en OPFS
 * antes de montar nada que asuma el modelo listo. */
function ReadyAnalyzeView({ tree, onBack, onLoadAnother }: ReadyAnalyzeViewProps) {
  const managerRef = useRef<EngineManager | null>(null)
  if (!managerRef.current) managerRef.current = new EngineManager(createWorkerManagedEngine)
  const manager = managerRef.current

  const storeRef = useRef<AnalysisStore | null>(null)
  if (!storeRef.current) storeRef.current = new AnalysisStore()
  const store = storeRef.current

  const schedulerRef = useRef<ReviewScheduler | null>(null)
  if (!schedulerRef.current) schedulerRef.current = new ReviewScheduler(manager)
  const scheduler = schedulerRef.current

  const reviewRef = useRef<GameReview | null>(null)
  if (!reviewRef.current) {
    reviewRef.current = new GameReview({ tree, store, scheduler, visits: REVIEW_VISITS })
  }
  const review = reviewRef.current

  const staleRef = useRef(false)
  const [, setTick] = useState(0)
  const bump = (): void => setTick((t) => t + 1)

  const [booting, setBooting] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [analyzingNodeId, setAnalyzingNodeId] = useState<number | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  const [guessWaiting, setGuessWaiting] = useState(false) // true = el próximo clic en el tablero cuenta como adivinanza
  const [guessBusy, setGuessBusy] = useState(false)
  const [guessResult, setGuessResult] = useState<GuessAgainstEngineResult | null>(null)
  const [guessErrorMsg, setGuessErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    staleRef.current = false
    manager
      .ensureReady(ANALYZE_NETWORK, tree.meta.boardSize)
      .then(() => {
        if (staleRef.current) return
        setBooting(false)
        // Fire-and-forget: si se `await`eara, `booting` no bajaría hasta terminar de analizar TODA
        // la partida, matando la progresividad del review de fondo.
        void review.start(() => {
          if (!staleRef.current) bump()
        })
      })
      .catch((e: unknown) => {
        if (staleRef.current) return
        setErrorMsg(`No se pudo inicializar el motor (${errorMessage(e)}).`)
        setBooting(false)
      })

    // Refresca el ETA/porcentaje de progreso (depende de tiempo transcurrido, no solo de qué se
    // completó). No hace falta pararlo cuando el review termina — YAGNI, ver brief de Task 10.
    const progressTimer = setInterval(() => {
      if (!staleRef.current) bump()
    }, 1000)

    return () => {
      staleRef.current = true
      clearInterval(progressTimer)
      // Orden de dependencia (más legible, no estrictamente necesario: cada dispose() es
      // idempotente/tolerante): review primero, luego scheduler (cancela todo lo que quede), luego
      // manager.
      review.dispose()
      scheduler.dispose()
      manager.dispose()
    }
    // Se ejecuta una sola vez: `tree`/`manager`/`store`/`scheduler`/`review` son fijos durante la
    // vida de este componente (una sesión de análisis = un montaje), mismo patrón que `ReadyPlayView`.
  }, [])

  function handleAnalyzeClick(): void {
    if (booting) return
    const node = tree.current
    const nodeId = node.id
    setAnalyzingNodeId(nodeId)
    setAnalyzeError(null)
    scheduler
      .analyzePosition({
        pos: tree.positionAt(node),
        visits: INTERACTIVE_VISITS,
        priority: 'interactive',
        group: 'interactive',
      })
      .then(
        (analysis) => {
          if (staleRef.current) return
          store.set(nodeId, analysis)
          setAnalyzingNodeId((current) => (current === nodeId ? null : current))
          bump()
        },
        (e: unknown) => {
          if (staleRef.current) return
          setAnalyzingNodeId((current) => (current === nodeId ? null : current))
          if (isAnalysisQueueCanceledError(e) || isAnalysisQueueStaleError(e)) return // benigno: preemptado por un clic posterior
          if (tree.current.id === nodeId) setAnalyzeError(`No se pudo analizar (${errorMessage(e)}).`)
        },
      )
  }

  /** Único punto de salida de toda navegación (nav ⏮◀▶⏭, árbol, gráfico, turning point): además de
   * repintar, cancela un modo-adivinanza en curso (una adivinanza pendiente queda sin sentido si el
   * usuario navega a otra posición) — no-op si no había ninguna. */
  function afterNavigate(): void {
    setGuessWaiting(false)
    bump()
  }

  function goFirst(): void {
    tree.toRoot()
    afterNavigate()
  }
  function goPrev(): void {
    if (tree.toParent()) afterNavigate()
  }
  function goNext(): void {
    if (tree.toChild(0)) afterNavigate()
  }
  function goLast(): void {
    let moved = false
    while (tree.toChild(0)) moved = true
    if (moved) afterNavigate()
  }
  function handleTreeNavigate(node: GameNode): void {
    if (tree.navigateToPath(tree.pathTo(node))) afterNavigate()
  }

  /** `WinrateGraphPoint.moveNumber` indexa `[tree.root, ...tree.mainLine()]` (0 = raíz, 1 = primera
   * jugada, …) — convención distinta de `MoveReportEntry.moveNumber`, ver `nodeForReportEntry`. */
  function nodeForGraphPoint(point: WinrateGraphPoint): GameNode {
    const nodes = [tree.root, ...tree.mainLine()]
    return nodes[point.moveNumber]! // moveNumber YA coincide 1:1 con el índice de este array
  }
  /** `MoveReportEntry.moveNumber` indexa `tree.mainLine()` 1-based (raíz EXCLUIDA; entry con
   * `moveNumber=1` es `mainLine()[0]`) — convención distinta de `WinrateGraphPoint.moveNumber`, ver
   * `nodeForGraphPoint`. Un `MoveReportEntry` nunca representa la raíz, así que el índice siempre
   * es válido, pero se tipa `| undefined` igualmente (`noUncheckedIndexedAccess`). */
  function nodeForReportEntry(entry: MoveReportEntry): GameNode | undefined {
    return tree.mainLine()[entry.moveNumber - 1]
  }
  function handleSelectGraphPoint(point: WinrateGraphPoint): void {
    const node = nodeForGraphPoint(point)
    if (tree.navigateToPath(tree.pathTo(node))) afterNavigate()
  }
  function handleSelectTurningPoint(entry: MoveReportEntry): void {
    const node = nodeForReportEntry(entry)
    if (node && tree.navigateToPath(tree.pathTo(node))) afterNavigate()
  }

  function handleGuessStart(): void {
    setGuessWaiting(true)
    setGuessResult(null)
    setGuessErrorMsg(null)
  }

  function handleGuessCancel(): void {
    setGuessWaiting(false)
  }

  function handleBoardGuessClick(v: [number, number]): void {
    setGuessWaiting(false)
    setGuessBusy(true)
    const [x, y] = v
    guessAgainstEngine({
      pos: tree.positionAt(),
      guess: { x, y },
      visits: INTERACTIVE_VISITS, // reusa la MISMA constante del análisis interactivo puntual
      scheduler,
    }).then(
      (result) => {
        if (staleRef.current) return
        setGuessBusy(false)
        setGuessResult(result)
      },
      (e: unknown) => {
        if (staleRef.current) return
        setGuessBusy(false)
        if (isAnalysisQueueCanceledError(e) || isAnalysisQueueStaleError(e)) return // benigno, mismo criterio que "Analizar esta posición"
        setGuessErrorMsg(`No se pudo adivinar (${errorMessage(e)}).`)
      },
    )
  }

  const board = tree.boardAt()
  const signMap = signMapOf(board)
  const boardSize = tree.meta.boardSize
  const analysis = store.get(tree.current.id)
  const heatMap = analysis ? buildHeatMap(analysis, boardSize) : undefined
  const ghostStoneMap = buildGhostStoneMap(tree.current, tree, store, boardSize)
  const topMove =
    analysis && analysis.moves.length > 0
      ? analysis.moves.reduce((best, m) => (m.visits > best.visits ? m : best), analysis.moves[0]!)
      : undefined
  const lines = topMove ? buildPvLines(topMove, boardSize) : undefined
  const analyzing = analyzingNodeId === tree.current.id

  const now = Date.now() // válido en render de un componente Preact real
  const graphPoints = buildWinrateGraphData(tree, store, { smooth: true })
  const totalMoves = tree.mainLine().length
  const reviewProgress = review.progress(now)
  const report = review.getLatestReport()
  const turningPoints = report ? getReportTurningPoints(report.moveEntries) : []

  return (
    <div class="analyze-view">
      <div class="analyze-board">
        <Goban
          signMap={signMap}
          heatMap={heatMap}
          ghostStoneMap={ghostStoneMap}
          lines={lines}
          vertexSize={VERTEX_SIZE[boardSize]}
          showCoordinates
          onVertexClick={guessWaiting ? (_evt, v) => handleBoardGuessClick(v) : undefined}
        />
      </div>
      <aside class="analyze-panel">
        {booting && <p>Preparando motor…</p>}
        {errorMsg !== null && <p class="play-error">{errorMsg}</p>}

        <p class="analyze-score">
          Negro — Winrate: {formatAnalysisWinRate(analysis?.winrate)} · Score:{' '}
          {formatAnalysisScoreLead(analysis?.scoreLead)}
        </p>
        {analysis === undefined && <p class="analyze-score-hint">Sin analizar todavía.</p>}

        <button onClick={handleAnalyzeClick} disabled={booting || analyzing}>
          {analyzing ? 'Analizando…' : 'Analizar esta posición'}
        </button>
        {analyzeError !== null && <p class="play-error">{analyzeError}</p>}

        <WinrateGraphPanel
          points={graphPoints}
          totalMoves={totalMoves}
          currentNodeId={tree.current.id}
          onSelectPoint={handleSelectGraphPoint}
        />
        <GameReviewPanel
          progress={reviewProgress}
          turningPoints={turningPoints}
          onSelectEntry={handleSelectTurningPoint}
        />
        <GuessMovePanel
          waiting={guessWaiting}
          busy={guessBusy}
          result={guessResult}
          errorMsg={guessErrorMsg}
          expectedLabel={guessResult ? formatVertexLabel(guessResult.expected, boardSize) : null}
          onStart={handleGuessStart}
          onCancel={handleGuessCancel}
        />

        <div class="play-nav">
          <button onClick={goFirst} title="Primera jugada">
            ⏮
          </button>
          <button onClick={goPrev} title="Jugada anterior">
            ◀
          </button>
          <button onClick={goNext} title="Jugada siguiente">
            ▶
          </button>
          <button onClick={goLast} title="Última jugada">
            ⏭
          </button>
        </div>

        <button onClick={onLoadAnother}>Cargar otro SGF</button>
        <button onClick={onBack}>Volver</button>

        <GameTreePanel
          tree={tree}
          onNavigate={handleTreeNavigate}
          annotationFor={(node) => (store.has(node.id) ? '•' : undefined)}
        />
      </aside>
    </div>
  )
}
