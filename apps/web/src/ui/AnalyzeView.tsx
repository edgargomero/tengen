// Pantalla de análisis (Fase 3a, Task 9): primer "analizar una posición de punta a punta". Carga
// un SGF (reusa `importSgf`), muestra el tablero Shudan con overlays (`analysis/overlays.ts`) y un
// panel winrate/score simple, y ofrece "Analizar esta posición" (botón manual — NO se auto-dispara
// al navegar, ver el brief de esta tarea) que pide un análisis interactivo vía `ReviewScheduler`.
//
// Alcance deliberadamente acotado (frontera con Task 10/11, ver brief):
//   - NO instancia `GameReview` (el review de fondo, Task 7) ni construye
//     `WinrateGraphPanel`/`GameReviewPanel`/`GuessMovePanel` — eso llega con Task 10, junto con el
//     panel que visualiza el progreso de ese review de fondo.
//   - NO se referencia desde `main.tsx` — el conmutador Jugar/Analizar es Task 11.
//
// Mismo lenguaje de ciclo de vida que `PlayView.tsx`/`ReadyPlayView`: refs creados UNA vez (`if
// (!ref.current)`), `staleRef` para descartar continuaciones async tras el desmontaje, y un
// `[, setTick]`/`bump()` para forzar el repintado tras mutar el `GameTree` (ref, no estado). Todo lo
// pintado se DERIVA de `tree`/`store` frescos en cada render — nunca hay estado duplicado del árbol
// ni del análisis.
import { useEffect, useRef, useState } from 'preact/hooks'
import { Goban } from '@sabaki/shudan'
import type { BoardSize, NetworkId } from '@tengen/engine'
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
import { GameTreePanel } from './GameTreePanel'

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

/** vertexSize por tamaño de tablero: MISMA tabla que `PlayView.tsx` (duplicada a propósito — ese
 * archivo no la exporta; 1 línea de duplicación, mismo patrón ya aceptado que `errorMessage`). */
const VERTEX_SIZE: Record<BoardSize, number> = { 9: 44, 13: 32, 19: 24 }

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
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

  const staleRef = useRef(false)
  const [, setTick] = useState(0)
  const bump = (): void => setTick((t) => t + 1)

  const [booting, setBooting] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [analyzingNodeId, setAnalyzingNodeId] = useState<number | null>(null)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  useEffect(() => {
    staleRef.current = false
    manager
      .ensureReady(ANALYZE_NETWORK, tree.meta.boardSize)
      .then(() => {
        if (!staleRef.current) setBooting(false)
      })
      .catch((e: unknown) => {
        if (staleRef.current) return
        setErrorMsg(`No se pudo inicializar el motor (${errorMessage(e)}).`)
        setBooting(false)
      })

    return () => {
      staleRef.current = true
      scheduler.dispose()
      manager.dispose()
    }
    // Se ejecuta una sola vez: `tree`/`manager`/`store`/`scheduler` son fijos durante la vida de
    // este componente (una sesión de análisis = un montaje), mismo patrón que `ReadyPlayView`.
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
  function handleTreeNavigate(node: GameNode): void {
    if (tree.navigateToPath(tree.pathTo(node))) bump()
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
