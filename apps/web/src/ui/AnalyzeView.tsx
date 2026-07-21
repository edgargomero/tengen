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
import type { RoutableProps } from 'preact-router'
import { BoundedGoban } from '@sabaki/shudan'
import type { Analysis, BoardSize, NetworkId, Vertex as TengenVertex } from '@tengen/engine'
import { EngineManager } from '../engine/engineManager'
import { createWorkerManagedEngine } from '../engine/workerManagedEngine'
import type { GameSnapshot } from '../cloud/api'
import { takePendingOpen } from '../cloud/pendingOpen'
import { SyncBadge } from '../cloud/SyncBadge'
import { buildGameSnapshot } from '../cloud/snapshot'
import { useCloudSync } from '../cloud/useCloudSync'
import { GameTree, type GameNode } from '../game/gameTree'
import { decodeAnalysisFromNodeData, encodeAnalysisForNode } from '../analysis/sgfAnalysisCodec'
import { isMoveSequenceLegal, signMapOf, validateMove } from '../game/rules'
import { exportSgf, importSgf } from '../game/sgf'
import { sabakiToEngineVertex } from '../game/coords'
import { ModelGate } from '../models/ModelGate'
import { AnalysisStore } from '../analysis/analysisStore'
import { ReviewScheduler } from '../analysis/reviewScheduler'
import {
  buildGhostStoneMap,
  buildHeatMap,
  buildPointsLostLabelMap,
  buildPvOverlay,
  mergeGhostStoneMaps,
  mergeMarkerMaps,
  pointsLostBubbleTone,
} from '../analysis/overlays'
import { formatAnalysisScoreLead, formatAnalysisWinRate } from '../analysis/vendor/web-katrain/analysisSummary'
import { isAnalysisQueueCanceledError, isAnalysisQueueStaleError } from '../analysis/vendor/web-katrain/analysisQueue'
import { GameReview, getReportTurningPoints } from '../analysis/gameReview'
import type { MoveReportEntry } from '../analysis/gameReview'
import { buildQualityHistogram, summarizePhasePrecision } from '../analysis/reviewSummary'
import { buildWinrateGraphData } from '../analysis/winrateGraphData'
import type { WinrateGraphPoint } from '../analysis/winrateGraphData'
import { guessAgainstEngine } from '../analysis/guessAgainstEngine'
import type { GuessAgainstEngineResult } from '../analysis/guessAgainstEngine'
import { loadAnalyzeSpeed, saveAnalyzeSpeed, speedSettings } from '../analysis/speedPreference'
import type { AnalyzeSpeed } from '../analysis/speedPreference'
import { GameTreeGraph } from './GameTreeGraph'
import { WinrateGraphPanel } from './WinrateGraphPanel'
import { GameReviewPanel } from './GameReviewPanel'
import { GameReviewSummary } from './GameReviewSummary'
import { GuessMovePanel } from './GuessMovePanel'
import { useBoundedBoardSize } from './useBoundedBoardSize'

/** Analizar SIEMPRE usa la red b18 (MCTS fuerte), nunca Human SL — heatmap/PV/winrate necesitan
 * "la mejor jugada según el motor", no la política de imitación humana (esa es exclusiva de Modo
 * Jugar). Ver Notas del plan. */
const ANALYZE_NETWORK: NetworkId = 'b18'

/** Visitas del análisis interactivo puntual ("Analizar esta posición") y del review de fondo (por
 * nodo): antes constantes fijas de módulo (200/100), ahora derivadas de la preferencia de velocidad
 * del usuario (`speedPreference.ts`) — "Normal" conserva esos mismos valores por defecto. Selector
 * en el panel de análisis (fix-wave post-Fase 4, pedido de Edgar: acelerar el review de 41 jugadas
 * sin "más recursos de servidor" — el motor es 100% client-side, la única palanca real es visits). */

/** vertexSize por tamaño de tablero: MISMA tabla que `PlayView.tsx` (duplicada a propósito — ese
 * archivo no la exporta; 1 línea de duplicación, mismo patrón ya aceptado que `errorMessage`). */
