// Orquestador nativo de Fase 3a — Modo Analizar (Task 7): UNE `AnalysisStore` (Task 2, caché por
// nodo), `katrainAdapter.ts` (Task 5, puente `GameTree`→forma vendor), `computeGameReport`/
// `getReportTurningPoints`/`sortMoveReportEntries` (Task 4, portados) y `ReviewScheduler` (Task 6,
// cola de fondo con prioridad/preempt) en el "review progresivo": recorre la línea principal de la
// partida, encola análisis de fondo para cada posición sin caché y recomputa el reporte cada vez
// que un análisis se resuelve — sin esperar a que la partida entera termine de analizarse. Archivo
// 100% NATIVO de tengen — no es un port, no lleva cabecera MIT ni entrada en
// THIRD-PARTY-LICENSES/adaptaciones-upstream.md.
//
// ── La raíz TAMBIÉN se analiza (requisito no explícito en la prosa del plan) ────────────────────
// El texto del plan dice "recorre tree.mainLine()", que tomado literalmente omitiría la raíz
// (`tree.root`, id 0: `GameTree.mainLine()` la excluye por diseño, ver `game/gameTree.ts`).
// `katrainAdapter.ts` (Task 5) documenta el contrato: `mainLine[0].parent` (la raíz adaptada)
// necesita su PROPIA `.analysis` para que `computeGameReport` pueda calcular el `pointsLost` de la
// PRIMERA jugada de la partida — sin eso, esa entrada se omite en SILENCIO (Task 4 diseñó ese
// comportamiento a propósito: `computePointsLostStrict` devuelve `null` y el loop hace `continue`,
// nunca lanza — no hay ningún error visible que avise del bug). Por eso `targetNodeIds` SIEMPRE
// incluye `tree.root.id` además de cada nodo de `tree.mainLine()`, y se encola PRIMERO (mismo
// orden que el array `[raíz, ...mainLine()]`, nunca reordenado por "importancia" — esa
// priorización vive en la capa de presentación, `getReportTurningPoints`/`sortMoveReportEntries`).
//
// ── Progreso: derivado, no acumulado ─────────────────────────────────────────────────────────
// `progress()` NO lleva contadores `done++`/`total++` mutables: `done` se recalcula cada vez como
// `targetNodeIds.filter(id => store.has(id) || failed.has(id)).length`. Es deliberado: un job
// `'review'` reencolado tras una cancelación benigna (ver más abajo) nunca puede hacer que `done`
// se cuente dos veces ni se desincronice — la pertenencia a `analysisStore`/`failed` es la ÚNICA
// fuente de verdad, y ambos conjuntos son naturalmente idempotentes.
//
// ── Política de reintento: cancelación benigna vs error real ────────────────────────────────
// Cuando el job encolado para un nodo se asienta:
//   - Éxito: cachea en `store` y recomputa/reporta.
//   - Rechazo BENIGNO (`isAnalysisQueueCanceledError`/`isAnalysisQueueStaleError` — el job fue
//     interrumpido por un análisis interactivo con preempt, o quedó stale): reencola el MISMO
//     nodo. Antes de reencolar, verifica `disposed` — si `dispose()` corrió mientras este job
//     estaba en vuelo, reencolar de todos modos resucitaría trabajo contra un scheduler ya
//     desechado. Ese guard vive DENTRO de este handler (no alcanza con chequearlo solo al
//     principio de `start()`: el rechazo puede llegar en cualquier momento, incluso después de
//     `dispose()`).
//   - Error REAL (cualquier otro rechazo): renuncia definitiva (`failed.add(nodeId)`), sin
//     reintentar — evita un bucle infinito si el motor está genuinamente roto para esa posición.
//     El resto de la partida sigue progresando; `computeGameReport` ya sabe omitir nodos sin
//     análisis sin lanzar.
import type { GameNode as TengenGameNode, GameTree } from '../game/gameTree'
import type { AnalysisStore } from './analysisStore'
import { adaptMainLine } from './katrainAdapter'
import type { ReviewScheduler } from './reviewScheduler'
import { isAnalysisQueueCanceledError, isAnalysisQueueStaleError } from './vendor/web-katrain/analysisQueue'
import { summarizeGameAnalysisProgress } from './vendor/web-katrain/gameAnalysisProgress'
import type { GameAnalysisProgressSummary } from './vendor/web-katrain/gameAnalysisProgress'
import { computeGameReport, getReportTurningPoints, sortMoveReportEntries } from './vendor/web-katrain/gameReport'
import type { GameReport, MoveReportEntry } from './vendor/web-katrain/gameReport'
import { DEFAULT_EVAL_THRESHOLDS } from './vendor/web-katrain/nodeAnalysis'

// Reexportado para que Task 9/10 no tengan que importar directo del directorio `vendor/`.
export { getReportTurningPoints, sortMoveReportEntries }
export type { GameReport, MoveReportEntry, GameAnalysisProgressSummary }

export class GameReview {
  private startedAtMs: number | null = null
  private disposed = false
  /** nodeIds a los que se renunció (error real, no cancelación benigna). */
  private readonly failed = new Set<number>()
  private latestReport: GameReport | null = null
  /** Fijado UNA VEZ al empezar `start()`: `[tree.root.id, ...tree.mainLine().map(n => n.id)]`. */
  private targetNodeIds: number[] = []

