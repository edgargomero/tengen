// Cuántas jugadas fantasma de la variación principal se DIBUJAN sobre el tablero.
//
// Es una preferencia de CLARIDAD, no de velocidad, y la distinción importa porque el instinto dice lo
// contrario. La longitud del PV no cuesta nada de calcular: `buildPv` (`analyzeMcts.ts`) es un paseo por
// punteros de un árbol ya construido, cacheado por `(visits, depth)` — cero inferencias de red. La
// relación real va al revés: el PV se corta donde el árbol se quedó sin visitas, así que bajar las
// visitas ya lo acorta como efecto secundario. El PV es la sombra del dial de velocidad, no el dial.
//
// Lo que sí cambia con esto es cuánto tapa el tablero: once piedras fantasma numeradas saltando por el
// goban sin localidad espacial son difíciles de leer, y a veces sólo se quiere ver la respuesta
// inmediata. Ese es el problema que resuelve — mirar, no esperar.
//
// Mismo patrón que `speedPreference.ts`: `StorageLike` inyectada, key versionada, type guard con
// fallback ante dato ausente o corrupto — nunca lanza.
import type { StorageLike } from '../game/persistence'

export type PvDetail = 'short' | 'medium' | 'full'

/** Cuántos vértices del PV se dibujan en cada nivel. `full` = 11, que es lo que produce el motor hoy
 * (`analysisPvLen: 10` en `engine.ts` → `pvDepth = 11`): pedir más no dibujaría más. */
export const PV_DETAIL_MOVES: Record<PvDetail, number> = {
  short: 3,
  medium: 6,
  full: 11,
}

export const PV_DETAIL_LEVELS: PvDetail[] = ['short', 'medium', 'full']

/** `full` es el default: es el comportamiento que la app tenía antes de existir esta preferencia. */
export const DEFAULT_PV_DETAIL: PvDetail = 'full'

const STORAGE_KEY = 'tengen:pv-detail:v1'

export function pvDetailMoves(detail: PvDetail): number {
  return PV_DETAIL_MOVES[detail]
}

function isPvDetail(value: unknown): value is PvDetail {
  return value === 'short' || value === 'medium' || value === 'full'
}

export function savePvDetail(storage: StorageLike, detail: PvDetail): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(detail))
}

/** Carga el nivel guardado. Devuelve `DEFAULT_PV_DETAIL` (nunca lanza) ante dato ausente, corrupto o
 * con forma inválida — mismo criterio que `loadAnalyzeSpeed`/`loadGame`. */
export function loadPvDetail(storage: StorageLike): PvDetail {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_PV_DETAIL
    const parsed: unknown = JSON.parse(raw)
    return isPvDetail(parsed) ? parsed : DEFAULT_PV_DETAIL
  } catch {
    return DEFAULT_PV_DETAIL
  }
}
