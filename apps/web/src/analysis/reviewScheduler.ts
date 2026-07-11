// Adaptador nativo (Fase 3a — Modo Analizar, Task 6) entre `EngineManager.analyze` (Task 2:
// streaming puro, callback `onUpdate` + `CancelFn`, SIN concepto de "visits alcanzadas → parar
// solo") y la forma `(ctx) => Promise<Analysis>` que exige un job de `AnalysisQueue` (portado
// verbatim en `./vendor/web-katrain/analysisQueue.ts`). Archivo 100% de tengen: NO lleva cabecera
// MIT ni entrada en THIRD-PARTY-LICENSES/adaptaciones-upstream.md — solo CONSUME la clase portada.
//
// Fase 3a necesita analizar la partida en segundo plano (review progresivo, Task 7) mientras el
// usuario pide análisis interactivo de una posición puntual (Task 9) — ambos compiten por el MISMO
// `EngineManager`, que solo procesa un `analyze` a la vez. `AnalysisQueue` resuelve el
// scheduling (prioridad/grupo/preempt/staleness); este archivo instancia su PROPIA `AnalysisQueue`
// por sesión de Analizar (nunca el singleton eliminado del vendor, ver cabecera de ese archivo).
//
// ── El riesgo real: los 4 caminos de asentamiento de `runAnalyzeJob` ────────────────────────────
// Si `run(ctx)` no se asienta (resuelve/rechaza) con prontitud tras `ctx.signal` abortarse, el job
// queda "zombie" en el `active` de `AnalysisQueue` para siempre → `pump()` nunca vuelve a arrancar
// nada → la cola ENTERA se congela (ni interactivo ni review vuelven a correr jamás), no solo la
// llamada abortada. Hay exactamente 4 caminos, y CADA UNO debe (a) asentar la promesa Y (b) llamar
// al `CancelFn` REAL del motor (sin esto el motor real seguiría calculando indefinidamente y su
// cola FIFO interna quedaría ocupada, bloqueando el SIGUIENTE job igual de fatal que no asentar):
//   1. Éxito: `onUpdate` reporta `a.visits >= visits` → resuelve con `a`. `EngineManager.analyze`
//      streaming NO para solo al alcanzar el target (a diferencia de `analyzeToScore`) — sin
//      cancelar aquí también, el motor sigue produciendo updates de más visitas indefinidamente.
//   2. Error del motor: `onError` dispara (crash, `LocalEngine` sin init, etc.) → rechaza con ese
//      error.
//   3. Abort de la cola (`ctx.signal`): preempt, `cancelGroup`, o `dispose()` → rechaza con
//      `AnalysisQueueCanceledError` (más honesto/depurable que un rechazo genérico, aunque la cola
//      lo sobreescribiría igual porque `signal.aborted` ya es true) y cancela el motor real.
//   4. Timeout — el camino fácil de olvidar. `EngineManager.analyze` no garantiza que la ÚLTIMA
//      actualización natural (sin cancelar, sin error) tenga `visits >= target`: el `maxTimeMs`
//      interno de `search.run` en `LocalEngine.analyze` puede agotarse antes de completar las
//      visitas pedidas en ese chunk, y el loop igual sale — sin cancelación, sin error, simplemente
//      silencio después. Mismo patrón que ya usa `analyzeToScore` (`engineManager.ts`): un
//      `setTimeout` propio que asienta con el último `Analysis` recibido si hubo alguno
//      (best-effort — un resultado con menos visitas que las pedidas es mejor que bloquear la cola
//      para siempre), o rechaza si nunca llegó ninguno.
//
// ── Por qué `const cancelFn` es seguro aquí (a diferencia del `let cancel = () => {}` que SÍ
// necesitan `analyzeToScore`/`EngineManager.analyze` internamente) ──────────────────────────────
// `EngineManager.analyze` (`engineManager.ts:171`, `void this.reconcile().then(() => {...})`)
// garantiza que `onUpdate`/`onError` SOLO se invocan de forma asíncrona (tras el microtask de
// `reconcile()`), nunca durante la llamada síncrona a `engineManager.analyze(...)` misma — a
// diferencia de `LocalEngine.analyze` (una capa más abajo), que sí puede emitir síncronamente. Por
// eso, para cuando cualquier callback o el abort-listener pudieran disparar, `const cancelFn =
// engineManager.analyze(...)` YA terminó de asignarse (el `ctx.signal.addAbortListener(...)` va en
// la línea siguiente, textualmente después de la asignación). Replicar el patrón `let cancel = ()
// => {}` de `analyzeToScore` aquí sería complejidad cargo-culteada de una capa donde el hazard que
// la motiva no puede ocurrir.
import type { Analysis, Position } from '@tengen/engine'
import type { EngineManager } from '../engine/engineManager'
import type { AnalysisQueueContext } from './vendor/web-katrain/analysisQueue'
import { AnalysisQueue, AnalysisQueueCanceledError } from './vendor/web-katrain/analysisQueue'

const DEFAULT_TIMEOUT_MS = 30_000 // mismo valor que `analyzeToScore` (engineManager.ts), por consistencia.

function runAnalyzeJob(
  engineManager: EngineManager,
  pos: Position,
  visits: number,
  timeoutMs: number,
  ctx: AnalysisQueueContext
): Promise<Analysis> {
  return new Promise<Analysis>((resolve, reject) => {
    let settled = false
    let last: Analysis | undefined

    const timer = setTimeout(() => {
      finish(() => (last !== undefined ? resolve(last) : reject(new Error('reviewScheduler: timeout sin ningún Analysis'))))
    }, timeoutMs)

    const cancelFn = engineManager.analyze(
      pos,
      visits,
      (a) => {
        if (settled) return
        last = a
        if (a.visits >= visits) finish(() => resolve(a))
      },
      (e) => finish(() => reject(e))
    )

    ctx.signal.addAbortListener(() => {
      finish(() => reject(new AnalysisQueueCanceledError(ctx.signal.reason || undefined)))
    })

    function finish(settleAction: () => void): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cancelFn()
      settleAction()
    }
  })
}

