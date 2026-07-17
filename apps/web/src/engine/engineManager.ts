// Motor persistente del hilo principal (Fase 2, Modo Jugar). Archivo 100% de tengen.
//
// `EngineManager` posee UN `ManagedEngine` (un Worker + `WorkerEngine` en producción), lo
// inicializa una vez, lo reúsa entre jugadas y se RECUPERA de un crash del Worker. Este módulo
// NO referencia `Worker` ni `import.meta.url`: toda la construcción del Worker vive en la factory
// browser-only `workerManagedEngine.ts`, inyectada como `ManagedEngineFactory`. Así el manager se
// testea en Node con un factory mock, sin DOM.
//
// ── El punto de correctitud clave: race-contra-crash ──────────────────────────────────────────
// Un crash real del Worker NO rechaza la promesa en vuelo de `WorkerEngine.genMove`: el cliente
// sólo resuelve/rechaza ante un mensaje 'move'/'error' del worker; un worker muerto no postea nada
// → la promesa colgaría para siempre. El evento 'error' del Worker (hilo principal) SÍ dispara, pero
// `WorkerEngine` no lo escucha. Por eso cada op del engine (init/genMove) se corre en
// `Promise.race([op, crash])` contra una "promesa de crash" que rechaza (con `WorkerCrashError`)
// cuando el callback `onError` del managed engine se invoca. Sin esto, el bucle de juego se congela
// al morir el worker.
//
// ── Reconciliación y rebuild ──────────────────────────────────────────────────────────────────
// El board size es global en el worker (cambiarlo exige otra instancia); cambiar de red exige
// re-init. Por eso cambiar `boardSize` O `network` RECREA el managed engine (terminate + factory +
// re-init). `reconcile()` es idempotente: no-op si el engine actual ya está listo con la config
// deseada; en otro caso reconstruye. Un crash marca el engine `alive=false` → el siguiente
// `reconcile()` reconstruye (cubre también un worker que muere ESTANDO IDLE entre jugadas).
//
// ── Uso serial (genMove/analyzeToScore) + streaming (analyze) ───────────────────────────────────
// `genMove`/`analyzeToScore` asumen operaciones EN SERIE (el bucle de juego por turnos hace `await`
// de cada op); el manager NO serializa ops concurrentes entre sí. `analyze` (Fase 3a — Modo
// Analizar, Task 2) SÍ es streaming de verdad: reenvía cada `onUpdate` del motor al caller (no
// acumula ni resuelve una vez, a diferencia de `analyzeToScore`) y devuelve un `CancelFn` SÍNCRONO
// pese a que `reconcile()` es async, para que un caller que navega rápido entre posiciones pueda
// cancelar antes de que el análisis real llegue a arrancar.

import type {
  Analysis,
  BoardSize,
  CancelFn,
  ClockConfig,
  ClockState,
  Engine,
  Move,
  NetworkId,
  Position,
  RankLevel,
} from '@tengen/engine'

/**
 * Seam inyectable: un motor "gestionado" (en producción, un Worker + `WorkerEngine`). Permite
 * testear el manager en Node sin un Worker real. `onError` cablea el evento 'error' del Worker
 * (crash) a un callback.
 */
export interface ManagedEngine {
  engine: Engine
  terminate(): void
  /** Registra el callback de crash (cableado al evento 'error' del Worker en la factory browser). */
  onError(cb: (e: unknown) => void): void
}

export type ManagedEngineFactory = () => ManagedEngine

/**
 * Motivo de rechazo de la promesa-de-crash. INVARIANTE: es la ÚNICA fuente de `WorkerCrashError` en
 * este flujo (los errores deterministas del engine llegan como `Error` normal desde `WorkerEngine`).
 * `genMove` usa `instanceof WorkerCrashError` para decidir reintentar (crash) vs propagar (error
 * determinista); si algún otro camino lanzara este tipo, el discriminador se rompería en silencio.
 */
export class WorkerCrashError extends Error {
  constructor(cause: unknown) {
    super('El worker del motor crasheó', { cause })
    this.name = 'WorkerCrashError'
  }
}

/** Estado de un managed engine construido. La closure de `onError` captura ESTE objeto (ver `build`). */
type Live = {
  managed: ManagedEngine
  network: NetworkId
  boardSize: BoardSize
  ready: boolean // init resolvió con éxito (un engine sin init nunca se trata como listo)
  alive: boolean // false tras un crash (onError); fuerza rebuild en el próximo reconcile
  crash: Promise<never> // rechaza (WorkerCrashError) cuando el worker crashea
}

