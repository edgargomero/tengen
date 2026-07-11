// Persistencia de la partida en curso en un `Storage` (localStorage en browser). Puro, Node-testeable.
//
// `Storage` INYECTADO (no se toca el global `localStorage`): no existe en Vitest/Node, y el caller
// de browser pasa `window.localStorage`. Se testea con un mock in-memory que implemente StorageLike.
//
// Serialización: `{ opponent, sgf, cursorPath }` bajo una clave versionada. El SGF reusa el
// round-trip idempotente de sgf.ts y NO lleva `opponent` (decisión de Task 5: el SGF es solo la
// partida; el oponente es un dato de sesión aparte, así que viaja fuera del SGF en este payload).
// El CURSOR se guarda como PATH de índices de hijo desde la raíz (no como id numérico): los ids se
// reasignan al re-importar, el path no. Ante dato ausente o corrupto → `null` (nunca lanza): la app
// arranca en "Nueva Partida".
//
// NO se bumpea `STORAGE_KEY` al cambiar la forma del payload (Task 2 → Task 5): el nuevo type guard
// exige un `opponent` válido, así que un payload viejo `{sgf, cursorPath}` (sin `opponent`) ya cae
// fuera de la forma esperada y `loadGame` devuelve `null` limpio — el guard más estricto reemplaza
// la necesidad de versionar la clave.
import type { RankLevel } from '@tengen/engine'
import { GameTree } from './gameTree'
import { exportSgf, importSgf } from './sgf'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_KEY = 'tengen:game:v1'

interface PersistedGame {
  opponent: RankLevel
  sgf: string
  cursorPath: number[]
}

/** Type guard de `RankLevel` (unión discriminada por `kind`); no valida el rango de `rank` contra
 * `HUMAN_RANKS` (alcanza con la forma: un rank fuera de catálogo es un problema de otra capa). */
function isRankLevel(value: unknown): value is RankLevel {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.kind === 'human') return typeof v.rank === 'string'
  if (v.kind === 'kata') return typeof v.visits === 'number'
  return false
}

/** Type guard del payload persistido (defensa ante JSON con forma equivocada, incluido el payload
 * viejo sin `opponent` de Task 2: al exigir `opponent` válido, ese payload ya no matchea). */
function isPersistedGame(value: unknown): value is PersistedGame {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    isRankLevel(v.opponent) &&
    typeof v.sgf === 'string' &&
    Array.isArray(v.cursorPath) &&
    v.cursorPath.every((n) => typeof n === 'number')
  )
}

/** Guarda la partida (oponente + SGF del árbol + path del cursor) bajo la clave versionada. */
export function saveGame(storage: StorageLike, opponent: RankLevel, tree: GameTree): void {
  const payload: PersistedGame = {
    opponent,
    sgf: exportSgf(tree),
    cursorPath: tree.pathTo(tree.current),
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

/**
 * Carga la partida: parsea el JSON, `importSgf`, y navega al `cursorPath`. Devuelve `null` (sin
 * lanzar) si no hay dato, está corrupto, o tiene forma inválida (incl. `opponent` ausente/con `kind`
 * desconocido, y el payload viejo v1 sin `opponent`). Si el path del cursor ya no existe, deja el
 * cursor en la raíz (el árbol sigue siendo válido).
 */
export function loadGame(storage: StorageLike): { opponent: RankLevel; tree: GameTree } | null {
  try {
    // getItem DENTRO del try: en modo privado / storage bloqueado, `storage.getItem` puede lanzar
    // (p.ej. SecurityError). Ese fallo debe resolverse igual que un JSON corrupto: `null`.
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPersistedGame(parsed)) return null
    const tree = importSgf(parsed.sgf)
    tree.navigateToPath(parsed.cursorPath) // si es inválido, no muta el cursor (queda en la raíz)
    return { opponent: parsed.opponent, tree }
  } catch {
    return null
  }
}

/** Borra la partida guardada. */
export function clearGame(storage: StorageLike): void {
  storage.removeItem(STORAGE_KEY)
}