const VERTEX_SIZE: Record<BoardSize, number> = { 9: 44, 13: 32, 19: 24 }

const SPEED_LEVELS: AnalyzeSpeed[] = ['fast', 'normal', 'precise']
const SPEED_LABELS: Record<AnalyzeSpeed, string> = { fast: 'Rápido', normal: 'Normal', precise: 'Preciso' }

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Texto de feedback para una jugada rechazada por `validateMove` — duplicado a propósito de
 * `PlayView.tsx` (mismo motivo que `VERTEX_SIZE`/`errorMessage`: ese archivo no exporta nada). */
function illegalMoveMessage(reason: 'ko' | 'suicide' | 'overwrite'): string {
  switch (reason) {
    case 'ko':
      return 'Jugada ilegal: retoma un ko.'
    case 'suicide':
      return 'Jugada ilegal: es un suicidio.'
    case 'overwrite':
      return 'Jugada ilegal: esa intersección ya tiene una piedra.'
  }
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

/** Fecha del navegador en YYYY-MM-DD, para el nombre del `.sgf` exportado — mismo cálculo que
 * `PlayView.tsx` (privado ahí, se duplica aquí por el mismo motivo que `VERTEX_SIZE`/`errorMessage`). */
function formatDateForFilename(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

interface AnalyzeViewProps extends RoutableProps {
  /** Vuelve al menú/selector de modo (cableado en main.tsx vía `route('/')`). */
  onBack(): void
}

interface InitialAnalyzeState {
  tree: GameTree | null
  gameId?: string
  /** Análisis persistido en el SGF (Fase 6) — sembrará un `AnalysisStore` fresco en `ReadyAnalyzeView`
   * ANTES de que arranque el review, evitando re-analizar lo que ya viene con visitas suficientes. */
  analysisSeed?: Map<number, Analysis>
}

/** Consume `takePendingOpen('analizar')` UNA sola vez (take-once — no puede recalcularse en cada
 * render): si hay una partida pendiente de reabrir y su SGF es válido, arranca directo en ella,
 * saltando `SgfPicker`. SGF corrupto → cae al picker como si no hubiera pendingOpen (nunca deja la
 * SPA en blanco; mismo espíritu que el ErrorBoundary de main.tsx). */
function computeInitialAnalyzeState(): InitialAnalyzeState {
  const pendingGame = takePendingOpen('analizar')
  if (!pendingGame) return { tree: null }
  try {
    const analysisSeed = new Map<number, Analysis>()
    const tree = importSgf(pendingGame.sgf, (node, data) => {
      const decoded = decodeAnalysisFromNodeData(data)
      if (decoded) analysisSeed.set(node.id, decoded)
    })
    // Mismo criterio que SgfPicker/PlayView import: cursor en el tip de la línea principal (D1 no
    // guarda el cursor exacto, solo el SGF).
    while (tree.toChild(0)) {
      /* avanza hasta el tip */
    }
    return { tree, gameId: pendingGame.id, analysisSeed }
  } catch {
    return { tree: null }
  }
}

export function AnalyzeView({ onBack }: AnalyzeViewProps) {
  // Ref-guardado: `computeInitialAnalyzeState` (y el take-once de pendingOpen que hace) debe
  // correr EXACTAMENTE una vez por montaje, no en cada render — de ahí el ref en vez de llamarlo
  // directo en dos `useState(() => ...)` separados (correría dos veces, la segunda ya sin nada).
  const initialRef = useRef<InitialAnalyzeState | null>(null)
  if (initialRef.current === null) initialRef.current = computeInitialAnalyzeState()

  const [tree, setTree] = useState<GameTree | null>(initialRef.current.tree)
  // Id de D1 (Fase 5): presente si esta sesión viene de reabrir una partida guardada (arriba).
  // `SgfPicker`/import manual arrancan sin id (POST en el primer guardado, sin cambios).
  const [gameId, setGameId] = useState<string | undefined>(initialRef.current.gameId)
  // Empezar desde cero (spec 2026-07-15): true SOLO en ese camino (`handleStartFromScratch`) —
  // arranca el editor de variaciones ya activado en ReadyAnalyzeView. Import de archivo y
  // reapertura vía /partidas (Fase 5 Task 6) siguen arrancando en modo vista, como hoy.
  const [startEditing, setStartEditing] = useState(false)
  // Análisis persistido en el SGF (Fase 6): sembrado al reabrir vía pendingOpen o al importar un
  // archivo con propiedades TGW/TGS/TGN/TGP. `undefined` en "empezar desde cero" (árbol vacío) y
  // tras "Elegir otra partida".
  const [analysisSeed, setAnalysisSeed] = useState<Map<number, Analysis> | undefined>(
    initialRef.current.analysisSeed,
  )
  // Cargada una sola vez (lectura síncrona de localStorage, mismo patrón que loadGame en main.tsx);
  // `key={speed}` en ReadyAnalyzeView fuerza el remount completo (review + store desde cero) cuando
  // el usuario cambia de nivel a mitad de una sesión — mismo mecanismo que `sessionKey` en main.tsx.
  const [speed, setSpeed] = useState<AnalyzeSpeed>(() => loadAnalyzeSpeed(window.localStorage))

  function handleChangeSpeed(next: AnalyzeSpeed): void {
    saveAnalyzeSpeed(window.localStorage, next)
    setSpeed(next)
  }

  function handleLoadAnother(): void {
    setTree(null)
    setGameId(undefined)
    setStartEditing(false)
    setAnalysisSeed(undefined)
  }

  function handleLoadFile(loaded: GameTree, seed: Map<number, Analysis>): void {
    setTree(loaded)
    setStartEditing(false)
    setAnalysisSeed(seed)
  }

  function handleStartFromScratch(boardSize: BoardSize): void {
    setTree(emptyAnalyzeTree(boardSize))
    setStartEditing(true)
    setAnalysisSeed(undefined)
  }

  if (tree === null) {
    return (
      <SgfPicker onLoadFile={handleLoadFile} onStartFromScratch={handleStartFromScratch} onBack={onBack} />
    )
  }

  return (
    <ModelGate net={ANALYZE_NETWORK}>
      <ReadyAnalyzeView
        key={speed}
        tree={tree}
        cloudId={gameId}
        startEditing={startEditing}
        analysisSeed={analysisSeed}
        onBack={onBack}
        onLoadAnother={handleLoadAnother}
        speed={speed}
        onChangeSpeed={handleChangeSpeed}
      />
    </ModelGate>
  )
}

interface SgfPickerProps {
  onLoadFile(tree: GameTree, analysisSeed: Map<number, Analysis>): void
  onStartFromScratch(boardSize: BoardSize): void
  onBack(): void
}

/** Tamaños ofrecidos para "empezar desde cero" — los tres `BoardSize` que soporta toda la app. */
const SCRATCH_BOARD_SIZES: BoardSize[] = [9, 13, 19]

/** Defaults fijos para un tablero vacío (spec 2026-07-15-analizar-desde-cero-design.md): mismos
 * valores que usa por defecto "Nueva partida" en Modo Jugar (`NewGameForm.tsx`: rules='chinese',
 * komi=defaultKomi('chinese')=7, sin hándicap). Sin selector — colocar piedras de hándicap a mano
 * ya lo cubre el editor de variaciones existente; decisión del brainstorm, no re-litigar. */
function emptyAnalyzeTree(boardSize: BoardSize): GameTree {
  return new GameTree({ boardSize, komi: 7, rules: 'chinese', handicap: 0 })
}

/** Pantalla mostrada cuando aún no hay árbol cargado. Dos caminos: subir un SGF (la config ya
 * viene DENTRO del archivo, en `tree.meta` — nada que elegir) o empezar en un tablero vacío
 * (spec 2026-07-15: solo el tamaño es elegible, el resto son los defaults de Modo Jugar). */
function SgfPicker({ onLoadFile, onStartFromScratch, onBack }: SgfPickerProps) {
  const [error, setError] = useState<string | null>(null)

  async function handleFile(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    input.value = '' // permite reimportar el mismo archivo dos veces seguidas (mismo motivo que PlayView)
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const analysisSeed = new Map<number, Analysis>()
      const loaded = importSgf(text, (node, data) => {
        const decoded = decodeAnalysisFromNodeData(data)
        if (decoded) analysisSeed.set(node.id, decoded)
      })
      // Deja el cursor en el tip de la línea principal (mismo UX que import de PlayView: se ve la
      // partida completa de inmediato). Validar DESPUÉS de avanzar, para cubrir exactamente la
      // línea que se va a mostrar/analizar.
      while (loaded.toChild(0)) {
        /* avanza hasta el tip */
      }
      if (!isMoveSequenceLegal(loaded.meta.boardSize, loaded.meta.handicap, loaded.movesTo())) {
        throw new Error('el SGF contiene jugadas ilegales en la línea principal')
      }
      onLoadFile(loaded, analysisSeed)
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

      <p class="analyze-picker-or">o empezá en blanco:</p>
      <div class="analyze-picker-scratch">
        {SCRATCH_BOARD_SIZES.map((size) => (
          <button key={size} onClick={() => onStartFromScratch(size)}>
            {size}×{size}
          </button>
        ))}
      </div>

      <button onClick={onBack}>Volver</button>
    </div>
  )
}

interface ReadyAnalyzeViewProps {
  tree: GameTree
  /** Id de D1 (Fase 5): ver nota en `AnalyzeView`. */
  cloudId?: string
  /** true si esta sesión viene del camino "empezar desde cero" (spec 2026-07-15): arranca el
   * editor de variaciones ya activado, ver `editingVariation` más abajo. */
  startEditing: boolean
  /** Análisis persistido en el SGF (Fase 6): siembra `AnalysisStore` en el montaje, ver más abajo. */
  analysisSeed?: Map<number, Analysis>
  onBack(): void
  onLoadAnother(): void
  speed: AnalyzeSpeed
  onChangeSpeed(next: AnalyzeSpeed): void
}

/** Nombre autogenerado de la sesión en la nube — mismo patrón que `cloudGameName` de PlayView.tsx
 * (duplicado a propósito, ese archivo no lo exporta): "Análisis 9×9 — 2026-07-14". */
function cloudSessionName(boardSize: BoardSize): string {
  return `Análisis ${boardSize}×${boardSize} — ${formatDateForFilename(new Date())}`
}

/** Envuelta en `ModelGate` desde `AnalyzeView`: garantiza el ONNX de `ANALYZE_NETWORK` en OPFS
 * antes de montar nada que asuma el modelo listo. */
function ReadyAnalyzeView({
  tree,
  cloudId,
  startEditing,
  analysisSeed,
  onBack,
  onLoadAnother,
  speed,
  onChangeSpeed,
}: ReadyAnalyzeViewProps) {
  const { reviewVisits, interactiveVisits } = speedSettings(speed)
  const managerRef = useRef<EngineManager | null>(null)
  if (!managerRef.current) managerRef.current = new EngineManager(createWorkerManagedEngine)
  const manager = managerRef.current

  const storeRef = useRef<AnalysisStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new AnalysisStore()
    // Fase 6: siembra el cache ANTES de que el useEffect de montaje llame a review.start() (más
    // abajo) — así GameReview ve estas posiciones ya cubiertas (o las mejora si tenían menos
    // visitas que las pedidas, ver gameReview.ts) en vez de re-analizar todo desde cero.
    if (analysisSeed) {
      for (const [nodeId, analysis] of analysisSeed) storeRef.current.set(nodeId, analysis)
    }
  }
  const store = storeRef.current

  const schedulerRef = useRef<ReviewScheduler | null>(null)
  if (!schedulerRef.current) schedulerRef.current = new ReviewScheduler(manager)
  const scheduler = schedulerRef.current

  const reviewRef = useRef<GameReview | null>(null)
  if (!reviewRef.current) {
    reviewRef.current = new GameReview({ tree, store, scheduler, visits: reviewVisits })
  }
  const review = reviewRef.current

  // Guardado a la nube (Fase 5): no-op sin sesión. `cloudId` restaura el id de D1 si esta sesión
  // viene de reabrir una partida (Task 6); si no, el primer `cloud.save` hace el POST inicial.
  const cloud = useCloudSync(cloudId)
  const cloudNameRef = useRef<string | null>(null)
  if (cloudNameRef.current === null) cloudNameRef.current = cloudSessionName(tree.meta.boardSize)

  /** Datos extra por nodo para `exportSgf` (Fase 6): el análisis cacheado de ESE nodo, si lo hay.
   * Compartido por el export manual y el guardado en la nube — un solo camino, sin distinción. */
  function analysisExtraData(node: GameNode): Record<string, string[]> | undefined {
    return store.has(node.id) ? encodeAnalysisForNode(store.get(node.id)!) : undefined
  }

  function cloudSnapshot(): GameSnapshot {
    return buildGameSnapshot(
      { sgf: exportSgf(tree, analysisExtraData), boardSize: tree.meta.boardSize, mode: 'analizar' },
      cloudNameRef.current!,
      cloudId !== undefined,
    )
  }

  /** "Volver"/"Cargar otro SGF" cierran la sesión de análisis: dispara el backup a Drive (spec
   * §Flujo de guardado — Analizar no tiene un "fin de partida" natural, así que el trigger es
   * salir). Fire-and-forget: no espera al backup para navegar. */
  function handleBack(): void {
    cloud.finish()
    onBack()
  }
  function handleLoadAnother(): void {
    cloud.finish()
    onLoadAnother()
  }

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
  // A qué nodo pertenece la adivinanza en curso — mismo rol que `analyzingNodeId` para el flujo
  // hermano "Analizar esta posición" (ver `handleAnalyzeClick`). No se lee en render (no hay
  // consumidor natural hoy: `guessBusy` debe seguir siendo "hay una petición en vuelo" a secas para
  // no bloquear el botón de arranque tras navegar); documenta el estado y respalda el guard de
  // staleness por-nodo en `handleBoardGuessClick`.
  const [guessNodeId, setGuessNodeId] = useState<number | null>(null)

  // Editor de variaciones (spec 2026-07-12-analyze-editor-variaciones.md): true = el próximo clic en
  // el tablero juega una piedra (ambos colores, reglas normales) en vez de contar como adivinanza.
  // Mutuamente excluyente con `guessWaiting` — ambos modos consumen el único `onVertexClick` del
  // tablero, ver `handleToggleEditVariation`/`handleGuessStart`.
  // Arranca en `startEditing` (spec 2026-07-15): en un tablero vacío ("empezar desde cero") no hay
  // nada más para hacer, así que el primer click ya coloca piedra. `startEditing` es una prop
  // estable durante la vida de este componente (una sesión = un montaje, mismo patrón que `tree`).
  const [editingVariation, setEditingVariation] = useState(startEditing)
  const [illegalMoveHint, setIllegalMoveHint] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const boardBounds = useBoundedBoardSize(boardRef)

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
        visits: interactiveVisits,
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
   * usuario navega a otra posición) — no-op si no había ninguna. También limpia el resultado/error de
   * la última adivinanza y el error del último análisis interactivo: ambos quedan atados a la
   * posición donde se generaron, así que dejarlos pintados tras navegar los atribuiría, de forma
   * engañosa, a la posición nueva (Fase 3a, fix-wave del review final, Finding 2). `analysis`/`store`
   * en sí NO se tocan aquí — el análisis cacheado de un nodo sigue siendo válido para ESE nodo pase lo
   * que pase con la navegación. */
  function afterNavigate(): void {
    setGuessWaiting(false)
    setGuessResult(null)
    setGuessErrorMsg(null)
    setAnalyzeError(null)
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
    setEditingVariation(false) // mutuamente excluyente con el editor de variaciones
    setGuessWaiting(true)
    setGuessResult(null)
    setGuessErrorMsg(null)
  }

  function handleToggleEditVariation(): void {
    setEditingVariation((current) => {
      const next = !current
      if (next) setGuessWaiting(false) // mutuamente excluyente con el modo adivinanza
      return next
    })
  }

  /** Jugar una piedra en el editor de variaciones: valida contra el oráculo `go-board` y, si es
   * legal, la agrega al árbol vía `GameTree.addMove` (crea una variación si el cursor no está en el
   * tip). Precedente exacto: `PlayView.tsx` modo exploración (`handleVertexClick`, líneas 284-296),
   * sin `persist()` (Modo Analizar no persiste a localStorage) y sin turno de IA. */
  function handleEditVertexClick(v: [number, number]): void {
    const vertex = sabakiToEngineVertex(v)
    const turnAtCursor = tree.currentTurnAt()
    const validation = validateMove(tree.boardAt(), turnAtCursor, vertex)
    if (!validation.legal) {
      setIllegalMoveHint(illegalMoveMessage(validation.reason!))
      return
    }
    setIllegalMoveHint(null)
    tree.addMove({ color: turnAtCursor, vertex })
    bump()
    cloud.save(cloudSnapshot()) // trigger de guardado en Analizar: cada edición de variación (Fase 5)
  }

  function handleExportSgf(): void {
    const text = exportSgf(tree, analysisExtraData)
    const blob = new Blob([text], { type: 'application/x-go-sgf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tengen-analyze-${formatDateForFilename(new Date())}.sgf`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleGuessCancel(): void {
    setGuessWaiting(false)
  }

  function handleBoardGuessClick(v: [number, number]): void {
    setGuessWaiting(false)
    setGuessBusy(true)
    const nodeId = tree.current.id
    setGuessNodeId(nodeId)
    const [x, y] = v
    guessAgainstEngine({
      pos: tree.positionAt(),
      guess: { x, y },
      visits: interactiveVisits, // reusa el MISMO valor derivado de speed que el análisis interactivo puntual
      scheduler,
    }).then(
      (result) => {
        if (staleRef.current) return
        setGuessBusy(false)
        // Guard de staleness por-nodo (mismo patrón que `handleAnalyzeClick`): si el usuario navegó
        // a otra posición mientras la adivinanza estaba en vuelo, el resultado ya no corresponde a
        // lo que se ve en pantalla — descartarlo en vez de mostrarlo mal atribuido.
        if (tree.current.id === nodeId) setGuessResult(result)
      },
      (e: unknown) => {
        if (staleRef.current) return
        setGuessBusy(false)
        if (isAnalysisQueueCanceledError(e) || isAnalysisQueueStaleError(e)) return // benigno, mismo criterio que "Analizar esta posición"
        if (tree.current.id === nodeId) setGuessErrorMsg(`No se pudo adivinar (${errorMessage(e)}).`)
      },
    )
  }

  const board = tree.boardAt()
  const signMap = signMapOf(board)
  const boardSize = tree.meta.boardSize
  const analysis = store.get(tree.current.id)
  const heatMap = analysis ? buildHeatMap(analysis, boardSize) : undefined
  const playedMoveGhostStoneMap = buildGhostStoneMap(tree.current, tree, store, boardSize)
  // #9: burbuja "-X.X" sobre la piedra del nodo actual, coloreada por tono de calidad. El label lo
  // dibuja Shudan (markerMap); el color lo pone `AnalyzeView` vía una clase de tono en `.analyze-board`
  // (Shudan no colorea markers por sí solo, y en Analizar solo hay UNA label sobre piedra a la vez).
  const pointsLostMarkerMap = buildPointsLostLabelMap(tree.current, tree, store, boardSize)
  const bubbleTone = pointsLostBubbleTone(tree.current, tree, store)
  const topMove =
    analysis && analysis.moves.length > 0
      ? analysis.moves.reduce((best, m) => (m.visits > best.visits ? m : best), analysis.moves[0]!)
      : undefined
  const pvOverlay = topMove ? buildPvOverlay(topMove, boardSize, tree.currentTurnAt()) : undefined
  const ghostStoneMap = mergeGhostStoneMaps(playedMoveGhostStoneMap, pvOverlay?.ghostStoneMap, boardSize)
  const analyzing = analyzingNodeId === tree.current.id

  const now = Date.now() // válido en render de un componente Preact real
  const graphPoints = buildWinrateGraphData(tree, store, { smooth: true })
  const totalMoves = tree.mainLine().length
  const reviewProgress = review.progress(now)
  const report = review.getLatestReport()
  const turningPoints = report ? getReportTurningPoints(report.moveEntries) : []
  // #6: agregado de calidad + precisión por fase, derivado del MISMO reporte que los turning points
  // (cero cómputo de motor extra). `null` mientras el review de fondo aún no produjo ningún reporte.
  const qualityHistogram = report ? buildQualityHistogram(report) : null
  const phasePrecision = report ? summarizePhasePrecision(report.moveEntries) : null
  // 0 si el cursor está fuera de mainLine() (en una variación): prev queda deshabilitado y next
  // apunta siempre al primer turning point — comportamiento aceptable, ver nota del plan.
  const currentMoveNumber = tree.mainLine().findIndex((n) => n.id === tree.current.id) + 1
  const prevMistake = [...turningPoints].reverse().find((e) => e.moveNumber < currentMoveNumber)
  const nextMistake = turningPoints.find((e) => e.moveNumber > currentMoveNumber)

  return (
    <div class="analyze-view">
      <div class={`analyze-board${bubbleTone ? ` analyze-board--loss-${bubbleTone}` : ''}`} ref={boardRef}>
        {boardBounds && (
          <BoundedGoban
            signMap={signMap}
            heatMap={heatMap}
            ghostStoneMap={ghostStoneMap}
            markerMap={mergeMarkerMaps(pointsLostMarkerMap, pvOverlay?.markerMap, boardSize)}
            maxWidth={boardBounds.maxWidth}
            maxHeight={boardBounds.maxHeight}
            maxVertexSize={VERTEX_SIZE[boardSize]}
            showCoordinates
            onVertexClick={
              editingVariation
                ? (_evt, v) => handleEditVertexClick(v)
                : guessWaiting
                  ? (_evt, v) => handleBoardGuessClick(v)
                  : undefined
            }
          />
        )}
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

        <button onClick={handleToggleEditVariation} disabled={booting}>
          {editingVariation ? 'Dejar de editar' : 'Editar variación'}
        </button>
        {editingVariation && (
          <p class="analyze-editing">
            Modo edición: le toca a {tree.currentTurnAt() === 'black' ? 'Negro' : 'Blanco'}
          </p>
        )}
        {illegalMoveHint !== null && <p class="play-error">{illegalMoveHint}</p>}

        <div class="analyze-speed">
          <span>Velocidad de análisis:</span>
          {SPEED_LEVELS.map((level) => (
            <button
              key={level}
              class={speed === level ? 'active' : ''}
              onClick={() => onChangeSpeed(level)}
              disabled={speed === level}
            >
              {speed === level ? `• ${SPEED_LABELS[level]}` : SPEED_LABELS[level]}
            </button>
          ))}
        </div>

        <WinrateGraphPanel
          points={graphPoints}
          totalMoves={totalMoves}
          currentNodeId={tree.current.id}
          onSelectPoint={handleSelectGraphPoint}
        />
        <GameReviewPanel
          progress={reviewProgress}
          turningPoints={turningPoints}
          prevMistake={prevMistake}
          nextMistake={nextMistake}
          onSelectEntry={handleSelectTurningPoint}
        />
        {qualityHistogram && phasePrecision && (
          <GameReviewSummary qualityHistogram={qualityHistogram} phasePrecision={phasePrecision} />
        )}
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

        <button onClick={handleExportSgf}>Exportar SGF</button>
        <button onClick={handleLoadAnother}>Elegir otra partida</button>
        <button onClick={handleBack}>Volver</button>
        {cloud.active && <SyncBadge status={cloud.status} onRetry={cloud.retryNow} />}

        <GameTreeGraph
          tree={tree}
          onNavigate={handleTreeNavigate}
          annotationFor={(node) => (store.has(node.id) ? '•' : undefined)}
        />
      </aside>
    </div>
  )
}