export class EngineManager {
  private readonly factory: ManagedEngineFactory
  private live: Live | null = null
  private desiredNetwork: NetworkId | null = null
  private desiredBoardSize: BoardSize | null = null

  constructor(factory: ManagedEngineFactory) {
    this.factory = factory
  }

  /**
   * Guarda la config deseada y reconcilia: reconstruye si no hay engine, si el actual está muerto,
   * o si su network/boardSize difieren de los deseados; no-op si ya está listo con esa config.
   */
  async ensureReady(network: NetworkId, boardSize: BoardSize): Promise<void> {
    this.desiredNetwork = network
    this.desiredBoardSize = boardSize
    await this.reconcile()
  }

  /**
   * Reconcilia y genera una jugada en race-contra-crash. Si falla con el engine VIVO (error
   * determinista) propaga sin reintentar. Si falló por CRASH, reconstruye y reintenta UNA vez; si el
   * reintento vuelve a fallar, propaga (sin bucle infinito). `clock` opcional (Fase reloj,
   * 2026-07-16): se reenvía tal cual al engine; ausente = comportamiento de siempre.
   */
  async genMove(
    pos: Position,
    level: RankLevel,
    clock?: { config: ClockConfig; state: ClockState },
  ): Promise<Move> {
    await this.reconcile()
    try {
      return await this.raceOp((engine) => engine.genMove(pos, { level, clock }))
    } catch (e) {
      if (!(e instanceof WorkerCrashError)) throw e // engine vivo → error determinista → propaga
      // Crash: reconcile reconstruye (alive===false) y reintentamos exactamente una vez. Si el
      // reintento vuelve a crashear/fallar, su rechazo se propaga (no lo capturamos de nuevo).
      await this.reconcile()
      return await this.raceOp((engine) => engine.genMove(pos, { level, clock }))
    }
  }

