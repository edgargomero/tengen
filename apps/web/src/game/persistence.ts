// Persistencia de la partida en curso en un `Storage` (localStorage en browser). Puro, Node-testeable.
//
// `Storage` INYECTADO (no se toca el global `localStorage`): no existe en Vitest/Node, y el caller
// de browser pasa `window.localStorage`. Se testea con un mock in-memory que implemente StorageLike.
//
// Serialización: `{ sgf, cursorPath }` bajo una clave versionada. El SGF reusa el round-trip
// idempotente de sgf.ts. El CURSOR se guarda como PATH de índices de hijo desde la raíz (no como id
// numérico): los ids se reasignan al re-importar, el path no. Ante dato ausente o corrupto → `null`
// (nunca lanza): la app arranca en "Nueva Partida".
import { GameTree } from './gameTree'
import { exportSgf, importSgf } from './sgf'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_KEY = 'tengen:game:v1'

interface PersistedGame {
  sgf: string
  cursorPath: number[]
}

/** Type guard del payload persistido (defensa ante JSON con forma equivocada). */
function isPersistedGame(value: unknown): value is PersistedGame {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.sgf === 'string' &&
    Array.isArray(v.cursorPath) &&
    v.cursorPath.every((n) => typeof n === 'number')
  )
}

/** Guarda la partida (SGF del árbol + path del cursor) bajo la clave versionada. */
export function saveGame(storage: StorageLike, tree: GameTree): void {
  const payload: PersistedGame = { sgf: exportSgf(tree), cursorPath: tree.pathTo(tree.current) }
  storage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

/**
 * Carga la partida: parsea el JSON, `importSgf`, y navega al `cursorPath`. Devuelve `null` (sin
 * lanzar) si no hay dato o está corrupto. Si el path del cursor ya no existe, deja el cursor en la
 * raíz (el árbol sigue siendo válido).
 */
export function loadGame(storage: StorageLike): GameTree | null {
  const raw = storage.getItem(STORAGE_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPersistedGame(parsed)) return null
    const tree = importSgf(parsed.sgf)
    tree.navigateToPath(parsed.cursorPath) // si es inválido, no muta el cursor (queda en la raíz)
    return tree
  } catch {
    return null
  }
}

/** Borra la partida guardada. */
export function clearGame(storage: StorageLike): void {
  storage.removeItem(STORAGE_KEY)
}
