// Orquestador nativo de Fase 3a — Modo Analizar (Task 7): UNE `AnalysisStore` (Task 2, caché por
// nodo), `katrainAdapter.ts` (Task 5, puente `GameTree`→forma vendor), `computeGameReport`/
// `getReportTurningPoints`/`sortMoveReportEntries` (Task 4, portados) y `ReviewScheduler` (Task 6,
// cola de fondo con prioridad/preempt) en el "review progresivo": recorre la línea principal de la
// partida, encola análisis de fondo para cada posición sin caché y recomputa el reporte cada vez
// que un análisis se resuelve — sin esperar a que la partida entera termine de analizarse. Archivo
// 100% NATIVO de tengen — no es un port, no lleva cabecera MIT ni entrada en
// THIRD-PARTY-LICENSES/adaptaciones-upstream.md.
//
// ── Dos pasadas: el presupuesto se gasta donde importa ─────────────────────────────────────────
// El review analiza TODAS las posiciones sin muestreo, y como 1 visita = 1 inferencia de red, repartir
// las mismas visitas entre las 42 posiciones de una partida de 41 jugadas era el costo dominante de la
// pantalla (42 × 100 = 4.200 inferencias ≈ 15 min a las 4,64 inf/s de fase 0). El 42× era la palanca
// sin explotar: bajar las visitas más allá de 50/100/200 sólo degradaba calidad.
//
//   1. **Barrido** — todas las posiciones a visitas bajas (~25). Da el mapa COMPLETO de la partida
//      cuatro veces antes que antes.
//   2. **Refinamiento** — sólo las posiciones con un salto grande de score se re-analizan alto (200,
//      el DOBLE de lo que antes recibía cada posición). Son justo las que alimentan los "turning
//      points" que el usuario mira.
//
// El resultado es más rápido Y mejor a la vez, porque las posiciones aburridas dejaron de pagar como
// las decisivas. Ver `refinePass` para las dos decisiones no obvias: por qué hay una barrera entre las
// pasadas, y por qué refinar un nodo obliga a refinar también su padre.
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

/** Etiqueta de cada pasada para la UI. Vive acá y no en el componente porque el nombre es parte del
 * contrato de `ReviewProgress`: quien lea `phase` tiene que poder decir lo mismo que el panel. */
// Cortas a propósito: comparten renglón con el contador, el porcentaje y el ETA en un rail de 18rem, y
// una etiqueta larga parte el caption en dos líneas dentro de la zona más densa de la pantalla.
export const REVIEW_PHASE_LABELS: Record<ReviewPhase, string> = {
  sweep: 'Repasando',
  refine: 'Afinando errores',
}

/** Segunda pasada: a qué posiciones se les da más presupuesto, y cuánto. */
export interface RefinePass {
  /** Visitas de la re-analización. Debe superar a `sweepVisits` o no habría nada que mejorar. */
  visits: number
  /** Cuántas posiciones interesantes refinar, como máximo. Acota el presupuesto de la segunda pasada
   * en una partida llena de saltos (dos principiantes pueden producir treinta). */
  limit: number
  /** Salto de score mínimo (en puntos) para que una posición cuente como interesante. Es el mismo
   * criterio de `getReportTurningPoints`, que es lo que el usuario ve en el panel. */
  minScoreSwing: number
}

/** Qué pasada está corriendo. El progreso de cada una se cuenta aparte: sumarlas haría que el
 * porcentaje CAYERA al empezar a refinar (el total crecería a mitad de camino), y un porcentaje que
 * retrocede es peor que no tener porcentaje. */
export type ReviewPhase = 'sweep' | 'refine'

export interface ReviewProgress {
  phase: ReviewPhase
  summary: GameAnalysisProgressSummary
}

export class GameReview {
  private startedAtMs: number | null = null
  private refineStartedAtMs: number | null = null
  private phase: ReviewPhase = 'sweep'
  private disposed = false
  /** nodeIds a los que se renunció (error real, no cancelación benigna). */
  private readonly failed = new Set<number>()
  private latestReport: GameReport | null = null
  /** Fijado UNA VEZ al empezar `start()`: `[tree.root.id, ...tree.mainLine().map(n => n.id)]`. */
  private targetNodeIds: number[] = []
  /** Los mismos nodos, en el mismo orden — `[root, ...mainLine()]`. Se guardan porque la segunda pasada
   * necesita volver del reporte al árbol, y el índice en este array ES el `moveNumber` del reporte. */
  private sweepTargets: TengenGameNode[] = []
  /** Fijado al arrancar la segunda pasada: los nodos elegidos para refinar (con sus padres). */
  private refineNodeIds: number[] = []