  constructor(
    private readonly deps: {
      tree: GameTree
      store: AnalysisStore
      scheduler: ReviewScheduler
      /** Sin default deliberado — decisión de producto de quien construye `GameReview` (Task 10). */
      visits: number
    }
  ) {}

  /**
   * Encola análisis para la raíz + cada nodo de `tree.mainLine()` sin entrada en `analysisStore`
   * (idempotente: si ya está todo analizado, no encola nada). Llama `onReport` cada vez que un job
   * se resuelve (éxito o renuncia definitiva), con el `GameReport` recalculado sobre TODO lo
   * analizado hasta ese momento — progresivo de verdad, no espera a terminar toda la partida.
   * Resuelve la promesa devuelta cuando cada nodo objetivo terminó en `analysisStore` o en la
   * renuncia definitiva (nunca cuelga esperando un job benignamente cancelado que se reencola
   * indefinidamente — ver la política de reintento en la cabecera del archivo).
   *
   * Comportamiento NO definido si se llama dos veces concurrentemente sobre la misma instancia:
   * una instancia de `GameReview` vive una vez por sesión de Analizar (Task 9 la crea una sola
   * vez), así que no hace falta defenderse de ese caso.
   */
  start(onReport: (report: GameReport) => void, startedAtMsOverride?: number): Promise<void> {
    this.startedAtMs = startedAtMsOverride ?? Date.now()
    const { tree, store } = this.deps

    const targets: TengenGameNode[] = [tree.root, ...tree.mainLine()]
    this.targetNodeIds = targets.map((node) => node.id)

    const pending = targets
      .filter((node) => !store.has(node.id))
      .map((node) => this.analyzeTarget(node, onReport))

    if (pending.length === 0) {
      // Nada que encolar, pero igual reporta lo ya cacheado (idempotencia con reporte completo).
      this.recomputeAndReport(onReport)
      return Promise.resolve()
    }

    return Promise.all(pending).then(() => undefined)
  }

  /** `nowMs` explícito — nunca `Date.now()` interno aquí (mismo estilo que `summarizeGameAnalysisProgress`). */
  progress(nowMs: number): GameAnalysisProgressSummary | null {
    const total = this.targetNodeIds.length
    const done = this.targetNodeIds.filter((id) => this.deps.store.has(id) || this.failed.has(id)).length
    return summarizeGameAnalysisProgress({ done, total, startedAtMs: this.startedAtMs, nowMs })
  }

  /**
   * Último reporte calculado, o `null` si `start()` no corrió aún ningún job hasta el asentamiento
   * (éxito O renuncia definitiva — un error real también dispara un recálculo/reporte, ver la
   * política de reintento en la cabecera del archivo).
   */
  getLatestReport(): GameReport | null {
    return this.latestReport
  }

  /**
   * Cancela todo el grupo `'review'` de la cola y marca la instancia como desechada. Un job en
   * vuelo que iba a reencolarse tras una cancelación benigna (ver `analyzeTarget`) verifica
   * `disposed` DENTRO de su propio handler antes de reencolar, así que llamar `dispose()` en
   * cualquier momento nunca deja trabajo zombie resucitando contra un scheduler ya desechado.
   */
  dispose(): void {
    this.disposed = true
    this.deps.scheduler.cancelGroup('review')
  }

  // ── privados ────────────────────────────────────────────────────────────────────────────────

  private analyzeTarget(node: TengenGameNode, onReport: (report: GameReport) => void): Promise<void> {
    const attempt = (): Promise<void> =>
      this.deps.scheduler
        .analyzePosition({
          pos: this.deps.tree.positionAt(node),
          visits: this.deps.visits,
          priority: 'review',
          group: 'review',
        })
        .then(
          (analysis) => {
            this.deps.store.set(node.id, analysis)
            this.recomputeAndReport(onReport)
          },
          (err: unknown) => {
            if (isAnalysisQueueCanceledError(err) || isAnalysisQueueStaleError(err)) {
              // Cancelación benigna (preempt de un análisis interactivo, o staleness). Trampa a
              // evitar: si `dispose()` ya corrió mientras este job estaba en vuelo, NO reencolar.
              if (this.disposed) return
              return attempt()
            }
            // Error real (crash del motor, timeout sin ningún Analysis): renuncia definitiva para
            // este nodo específico, sin reintentar; el resto de la partida sigue progresando.
            this.failed.add(node.id)
            this.recomputeAndReport(onReport)
          }
        )
    return attempt()
  }

  /**
   * Recalcula `computeGameReport` sobre TODO lo analizado hasta ahora (incluyendo nodos fallidos,
   * que simplemente no tienen `.analysis` y `computeGameReport` ya sabe omitir sin lanzar). O(n²)
   * en profundidad por el diseño de `adaptMainLine` (Task 5) — ya aceptado como YAGNI ahí; el
   * costo real de esta fase está en el motor, no en este recálculo puro en JS.
   */
  private recomputeAndReport(onReport: (report: GameReport) => void): void {
    const report = computeGameReport({
      mainLine: adaptMainLine(this.deps.tree, this.deps.store),
      boardSize: this.deps.tree.meta.boardSize,
      thresholds: [...DEFAULT_EVAL_THRESHOLDS],
    })
    this.latestReport = report
    onReport(report)
  }
}