export type ReviewPriority = 'interactive' | 'review'

// Subconjunto de las prioridades de fondo de web-katrain (gameStore.ts:1080-1087:
// interactive:100 > aiMove:70 > selfplay:55 > fullGame:20 > fastGame:15 > quickGame:10). Fase 3a
// solo usa dos: 'interactive' (mapea 1:1 a la interactive:100 de upstream — análisis puntual pedido
// por el usuario) y 'review' (mapea a la fullGame:20 de upstream — el review de fondo de toda la
// partida, Task 7). aiMove/selfplay/fastGame/quickGame no aplican a 3a (no hay modo Jugar-contra-sí-
// mismo ni partidas rápidas en Analizar) — no se inventan valores para ellas.
export const REVIEW_PRIORITIES: Record<ReviewPriority, number> = {
  interactive: 100,
  review: 20,
}

export type AnalyzePositionArgs = {
  pos: Position
  visits: number
  priority: ReviewPriority
  /** Caller-provisto (Task 7 pasa 'review'; Task 9 su propio grupo). Usado por `cancelGroup`. */
  group: string
  /**
   * Opcional — desduplica jobs PENDIENTES de la MISMA posición si el caller encola dos veces antes
   * de que el primero arranque (p.ej. doble-clic). Solo cancela jobs PENDIENTES con la misma clave y
   * una versión vieja (ver mecánica de `AnalysisQueue` en su cabecera) — NUNCA toca un job ACTIVO.
   * Para un análisis interactivo donde el usuario navega rápido, la cancelación del análisis EN
   * CURSO depende de `priority: 'interactive'` (que ya activa `preempt` más abajo), NO de
   * `staleKey`. Task 9 decide si usarlo; no es obligatorio.
   */
  staleKey?: string
  /** Default 30_000 (mismo valor que `analyzeToScore`). */
  timeoutMs?: number
}

/**
 * Adapta `EngineManager.analyze` (streaming, Task 2) a un job encolado de `AnalysisQueue`, para que
 * un análisis interactivo puntual (Task 9) y el review de fondo de toda la partida (Task 7) puedan
 * competir por el mismo motor serialmente, con prioridad y preempt.
 */
export class ReviewScheduler {
  private readonly queue = new AnalysisQueue()

  constructor(private readonly engineManager: EngineManager) {
    // Instancia su PROPIA `AnalysisQueue` por sesión de Analizar — nunca el singleton eliminado del
    // vendor (ver cabecera de `./vendor/web-katrain/analysisQueue.ts`).
  }

  /**
   * Encola un análisis de `args.pos` hasta `args.visits` (o hasta `args.timeoutMs`, default
   * 30_000). `preempt` se deriva SIEMPRE de `args.priority === 'interactive'` — no es un parámetro
   * separado configurable por el caller, para que nunca se pueda pasar `priority: 'review'` con
   * preempt activado por error (rompería la semántica "solo lo interactivo preempta").
   *
   * NO usa `cacheKey`/`bypassCache` de `AnalysisQueue` deliberadamente: el cacheo por-nodo ya es
   * responsabilidad de `AnalysisStore` (Task 2) — `gameReview.ts` (Task 7) decide si vale la pena
   * encolar un job consultando `analysisStore.has(nodeId)` ANTES de llamar a este método. Usar
   * también el cache interno de `AnalysisQueue` introduciría una SEGUNDA fuente de verdad para
   * "¿ya analicé esto?", con riesgo de desincronizarse de `AnalysisStore`.
   *
   * Contrato de rechazo (4 motivos posibles — éxito nunca rechaza):
   *   - BENIGNO (re-encolar más tarde si corresponde): el job fue preemptado o cancelado
   *     (`cancelGroup`/`dispose`) o marcado stale — usa `isAnalysisQueueCanceledError(err)` /
   *     `isAnalysisQueueStaleError(err)` (exportados por `./vendor/web-katrain/analysisQueue`) para
   *     reconocer estos casos sin parsear mensajes de error a mano.
   *   - REAL (no re-encolar automáticamente, propagar/loguear): un error genuino del motor (crash,
   *     `onError`) o el timeout de este método (`Error` simple, sin marcar) — ninguno de los dos
   *     pasa los type guards de arriba.
   */
  analyzePosition(args: AnalyzePositionArgs): Promise<Analysis> {
    return this.queue.enqueue({
      group: args.group,
      priority: REVIEW_PRIORITIES[args.priority],
      staleKey: args.staleKey,
      preempt: args.priority === 'interactive',
      run: (ctx) => runAnalyzeJob(this.engineManager, args.pos, args.visits, args.timeoutMs ?? DEFAULT_TIMEOUT_MS, ctx),
    })
  }

  /** Delega a `AnalysisQueue.cancelGroup`: cancela pending+active del grupo pedido. */
  cancelGroup(group: string, reason?: string): number {
    return reason === undefined ? this.queue.cancelGroup(group) : this.queue.cancelGroup(group, reason)
  }

  /** Cancela TODO (pending+active) — mismo patrón `dispose()` que `EngineManager`/`PlayView`. */
  dispose(): void {
    this.queue.cancelWhere(() => true, 'ReviewScheduler disposed')
  }
}
