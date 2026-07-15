// Singleton in-memory take-once (Fase 5 Task 6): puente entre "Mis partidas" y la vista que la
// reabre (Jugar/Analizar). Deliberadamente NO en sessionStorage (decisión 3 del plan): `route()`
// es navegación SPA, nunca hay un unload real que justifique persistir esto — y el guard de
// take-once solo tiene sentido dentro de ESTA sesión de pestaña.
export type PendingOpenMode = 'jugar' | 'analizar'

export interface PendingOpen {
  id: string
  mode: PendingOpenMode
  sgf: string
  /** RankLevel sin tipar (solo mode='jugar'); el consumidor valida su forma antes de usarlo. */
  opponent?: unknown
}

let pending: PendingOpen | null = null

export function setPendingOpen(value: PendingOpen): void {
  pending = value
}

/** Toma el pendingOpen SOLO si su modo coincide (y en ese caso lo consume). Un modo equivocado NO
 * lo consume ni lo devuelve: la otra vista todavía puede necesitarlo si la navegación real no
 * coincidió con la esperada. */
export function takePendingOpen(mode: PendingOpenMode): PendingOpen | null {
  if (pending === null || pending.mode !== mode) return null
  const value = pending
  pending = null
  return value
}

/** Solo para tests: el singleton vive en module scope y persiste entre casos si no se limpia. */
export function resetPendingOpen(): void {
  pending = null
}
