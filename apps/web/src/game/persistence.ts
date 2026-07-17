// Persistencia de la partida en curso en un `Storage` (localStorage en browser). Puro, Node-testeable.
//
// `Storage` INYECTADO (no se toca el global `localStorage`): no existe en Vitest/Node, y el caller
// de browser pasa `window.localStorage`. Se testea con un mock in-memory que implemente StorageLike.
//
// Serialización: `{ opponent, sgf, cursorPath, cloudId? }` bajo una clave versionada. El SGF reusa el
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
import { decodeClockConfig, decodeClockState, encodeClockConfig, encodeClockState } from './sgfClockCodec'

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
  /** Id de la fila en D1 (Fase 5) — presente solo si la partida se guardó en la nube con sesión
   * activa. Campo NUEVO sin bump de STORAGE_KEY: el guard lo acepta ausente (payloads pre-Fase 5
   * siguen cargando) y JSON.stringify omite undefined al guardar. */
  cloudId?: string
}

/** Type guard de `RankLevel` (unión discriminada por `kind`); no valida el rango de `rank` contra
 * `HUMAN_RANKS` (alcanza con la forma: un rank fuera de catálogo es un problema de otra capa).
 * Exportado (Fase 5): main.tsx lo reusa para validar el `opponent` de una partida reabierta desde
 * "Mis partidas" (mismo shape, viene de JSON de red en vez de localStorage). */
export function isRankLevel(value: unknown): value is RankLevel {
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
    v.cursorPath.every((n) => typeof n === 'number') &&
    (v.cloudId === undefined || typeof v.cloudId === 'string')
  )
}

/** Guarda la partida (oponente + SGF del árbol + path del cursor + id de nube si existe) bajo la
 * clave versionada. */
export function saveGame(
  storage: StorageLike,
  opponent: RankLevel,
  tree: GameTree,
  cloudId?: string,
): void {
  const clock = tree.meta.clock
  // Sin reloj: `exportSgf(tree)` sin segundo argumento, comportamiento IDÉNTICO a antes. Con reloj:
  // config en la raíz, estado vivo en el nodo ACTUAL (el tip, en Modo Jugar — ver sgfClockCodec.ts).
  const sgf = clock
    ? exportSgf(tree, (node) => {
        if (node === tree.root) return encodeClockConfig(clock.config)
        if (node === tree.current) return encodeClockState(clock.state)
        return undefined
      })
    : exportSgf(tree)
  const payload: PersistedGame = {
    opponent,
    sgf,
    cursorPath: tree.pathTo(tree.current),
    ...(cloudId !== undefined ? { cloudId } : {}),
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

/**
 * Carga la partida: parsea el JSON, `importSgf`, y navega al `cursorPath`. Devuelve `null` (sin
 * lanzar) si no hay dato, está corrupto, o tiene forma inválida (incl. `opponent` ausente/con `kind`
 * desconocido, y el payload viejo v1 sin `opponent`). Si el path del cursor ya no existe, deja el
 * cursor en la raíz (el árbol sigue siendo válido).
 */
export function loadGame(
  storage: StorageLike,
): { opponent: RankLevel; tree: GameTree; cloudId?: string } | null {
  try {
    // getItem DENTRO del try: en modo privado / storage bloqueado, `storage.getItem` puede lanzar
    // (p.ej. SecurityError). Ese fallo debe resolverse igual que un JSON corrupto: `null`.
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPersistedGame(parsed)) return null

    // Intenta decodificar en CADA nodo (barato, y `decode*` devuelve null sin ruido si las
    // propiedades no están) — se queda con el último resultado no-nulo de cada uno. En la práctica
    // hay a lo sumo un nodo con cada tipo de dato (raíz para la config, el tip para el estado).
    let clockConfig: ReturnType<typeof decodeClockConfig> = null
    let clockState: ReturnType<typeof decodeClockState> = null
    const tree = importSgf(parsed.sgf, (_node, data) => {
      clockConfig = decodeClockConfig(data) ?? clockConfig
      clockState = decodeClockState(data) ?? clockState
    })
    if (clockConfig && clockState) tree.meta.clock = { config: clockConfig, state: clockState }

    tree.navigateToPath(parsed.cursorPath) // si es inválido, no muta el cursor (queda en la raíz)
    return {
      opponent: parsed.opponent,
      tree,
      ...(parsed.cloudId !== undefined ? { cloudId: parsed.cloudId } : {}),
    }
  } catch {
    return null
  }
}

/** Borra la partida guardada. */
export function clearGame(storage: StorageLike): void {
  storage.removeItem(STORAGE_KEY)
}
