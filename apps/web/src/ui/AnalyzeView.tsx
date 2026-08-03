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
import { GameTree, type GameNode, type MarkupType } from '../game/gameTree'
import { applyMarkToggle } from '../game/markup'
import { decodeAnalysisFromNodeData, encodeAnalysisForNode } from '../analysis/sgfAnalysisCodec'
import { decodeAnnotationFromNodeData, encodeAnnotationForNode } from '../game/sgfAnnotationCodec'
import { isMoveSequenceLegal, signMapOf, validateMove } from '../game/rules'
import { exportSgf, importSgf } from '../game/sgf'
import { sabakiToEngineVertex } from '../game/coords'
import { ModelGate } from '../models/ModelGate'
import { AnalysisStore } from '../analysis/analysisStore'
import { ReviewScheduler } from '../analysis/reviewScheduler'
import {
  buildAnnotationMarkerMap,
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
import { loadPvDetail, PV_DETAIL_LEVELS, pvDetailMoves, savePvDetail } from '../analysis/pvDetailPreference'
import type { PvDetail } from '../analysis/pvDetailPreference'
import { AnnotationEditor } from './AnnotationEditor'
import { useNavigationGuard } from './navigationGuard'
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
const VERTEX_SIZE: Record<BoardSize, number> = { 9: 70, 13: 50, 19: 38 }

// Saltos grandes ("turning points"): el MISMO umbral y el MISMO tope en los dos lugares donde importan
// — la lista que se dibuja en el panel y el conjunto que la segunda pasada del review re-analiza a
// fondo. Son los defaults de `getReportTurningPoints`, ahora explícitos justamente para poder
// compartirlos: si divergieran, el review afinaría posiciones que el usuario no ve, o dejaría sin afinar
// las que sí mira.
const TURNING_POINT_SWING = 5
const TURNING_POINT_LIMIT = 5

const SPEED_LEVELS: AnalyzeSpeed[] = ['fast', 'normal', 'precise']
const SPEED_LABELS: Record<AnalyzeSpeed, string> = { fast: 'Rápido', normal: 'Normal', precise: 'Preciso' }

// Cuántas jugadas fantasma se dibujan. Las etiquetas son NÚMEROS y no adjetivos a propósito: dicen
// exactamente qué cambia (cuánto se tapa el tablero) y no insinúan que el análisis vaya a ir más
// rápido, que es lo que el nombre "PV corto" sugeriría en falso — recortar el PV no ahorra ni una
// inferencia (ver `pvDetailPreference.ts`).
const PV_DETAIL_LABELS: Record<PvDetail, string> = { short: '3', medium: '6', full: 'Todas' }

/** Pestañas del panel de Analizar (spec no-scroll 2026-07-25): en desktop la vista entra completa en
 * el viewport, así que las secciones antes apiladas (review, editor, adivinar, árbol) se muestran de a
 * una por pestaña. La pestaña activa TAMBIÉN es el modo de interacción del tablero: 'editor' coloca
 * piedras/marcas; 'adivinar' arma la adivinanza; 'repaso'/'arbol' son de solo-navegación. Mutuamente
 * excluyentes por construcción — reemplaza al par de flags `editingVariation`/`guessWaiting`. */
type AnalyzeTab = 'repaso' | 'editor' | 'adivinar' | 'arbol'
const ANALYZE_TABS: { id: AnalyzeTab; label: string }[] = [
  { id: 'repaso', label: 'Repaso' },
  { id: 'editor', label: 'Editor' },
  { id: 'adivinar', label: 'Adivinar' },
  { id: 'arbol', label: 'Árbol' },
]

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

/** Callback compartido de `importSgf` (los dos caminos de carga de Analizar): siembra el análisis
 * cacheado (Fase 6) en `seed` y restaura comentario/marcas autoradas (Fase 1) sobre el `GameNode`. */
function decodeNodeExtras(node: GameNode, data: Record<string, string[]>, seed: Map<number, Analysis>): void {
  const analysis = decodeAnalysisFromNodeData(data)
  if (analysis) seed.set(node.id, analysis)
  const { comment, markup } = decodeAnnotationFromNodeData(data)
  if (comment !== undefined) node.comment = comment
  if (markup !== undefined) node.markup = markup
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
    const tree = importSgf(pendingGame.sgf, (node, data) => decodeNodeExtras(node, data, analysisSeed))
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
  // `humanColor: 'black'` es inocuo en Modo Analizar (no hay "humano vs IA"); el campo es requerido
  // en `GameTreeMeta` y 'black' no emite `TGHC`, así que los SGF de Analizar quedan byte-idénticos.
  return new GameTree({ boardSize, komi: 7, rules: 'chinese', handicap: 0, humanColor: 'black' })
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
      const loaded = importSgf(text, (node, data) => decodeNodeExtras(node, data, analysisSeed))
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
    <div class="card-screen analyze-picker">
      <h1>Modo Analizar</h1>
      <p>Elige un archivo SGF para analizar.</p>
      <input type="file" accept=".sgf" onChange={(e) => void handleFile(e)} />
      {error !== null && <p class="notice notice--danger">{error}</p>}

      <p class="analyze-picker-or">o empieza en blanco:</p>
      <div class="analyze-picker-scratch">
        {SCRATCH_BOARD_SIZES.map((size) => (
          <button key={size} onClick={() => onStartFromScratch(size)}>
            {size}×{size}
          </button>
        ))}
      </div>

      <button class="ghost" onClick={onBack}>Volver</button>
    </div>
  )
}