  constructor(
    private readonly deps: {
      tree: GameTree
      store: AnalysisStore
      scheduler: ReviewScheduler
      /** Visitas de la PRIMERA pasada, sobre todas las posiciones. Sin default deliberado — decisión
       * de producto de quien construye `GameReview`. */
      sweepVisits: number
      /** Segunda pasada. Ausente = una sola pasada (el comportamiento anterior a las dos pasadas). */
      refine?: RefinePass
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
    const { tree, sweepVisits } = this.deps

    const targets: TengenGameNode[] = [tree.root, ...tree.mainLine()]
    this.sweepTargets = targets
    this.targetNodeIds = targets.map((node) => node.id)

    // Fase 6 (análisis persistido en SGF): un nodo sembrado desde el archivo con MENOS visitas que
    // las que pide esta sesión SÍ se re-encola (mejora la calidad); con visitas suficientes, se
    // salta igual que antes (evita el re-análisis completo que motivó esta fase).
    const pending = targets
      .filter((node) => this.needsAnalysis(node.id, sweepVisits))
      .map((node) => this.analyzeTarget(node, onReport, sweepVisits))

    if (pending.length === 0) {
      // Nada que encolar, pero igual reporta lo ya cacheado (idempotencia con reporte completo).
      this.recomputeAndReport(onReport)
      return this.refinePass(onReport, startedAtMsOverride)
    }

    return Promise.all(pending).then(() => this.refinePass(onReport, startedAtMsOverride))
  }

  /**
   * Segunda pasada: re-analiza a más visitas SÓLO las posiciones con un salto grande de score. Corre
   * cuando el barrido completo ya se asentó, y esa barrera es deliberada — hasta no tener la partida
   * entera evaluada no se sabe cuáles son las posiciones decisivas, y refinar antes gastaría el
   * presupuesto en posiciones que después resultan aburridas.
   *
   * **Refina el nodo Y SU PADRE.** No es un detalle de implementación: `pointsLost` se calcula
   * comparando la evaluación del padre con la del hijo (ver `computeGameReport`), así que re-analizar
   * sólo el hijo mezclaría una evaluación gruesa con una fina, y el número resultante sería MENOS
   * confiable que el del barrido en vez de más. Refinar de a pares es lo que hace que esta pasada
   * mejore algo de verdad.
   *
   * No necesita mecanismo nuevo: se apoya en el mismo filtro que ya salta lo cacheado con visitas
   * suficientes. La segunda pasada es la primera pidiendo más visitas sobre un subconjunto.
   */
  private refinePass(onReport: (report: GameReport) => void, startedAtMsOverride?: number): Promise<void> {
    const refine = this.deps.refine
    if (!refine || this.disposed) return Promise.resolve()

    const report = this.latestReport
    if (report === null) return Promise.resolve()

    // Mismo criterio que ve el usuario en el panel (`getReportTurningPoints`): si la lista de saltos
    // grandes es lo que mira, es lo que hay que afinar.
    const turningPoints = getReportTurningPoints(report.moveEntries, refine.minScoreSwing, refine.limit)

    // `entry.node` NO sirve para volver al árbol: es un nodo ADAPTADO a la forma de web-katrain
    // (`katrainAdapter.ts` → `{ move, parent, analysis }`), sin `id` y sin relación de identidad con el
    // `GameNode` de tengen. El puente es `moveNumber`, documentado como `depth + 1` sobre una
    // `mainLine` que excluye la raíz — o sea, exactamente el índice en `this.sweepTargets`
    // (`[root, ...mainLine()]`). De ahí sale también el padre, sin recorrer nada: `moveNumber - 1`
    // (para la jugada 1 eso es la raíz, que es su padre de verdad).
    const targets = new Map<number, TengenGameNode>()
    for (const entry of turningPoints) {
      for (const index of [entry.moveNumber, entry.moveNumber - 1]) {
        const node = this.sweepTargets[index]
        if (node) targets.set(node.id, node)
      }
    }

    this.refineNodeIds = [...targets.keys()]
    if (this.refineNodeIds.length === 0) return Promise.resolve()

    // El cambio de fase va ANTES de encolar: `progress()` se consulta en cualquier momento
    // (`AnalyzeView` lo hace en cada render y con un timer de 1 s).
    this.phase = 'refine'
    this.refineStartedAtMs = startedAtMsOverride ?? Date.now()

    const pending = [...targets.values()]
      .filter((node) => this.needsAnalysis(node.id, refine.visits))
      .map((node) => this.analyzeTarget(node, onReport, refine.visits))

    if (pending.length === 0) {
      this.recomputeAndReport(onReport)
      return Promise.resolve()
    }
    return Promise.all(pending).then(() => undefined)
  }

  /**
   * Progreso de la pasada EN CURSO, con su nombre. `nowMs` explícito — nunca `Date.now()` interno aquí
   * (mismo estilo que `summarizeGameAnalysisProgress`).
   *
   * Cada pasada se cuenta por separado en vez de sumarse en un total único, y es una decisión de
   * honestidad: el conjunto a refinar no se conoce hasta que el barrido termina, así que un total común
   * crecería a mitad de camino y el porcentaje RETROCEDERÍA justo cuando el trabajo avanza.
   *
   * "Terminado" es *tener análisis con visitas suficientes para esta pasada*, no *tener análisis*. La
   * diferencia importa con un SGF que trae análisis sembrado (Fase 6) con menos visitas de las pedidas:
   * ese nodo se re-encola, así que contarlo como listo adelantaría el ETA sobre trabajo que falta hacer.
   */
  progress(nowMs: number): ReviewProgress | null {
    const refining = this.phase === 'refine'
    const nodeIds = refining ? this.refineNodeIds : this.targetNodeIds
    const visits = refining ? (this.deps.refine?.visits ?? this.deps.sweepVisits) : this.deps.sweepVisits
    const startedAtMs = refining ? this.refineStartedAtMs : this.startedAtMs

    const done = nodeIds.filter((id) => !this.needsAnalysis(id, visits) || this.failed.has(id)).length
    const summary = summarizeGameAnalysisProgress({ done, total: nodeIds.length, startedAtMs, nowMs })
    return summary === null ? null : { phase: this.phase, summary }
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

  /** ¿Este nodo necesita (re)análisis para alcanzar `visits`? Es el ÚNICO lugar donde se decide, y por
   * eso lo comparten el filtro de encolado y el conteo de progreso: si divergieran, el ETA hablaría de
   * un trabajo distinto del que se está haciendo. */
  private needsAnalysis(nodeId: number, visits: number): boolean {
    const cached = this.deps.store.get(nodeId)
    return !cached || cached.visits < visits
  }

  private analyzeTarget(
    node: TengenGameNode,
    onReport: (report: GameReport) => void,
    visits: number
  ): Promise<void> {
    const attempt = (): Promise<void> =>
      this.deps.scheduler
        .analyzePosition({
          pos: this.deps.tree.positionAt(node),
          visits,
          priority: 'review',
          group: 'review',
        })
        .then(
          (analysis) => {
            // Guard deliberado (Fase 3a, fix-wave del review final, Finding 1; generalizado en
            // Fase 6 a comparar VISITAS en vez de solo presencia). Motivos por los que `store` puede
            // tener YA algo para este nodo cuando este job se asienta:
            //   (a) un análisis interactivo ("Analizar esta posición") con más visitas que el review.
            //   (b) un análisis sembrado desde el SGF (Fase 6) con MENOS visitas que este review —
            //       ese es justo el caso que el filtro de `start()` vuelve a encolar; si no se
            //       guardara el resultado nuevo, el re-análisis correría en vano (nunca mejora lo
            //       mostrado).
            // Comparar por visitas cubre ambos: nunca pisar algo de igual o mayor calidad, pero SÍ
            // reemplazar algo de menor calidad — sin importar de dónde vino (interactivo o sembrado).
            const cached = this.deps.store.get(node.id)
            if (!cached || cached.visits < analysis.visits) this.deps.store.set(node.id, analysis)
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
