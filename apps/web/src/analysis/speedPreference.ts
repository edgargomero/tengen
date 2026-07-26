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
  /** Primera pasada: TODAS las posiciones de la partida, a visitas bajas. */
  sweepVisits: number
  /** Segunda pasada: sólo las posiciones con un salto grande de score. */
  refineVisits: number
  /** Análisis de una posición pedido por el usuario ("Analizar esta posición"). */
  interactiveVisits: number
}

/**
 * ── El presupuesto se reparte por importancia, no por igual ────────────────────────────────────
 *
 * Antes, el review gastaba las MISMAS visitas en las 42 posiciones de una partida de 41 jugadas. Como
 * 1 visita = 1 hoja expandida = 1 inferencia de red, ese reparto uniforme es el costo dominante de la
 * pantalla: en `normal` eran 42 × 100 = 4.200 inferencias ≈ 15 min a las 4,64 inf/s medidas en fase 0
 * (`docs/research/fase0/resultados.md`), y el usuario no veía un mapa completo de la partida hasta el
 * final. El 42× era la única palanca que nadie tocaba: bajar las visitas más allá de 50/100/200 ya
 * degradaba calidad sin ganar mucho (KaTrain usa `fast_visits=25`).
 *
 * Ahora son dos pasadas. En `normal`: barrido de 42 × 25 = 1.050 inferencias ≈ 3,8 min — el mapa
 * COMPLETO de la partida cuatro veces antes que antes — y después las posiciones que de verdad
 * importan se re-analizan a 200, el doble de las 100 de antes. **El resultado es mejor y más rápido a
 * la vez**, porque las posiciones aburridas dejaron de pagar como las decisivas.
 *
 * El barrido no baja de 20 visitas ni en `fast`: de él sale la SELECCIÓN de qué refinar, y un barrido
 * demasiado ruidoso elige mal — refinaría las posiciones equivocadas, que es peor que refinar poco.
 *
 * `refineVisits` coincide con `interactiveVisits` en los tres niveles, y no es casualidad: refinar un
 * salto grande es exactamente darle a esa posición la calidad de un análisis pedido a mano. Siguen
 * siendo dos campos porque son dos decisiones de producto, y nada obliga a que sigan juntas.
 */
const SPEED_SETTINGS: Record<AnalyzeSpeed, SpeedSettings> = {
  fast: { sweepVisits: 20, refineVisits: 100, interactiveVisits: 100 },
  normal: { sweepVisits: 25, refineVisits: 200, interactiveVisits: 200 },
  precise: { sweepVisits: 40, refineVisits: 400, interactiveVisits: 400 },
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
