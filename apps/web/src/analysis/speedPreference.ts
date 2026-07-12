// Preferencia de velocidad de Modo Analizar (Fase 3a fix-wave, pedido de Edgar: "asignar más
// recursos" al review — no hay servidor que escalar (motor 100% client-side), pero sí dos palancas ya
// soportadas por el código: visitas por posición. `batchSize` queda deliberadamente fuera (subirlo
// por encima de 8 no está medido, ver plan).
//
// Mismo patrón que `game/persistence.ts`: `StorageLike` inyectada, key versionada, type guard con
// fallback ante dato ausente/corrupto — nunca lanza.
import type { StorageLike } from '../game/persistence'

export type AnalyzeSpeed = 'fast' | 'normal' | 'precise'

export interface SpeedSettings {
  reviewVisits: number
  interactiveVisits: number
}

/** `normal` = comportamiento actual (REVIEW_VISITS=100/INTERACTIVE_VISITS=200 de AnalyzeView.tsx). */
const SPEED_SETTINGS: Record<AnalyzeSpeed, SpeedSettings> = {
  fast: { reviewVisits: 50, interactiveVisits: 100 },
  normal: { reviewVisits: 100, interactiveVisits: 200 },
  precise: { reviewVisits: 200, interactiveVisits: 400 },
}

export const DEFAULT_ANALYZE_SPEED: AnalyzeSpeed = 'normal'

const STORAGE_KEY = 'tengen:analyze-speed:v1'

export function speedSettings(speed: AnalyzeSpeed): SpeedSettings {
  return SPEED_SETTINGS[speed]
}

function isAnalyzeSpeed(value: unknown): value is AnalyzeSpeed {
  return value === 'fast' || value === 'normal' || value === 'precise'
}

/** Guarda el nivel elegido bajo la clave versionada. */
export function saveAnalyzeSpeed(storage: StorageLike, speed: AnalyzeSpeed): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(speed))
}

/** Carga el nivel guardado. Devuelve `DEFAULT_ANALYZE_SPEED` (nunca lanza) ante dato ausente,
 *  corrupto, o con forma inválida — mismo criterio que `loadGame` de persistence.ts. */
export function loadAnalyzeSpeed(storage: StorageLike): AnalyzeSpeed {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_ANALYZE_SPEED
    const parsed: unknown = JSON.parse(raw)
    return isAnalyzeSpeed(parsed) ? parsed : DEFAULT_ANALYZE_SPEED
  } catch {
    return DEFAULT_ANALYZE_SPEED
  }
}
