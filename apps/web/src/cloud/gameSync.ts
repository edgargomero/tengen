// Motor de guardado a la nube (Fase 5, decisión 5 del plan). Puro/Node-testeable: fetch y timers
// INYECTADOS; cero conocimiento de Preact (useCloudSync.ts es el puente) ni de better-auth (la
// cookie de sesión viaja sola: same-origin, credenciales por defecto).
//
// Semántica (calcada del spec §Flujo de guardado):
//   - `save(snapshot)`: coalescing ÚLTIMA-GANA con UN solo request en vuelo. Si hay un request
//     volando, el snapshot queda pendiente y se manda al terminar (el más nuevo pisa al anterior).
//     Sin esto, la jugada humana + la respuesta de la IA (<1s después) dispararían DOS POST y
//     crearían dos filas para la misma partida.
//   - Sin gameId → POST (primer guardado, captura el id); con gameId → PUT in-place.
//   - Fallo → estado 'error' + retry con backoff 2s/5s/15s (y se queda en 15s: cuando vuelva la
//     red se recupera solo, sin intervención). Un save nuevo resetea el backoff (actividad fresca).
//   - `finish()`: marca que corresponde un backup a Drive; se dispara cuando el último save quedó
//     flusheado (el backup sube lo que hay en D1, así que no puede adelantarse al save). El backup
//     en sí es best-effort SIN retry (spec: Drive es un plus — D1 ya está segura).
//   - NUNCA lanza. El único output visible es onStatus/onGameId.
import { backupToDrive, createGame, updateGame } from './api'
import type { FetchLike, GameSnapshot } from './api'

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface GameSyncOptions {
  /** Id de D1 de una partida reabierta (los saves hacen PUT desde el arranque). */
  initialGameId?: string
  fetchImpl?: FetchLike
  onStatus?: (status: SyncStatus) => void
  /** Se llama una sola vez, cuando el primer POST devuelve el id. */
  onGameId?: (id: string) => void
  /** Timers inyectables (tests); default setTimeout/clearTimeout. */
  schedule?: (fn: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
}

const RETRY_DELAYS_MS = [2000, 5000, 15000]

export class GameSync {
  private gameIdInternal: string | undefined
  private pending: GameSnapshot | null = null
  private inFlight = false
  private retryCount = 0
  private retryHandle: unknown = null
  private drivePending = false
  private disposed = false

  private readonly fetchImpl: FetchLike
  private readonly schedule: (fn: () => void, delayMs: number) => unknown
  private readonly cancel: (handle: unknown) => void

  constructor(private readonly opts: GameSyncOptions = {}) {
    this.gameIdInternal = opts.initialGameId
    // bind: fetch del browser lanza "Illegal invocation" si se llama sin su this original.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  get gameId(): string | undefined {
    return this.gameIdInternal
  }

  save(snapshot: GameSnapshot): void {
    if (this.disposed) return
    this.pending = snapshot
    // Actividad nueva del usuario: cancela el retry programado y resetea el backoff (el flush de
    // abajo intenta YA; si vuelve a fallar, el ciclo arranca de nuevo en 2s).
    this.clearRetry()
    this.retryCount = 0
    void this.flush()
  }

  /** Pide el backup a Drive en cuanto el último save haya llegado a D1 (fin de partida en Jugar;
   * salida de la sesión en Analizar). No-op sin gameId (nunca se guardó nada). */
  finish(): void {
    if (this.disposed) return
    this.drivePending = true
    void this.maybeBackup()
  }

  /** Botón "Reintentar" del badge: salta el backoff pendiente. */
  retryNow(): void {
    if (this.disposed) return
    this.clearRetry()
    void this.flush()
  }

  /** Corta timers y silencia callbacks. Un fetch ya en vuelo sigue su curso (no se aborta: si el
   * save llega, mejor), pero ya no reprograma retries ni notifica estado. */
  dispose(): void {
    this.disposed = true
    this.clearRetry()
  }

  private setStatus(status: SyncStatus): void {
    if (!this.disposed) this.opts.onStatus?.(status)
  }

  private clearRetry(): void {
    if (this.retryHandle !== null) {
      this.cancel(this.retryHandle)
      this.retryHandle = null
    }
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryHandle !== null) return
    const delay = RETRY_DELAYS_MS[Math.min(this.retryCount, RETRY_DELAYS_MS.length - 1)]!
    this.retryCount += 1
    this.retryHandle = this.schedule(() => {
      this.retryHandle = null
      void this.flush()
    }, delay)
  }

  private async flush(): Promise<void> {
    if (this.inFlight || this.pending === null) return
    const snapshot = this.pending
    this.pending = null
    this.inFlight = true
    this.setStatus('saving')
    try {
      if (this.gameIdInternal === undefined) {
        const id = await createGame(this.fetchImpl, snapshot)
        this.gameIdInternal = id
        if (!this.disposed) this.opts.onGameId?.(id)
      } else {
        await updateGame(this.fetchImpl, this.gameIdInternal, snapshot)
      }
      this.inFlight = false
      this.retryCount = 0
      if (this.pending !== null) {
        // Llegó otro save mientras este volaba: flushear ya (última-gana).
        void this.flush()
        return
      }
      this.setStatus('saved')
      await this.maybeBackup()
    } catch {
      this.inFlight = false
      // Re-encola el snapshot fallido SOLO si no llegó uno más nuevo durante el vuelo.
      if (this.pending === null) this.pending = snapshot
      this.setStatus('error')
      this.scheduleRetry()
    }
  }

  private async maybeBackup(): Promise<void> {
    if (!this.drivePending || this.gameIdInternal === undefined) return
    if (this.inFlight || this.pending !== null) return // el backup espera al último save
    this.drivePending = false
    try {
      await backupToDrive(this.fetchImpl, this.gameIdInternal)
    } catch {
      // Best-effort sin retry: D1 ya tiene la partida; la fila queda sin drive_file_id hasta el
      // próximo finish() (spec §Manejo de errores).
    }
  }
}