  /**
   * Estima el score de fin de partida vía `analyze`: acumula el último `Analysis` y RESUELVE cuando
   * `visits >= visits pedidas` (robusto a un off-by-one de rootVisits). Al TIMEOUT resuelve con el
   * último Analysis si hubo alguno, o RECHAZA si nunca llegó ninguno. Best-effort: no reintenta por
   * crash (el timeout cubre un worker muerto durante el análisis); el caller muestra "no se pudo
   * estimar" ante el rechazo.
   */
  async analyzeToScore(pos: Position, visits: number, timeoutMs = 30_000): Promise<Analysis> {
    await this.reconcile()
    const live = this.requireLive()
    return new Promise<Analysis>((resolve, reject) => {
      let settled = false
      let last: Analysis | undefined
      let cancel: CancelFn = () => {}
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cancel()
        if (last !== undefined) resolve(last)
        else reject(new Error('analyzeToScore: timeout sin ningún Analysis'))
      }, timeoutMs)
      cancel = live.managed.engine.analyze(pos, { visits }, (a) => {
        if (settled) return
        last = a
        if (a.visits >= visits) {
          settled = true
          clearTimeout(timer)
          cancel()
          resolve(a)
        }
      })
      // Si `analyze` emitió síncronamente y alcanzó el target durante la llamada, `cancel` aún era el
      // no-op de arriba; ahora que tiene el CancelFn real, córrelo para no dejar el análisis vivo.
      if (settled) cancel()
    })
  }

  /**
   * Streaming de análisis de una posición arbitraria (Fase 3a — Modo Analizar): reenvía CADA
   * `onUpdate` del motor al caller sin acumular ni filtrar (a diferencia de `analyzeToScore`, que
   * consume los updates y resuelve una sola vez) — no hay concepto de "visits alcanzadas → parar
   * solo" aquí, el caller (el scheduler de review) decide cuándo tiene suficiente y cancela él mismo.
   *
   * Devuelve un `CancelFn` SÍNCRONO aunque `reconcile()` sea async: si el caller cancela ANTES de
   * que `reconcile()` resuelva (p.ej. navegación rápida entre posiciones), el flag `cancelled` hace
   * que, cuando `reconcile()` sí resuelva, jamás se llegue a invocar `engine.analyze` ni se registre
   * ningún listener de crash para esta llamada — nunca arranca un análisis ni deja un handler
   * colgado para una operación que el caller ya abandonó. Si cancela DESPUÉS de que el análisis real
   * arrancó, delega al `CancelFn` real devuelto por `engine.analyze` (mismo patrón `let cancel = ()
   * => {}` + reasignación que usa `analyzeToScore`, incluido el caso "canceló durante la ráfaga
   * síncrona de onUpdate, antes de que `engine.analyze` devolviera su CancelFn real").
   *
   * Un crash del worker se reporta vía `onError` (nunca deja la operación colgada en silencio ni
   * como unhandled rejection): engancha `live.crash.catch(...)` como listener ADICIONAL a la red de
   * seguridad de `build()`, sin competir con nada (este método no tiene una Promise que resolver).
   * No reintenta tras un crash (a diferencia de `genMove`) — el caller decide si reintentar.
   */
  analyze(pos: Position, visits: number, onUpdate: (a: Analysis) => void, onError?: (e: unknown) => void): CancelFn {
    let cancelled = false
    let realCancel: CancelFn = () => {}

    void this.reconcile()
      .then(() => {
        if (cancelled) return // cancelado ANTES de que reconcile() resolviera: nunca arranca, sin listener de crash
        const live = this.requireLive()
        live.crash.catch((e) => {
          if (!cancelled) onError?.(e)
        })
        const cancelReal = live.managed.engine.analyze(
          pos,
          { visits },
          (a) => {
            if (!cancelled) onUpdate(a)
          },
          (e) => {
            if (!cancelled) onError?.(e)
          },
        )
        realCancel = cancelReal
        // Si el caller canceló DURANTE la ráfaga síncrona de onUpdate de arriba (antes de que
        // `engine.analyze` devolviera su CancelFn real), `realCancel` aún era el no-op de arriba
        // cuando se invocó `cancel()`; ahora que tiene el CancelFn real, córrelo para no dejar el
        // análisis vivo (mismo remate que usa `analyzeToScore` con `if (settled) cancel()`).
        if (cancelled) cancelReal()
      })
      .catch((e) => {
        // reconcile() rechazó (p.ej. crash del worker durante el init/rebuild): repórtalo en vez de
        // dejarlo como unhandled rejection.
        if (!cancelled) onError?.(e)
      })

    return () => {
      cancelled = true
      realCancel()
    }
  }

  /** Termina el managed engine actual y deja el manager en estado no-inicializado. */
  dispose(): void {
    if (this.live !== null) {
      this.live.managed.terminate()
      this.live = null
    }
    this.desiredNetwork = null
    this.desiredBoardSize = null
  }

  // ── privados ──────────────────────────────────────────────────────────────────────────────────

  private async reconcile(): Promise<void> {
    const network = this.desiredNetwork
    const boardSize = this.desiredBoardSize
    if (network === null || boardSize === null) {
      throw new Error('EngineManager: llama ensureReady antes de operar')
    }
    const live = this.live
    if (live !== null && live.ready && live.alive && live.network === network && live.boardSize === boardSize) {
      return // ya listo con esta config → no-op
    }
    if (live !== null) live.managed.terminate()
    const next = this.build(network, boardSize)
    this.live = next
    // init también corre en race-contra-crash: un worker que muere DURANTE init no postea 'ready' y
    // colgaría ensureReady para siempre (misma clase de cuelgue que cubre el race de genMove). Al
    // rechazar, `ready` queda en false → el próximo reconcile reconstruye y reintenta el init.
    await Promise.race([next.managed.engine.init({ network, boardSize }), next.crash])
    next.ready = true
  }

  private build(network: NetworkId, boardSize: BoardSize): Live {
    const managed = this.factory()
    let crashReject!: (reason: unknown) => void
    const crash = new Promise<never>((_, reject) => {
      crashReject = reject
    })
    // Red de seguridad: si el crash dispara SIN op en vuelo (crash idle) o antes de que `raceOp`
    // enganche su handler, este `.catch` evita un "unhandled rejection". El race real engancha su
    // propio handler; ambos manejan el mismo rechazo.
    crash.catch(() => {})
    const live: Live = { managed, network, boardSize, ready: false, alive: true, crash }
    managed.onError((e) => {
      // La closure captura ESTE `live`: un 'error' TARDÍO de un worker ya terminado sólo marca su
      // propio Live muerto, nunca el actual (que ya fue reemplazado en un rebuild).
      live.alive = false
      crashReject(new WorkerCrashError(e))
    })
    return live
  }

  private raceOp<T>(op: (engine: Engine) => Promise<T>): Promise<T> {
    const live = this.requireLive()
    return Promise.race([op(live.managed.engine), live.crash])
  }

  private requireLive(): Live {
    if (this.live === null) throw new Error('EngineManager: sin motor (llama ensureReady)')
    return this.live
  }
}