interface ReadyAnalyzeViewProps {
  tree: GameTree
  /** Id de D1 (Fase 5): ver nota en `AnalyzeView`. */
  cloudId?: string
  /** true si esta sesión viene del camino "empezar desde cero" (spec 2026-07-15): arranca en la
   * pestaña Editor (modo edición activo), ver `activeTab` más abajo. */
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
  const { sweepVisits, refineVisits, interactiveVisits } = speedSettings(speed)
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
    reviewRef.current = new GameReview({
      tree,
      store,
      scheduler,
      sweepVisits,
      // Segunda pasada sobre los saltos grandes. `minScoreSwing`/`limit` son los MISMOS valores por
      // default de `getReportTurningPoints`, que es lo que se dibuja en el panel: lo que el usuario ve
      // marcado como error es exactamente lo que se re-analiza a fondo.
      refine: { visits: refineVisits, limit: TURNING_POINT_LIMIT, minScoreSwing: TURNING_POINT_SWING },
    })
  }
  const review = reviewRef.current

  // Guardado a la nube (Fase 5): no-op sin sesión. `cloudId` restaura el id de D1 si esta sesión
  // viene de reabrir una partida (Task 6); si no, el primer `cloud.save` hace el POST inicial.
  const cloud = useCloudSync(cloudId)
  // Backup a Drive al salir de la sesión de análisis. Antes colgaba del `onLeave` de la `TopBar`
  // que esta vista montaba; con la navegación mudada al marco, el guard es lo que conserva el hilo
  // — y tiene que correr con el componente AÚN MONTADO, porque un cleanup de desmontaje encontraría
  // el `GameSync` ya dispuesto y `finish()` retornaría sin hacer nada. Ver `navigationGuard.ts`.
  useNavigationGuard(() => cloud.finish())
  const cloudNameRef = useRef<string | null>(null)
  if (cloudNameRef.current === null) cloudNameRef.current = cloudSessionName(tree.meta.boardSize)

  /** Datos extra por nodo para `exportSgf` (Fase 6): el análisis cacheado de ESE nodo, si lo hay.
   * Compartido por el export manual y el guardado en la nube — un solo camino, sin distinción. */
  function analysisExtraData(node: GameNode): Record<string, string[]> | undefined {
    return store.has(node.id) ? encodeAnalysisForNode(store.get(node.id)!) : undefined
  }

  /** Datos extra COMPUESTOS por nodo (Fase 1 + Fase 6): anotaciones autoradas (C/TR/SQ/CR/MA/LB) PRIMERO,
   * análisis cacheado (TG*) DESPUÉS — orden de emisión determinista (idempotencia). `undefined` si el
   * nodo no tiene ninguno. Reemplaza a `analysisExtraData` en los dos caminos de serialización. */
  function extraDataForNode(node: GameNode): Record<string, string[]> | undefined {
    const merged = { ...encodeAnnotationForNode(node), ...(analysisExtraData(node) ?? {}) }
    return Object.keys(merged).length > 0 ? merged : undefined
  }

  function cloudSnapshot(): GameSnapshot {
    return buildGameSnapshot(
      { sgf: exportSgf(tree, extraDataForNode), boardSize: tree.meta.boardSize, mode: 'analizar' },
      cloudNameRef.current!,
      cloudId !== undefined,
    )
  }

  /** "Volver"/"Cargar otro SGF" cierran la sesión de análisis: dispara el backup a Drive (spec
   * §Flujo de guardado — Analizar no tiene un "fin de partida" natural, así que el trigger es
   * salir). Fire-and-forget: no espera al backup para navegar. */
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

  // Cuántas jugadas fantasma dibujar. Estado LOCAL de esta vista, a diferencia de `speed`, que vive en
  // el padre con `key={speed}` para forzar el remount: cambiar las visitas invalida el review entero,
  // pero cambiar cuánto se dibuja no invalida ningún análisis — es un repintado y nada más.
  const [pvDetail, setPvDetail] = useState<PvDetail>(() => loadPvDetail(window.localStorage))

  function handleChangePvDetail(next: PvDetail): void {
    savePvDetail(window.localStorage, next)
    setPvDetail(next)
  }

  // Pestaña activa del panel (= modo de interacción del tablero, ver `AnalyzeTab`). `editing` es un
  // derivado directo: estar en la pestaña Editor ES el modo edición — reemplaza al flag
  // `editingVariation` + su toggle, y la exclusividad con 'adivinar' pasa a ser automática (una sola
  // pestaña activa). Arranca en 'editor' cuando `startEditing` (tablero vacío "empezar desde cero",
  // spec 2026-07-15: el primer clic ya coloca piedra); si no, en 'repaso'.
  const [activeTab, setActiveTab] = useState<AnalyzeTab>(startEditing ? 'editor' : 'repaso')
  const editing = activeTab === 'editor'
  // Herramienta activa DENTRO del modo edición (Fase 1). 'stone' = jugar piedra (comportamiento
  // histórico); un `MarkupType` = colocar/quitar esa marca. Sub-modos mutuamente excluyentes: un clic
  // en el tablero nunca hace las dos cosas a la vez. Salir de edición la resetea a 'stone'.
  const [editTool, setEditTool] = useState<'stone' | MarkupType>('stone')
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
    setGuessWaiting(true)
    setGuessResult(null)
    setGuessErrorMsg(null)
  }

  /** Cambiar de pestaña = cambiar el modo de interacción del tablero. Al salir de una pestaña se limpia
   * su estado transitorio (herramienta de marcas → 'stone', adivinanza en curso cancelada, hint de
   * jugada ilegal). Reemplaza la exclusividad de modos que antes hacían a mano
   * `handleToggleEditVariation`/`handleGuessStart`. */
  function selectTab(tab: AnalyzeTab): void {
    setActiveTab(tab)
    setEditTool('stone')
    setGuessWaiting(false)
    setGuessResult(null)
    setGuessErrorMsg(null)
    setIllegalMoveHint(null)
  }

  /** Clic en el tablero con el editor activo. Despacha por `editTool`: 'stone' juega una piedra;
   * cualquier `MarkupType` coloca/quita esa marca. Sub-modos mutuamente excluyentes (nunca ambos). */
  function handleEditVertexClick(v: [number, number]): void {
    const vertex = sabakiToEngineVertex(v)
    if (editTool !== 'stone') {
      handlePlaceMark(vertex, editTool)
      return
    }
    // Jugar una piedra: valida contra el oráculo `go-board` y, si es legal, la agrega al árbol vía
    // `GameTree.addMove` (crea una variación si el cursor no está en el tip). Precedente exacto:
    // `PlayView.tsx` modo exploración, sin `persist()` a localStorage y sin turno de IA.
    const turnAtCursor = tree.currentTurnAt()
    const validation = validateMove(tree.boardAt(), turnAtCursor, vertex)
    if (!validation.legal) {
      setIllegalMoveHint(illegalMoveMessage(validation.reason!))
      return
    }
    setIllegalMoveHint(null)
    tree.addMove({ color: turnAtCursor, vertex })
    bump()
    cloud.save(cloudSnapshot()) // trigger de guardado en Analizar: cada edición (Fase 5)
  }

  /** Coloca/quita una marca en `tree.current.markup`. ≤1 marca por vértice: la misma herramienta
   * sobre la misma casilla hace toggle-off; una herramienta distinta reemplaza. Las etiquetas usan
   * la próxima letra libre del nodo. Persiste como una edición más. */
  function handlePlaceMark(vertex: { x: number; y: number }, type: MarkupType): void {
    const node = tree.current
    const next = applyMarkToggle(node.markup ?? [], vertex, type)
    node.markup = next.length > 0 ? next : undefined
    bump()
    cloud.save(cloudSnapshot())
  }

  /** Edición del comentario del nodo actual: actualiza + repinta en vivo (barato). El guardado en la
   * nube se dispara en `onChange`/blur del textarea (evita serializar el árbol entero en cada tecla). */
  function handleCommentInput(value: string): void {
    tree.current.comment = value === '' ? undefined : value
    bump()
  }

  /** Pasar: agrega una jugada de pase desde el cursor (mismo patrón que Modo Jugar). Fase 1. */
  function handlePass(): void {
    tree.addMove({ color: tree.currentTurnAt(), vertex: 'pass' })
    bump()
    cloud.save(cloudSnapshot())
  }

  /** Borrar la rama del cursor (`removeNode` reubica el cursor al padre). `afterNavigate` limpia
   * adivinanza/errores y repinta. No-op en la raíz (el botón se deshabilita ahí igual). Fase 1. */
  function handleDeleteBranch(): void {
    if (tree.current === tree.root) return
    tree.removeNode(tree.current)
    afterNavigate()
    cloud.save(cloudSnapshot())
  }

  /** Promover la rama del cursor a línea principal (`mainLine()` pasa a recorrerla). Fase 1. */
  function handlePromote(): void {
    tree.promoteToMainLine(tree.current)
    bump()
    cloud.save(cloudSnapshot())
  }

  function handleExportSgf(): void {
    const text = exportSgf(tree, extraDataForNode)
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
  const pvOverlay = topMove
    ? buildPvOverlay(topMove, boardSize, tree.currentTurnAt(), pvDetailMoves(pvDetail))
    : undefined
  const ghostStoneMap = mergeGhostStoneMaps(playedMoveGhostStoneMap, pvOverlay?.ghostStoneMap, boardSize)
  // markerMap final: marcas autoradas del usuario (Fase 1) POR ENCIMA de los markers del análisis
  // (burbuja de pérdida #9 > labels del PV). Shudan admite un marker por casilla → precedencia
  // usuario > análisis vía el orden de `mergeMarkerMaps` (el primer argumento gana la casilla).
  const analysisMarkerMap = mergeMarkerMaps(pointsLostMarkerMap, pvOverlay?.markerMap, boardSize)
  const markerMap = mergeMarkerMaps(buildAnnotationMarkerMap(tree.current, boardSize), analysisMarkerMap, boardSize)
  const analyzing = analyzingNodeId === tree.current.id

  const now = Date.now() // válido en render de un componente Preact real
  const graphPoints = buildWinrateGraphData(tree, store, { smooth: true })
  const totalMoves = tree.mainLine().length
  const reviewProgress = review.progress(now)
  const report = review.getLatestReport()
  const turningPoints = report
    ? getReportTurningPoints(report.moveEntries, TURNING_POINT_SWING, TURNING_POINT_LIMIT)
    : []
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
    <div class="study-shell">
      <div class="study-main">
      <div class={`study-board${bubbleTone ? ` study-board--loss-${bubbleTone}` : ''}`} ref={boardRef}>
        {boardBounds && (
          <BoundedGoban
            signMap={signMap}
            heatMap={heatMap}
            ghostStoneMap={ghostStoneMap}
            markerMap={markerMap}
            maxWidth={boardBounds.maxWidth}
            maxHeight={boardBounds.maxHeight}
            maxVertexSize={VERTEX_SIZE[boardSize]}
            showCoordinates
            onVertexClick={
              editing
                ? (_evt, v) => handleEditVertexClick(v)
                : activeTab === 'adivinar' && guessWaiting
                  ? (_evt, v) => handleBoardGuessClick(v)
                  : undefined
            }
          />
        )}
      </div>
      <aside class="study-rail">
        {/* Zona de LECTURA (fija): las dos cifras que gobiernan la revisión, la acción primaria y el
            comentario autorado. Winrate y score son EL dato de esta pantalla — van como cifras
            etiquetadas, no como una frase corrida entre metadatos. */}
        <div class="rail-header">
          <div class="rail-stats">
            <div class="stat">
              <span class="eyebrow" title="Probabilidad de victoria de Negro">
                Winrate ●
              </span>
              <span class="stat-value">{formatAnalysisWinRate(analysis?.winrate)}</span>
            </div>
            <div class="stat">
              <span class="eyebrow" title="Ventaja de puntos estimada">
                Score
              </span>
              <span class="stat-value">{formatAnalysisScoreLead(analysis?.scoreLead)}</span>
            </div>
          </div>
          {booting ? (
            <p class="hint">Preparando motor…</p>
          ) : (
            analysis === undefined && <p class="hint">Sin analizar todavía.</p>
          )}

          <button class="primary" onClick={handleAnalyzeClick} disabled={booting || analyzing}>
            {analyzing ? 'Analizando…' : 'Analizar esta posición'}
          </button>
          {errorMsg !== null && <p class="notice notice--danger">{errorMsg}</p>}
          {analyzeError !== null && <p class="notice notice--danger">{analyzeError}</p>}
          {/* El comentario autorado se ve mientras revisas (fuera de la pestaña Editor, que ya lo edita). */}
          {activeTab !== 'editor' && tree.current.comment && (
            <p class="notice notice--quote">{tree.current.comment}</p>
          )}
        </div>

        {/* Pestañas: la activa es la sección visible Y el modo de interacción del tablero. */}
        <div class="rail-tabs">
          <div class="segmented segmented--fill" role="tablist">
            {ANALYZE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                class={activeTab === t.id ? 'active' : ''}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Zona de CONTENIDO: la pestaña activa. La región scrollea si su contenido no entra. Única
            sección con scroll propio: el grafo del árbol, que es un lienzo de dos ejes y gestiona su
            caja (ver `.tree-graph-container` en app.css); el resto crece y deja scrollear a la región. */}
        <div class="rail-body">
          {activeTab === 'repaso' && (
            <>
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
            </>
          )}
          {activeTab === 'editor' && (
            <>
              <AnnotationEditor
                node={tree.current}
                editing
                showToggle={false}
                editTool={editTool}
                turn={tree.currentTurnAt()}
                atRoot={tree.current === tree.root}
                booting={booting}
                onToggleEdit={() => {}}
                onSelectTool={setEditTool}
                onCommentInput={handleCommentInput}
                onCommentBlur={() => cloud.save(cloudSnapshot())}
                onDeleteBranch={handleDeleteBranch}
                onPromote={handlePromote}
                onPass={handlePass}
              />
              {illegalMoveHint !== null && <p class="notice notice--danger">{illegalMoveHint}</p>}
            </>
          )}
          {activeTab === 'adivinar' && (
            <GuessMovePanel
              waiting={guessWaiting}
              busy={guessBusy}
              result={guessResult}
              errorMsg={guessErrorMsg}
              expectedLabel={guessResult ? formatVertexLabel(guessResult.expected, boardSize) : null}
              onStart={handleGuessStart}
              onCancel={handleGuessCancel}
            />
          )}
          {activeTab === 'arbol' && (
            <GameTreeGraph
              tree={tree}
              onNavigate={handleTreeNavigate}
              annotationFor={(node) => (store.has(node.id) ? '•' : undefined)}
            />
          )}
        </div>

        {/* Zona de HERRAMIENTAS (fija): navegar, ajustar velocidad, exportar. Todo en fantasma —
            la única acción con peso en esta pantalla es "Analizar esta posición", arriba. */}
        <div class="rail-footer">
          <div class="nav-cluster">
            <button class="ghost" onClick={goFirst} title="Primera jugada">
              ⏮
            </button>
            <button class="ghost" onClick={goPrev} title="Jugada anterior">
              ◀
            </button>
            <button class="ghost" onClick={goNext} title="Jugada siguiente">
              ▶
            </button>
            <button class="ghost" onClick={goLast} title="Última jugada">
              ⏭
            </button>
          </div>

          {/* Velocidad es un AJUSTE, no un cambio de vista: el nivel elegido va en kaya tenue
              (encendido), no elevado como una pestaña. */}
          <div class="rail-field">
            <span class="eyebrow" id="analyze-speed-label">
              Velocidad
            </span>
            <div class="choice-row" role="group" aria-labelledby="analyze-speed-label">
              {SPEED_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={speed === level}
                  class={speed === level ? 'active' : ''}
                  onClick={() => onChangeSpeed(level)}
                >
                  {SPEED_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          {/* Cuántas jugadas fantasma se dibujan. Va al lado de Velocidad porque las dos son ajustes,
              pero NO es una segunda perilla de rendimiento: recortar la variación no ahorra ni una
              inferencia (el PV ya está calculado), sólo despeja el tablero. */}
          <div class="rail-field">
            <span class="eyebrow" id="analyze-pv-label">
              Variación
            </span>
            <div class="choice-row" role="group" aria-labelledby="analyze-pv-label">
              {PV_DETAIL_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={pvDetail === level}
                  class={pvDetail === level ? 'active' : ''}
                  onClick={() => handleChangePvDetail(level)}
                >
                  {PV_DETAIL_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          <div class="action-row">
            <button class="ghost" onClick={handleExportSgf}>
              Exportar SGF
            </button>
            <button class="ghost" onClick={handleLoadAnother}>
              Elegir otra partida
            </button>
          </div>
          {cloud.active && <SyncBadge status={cloud.status} onRetry={cloud.retryNow} />}
        </div>
      </aside>
      </div>
    </div>
  )
}
