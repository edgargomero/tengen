// Fase Aprender T4: progreso por ejercicio en localStorage. Patrón exacto de game/persistence.ts:
// StorageLike INYECTADO (no se toca el global), clave versionada, type guard ante JSON con forma
// equivocada, y fallback SILENCIOSO ({} al leer, no-op al escribir) — perder progreso nunca rompe
// la app. Sin D1 en v1: la nube es fase posterior si la sección prende.
import type { StorageLike } from '../game/persistence'

const STORAGE_KEY = 'tengen:learn:v1'

export interface ExerciseProgress {
  /** 'resuelto' es pegajoso: un fallo posterior suma intento pero no degrada el estado. */
  estado: 'resuelto' | 'intentado'
  intentos: number
  /** ISO-8601 del PRIMER resuelto (no se pisa al re-resolver). */
  resueltoEn?: string
}

export type ProgressMap = Record<string, ExerciseProgress>

function isExerciseProgress(value: unknown): value is ExerciseProgress {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    (v.estado === 'resuelto' || v.estado === 'intentado') &&
    typeof v.intentos === 'number' &&
    (v.resueltoEn === undefined || typeof v.resueltoEn === 'string')
  )
}

function isProgressMap(value: unknown): value is ProgressMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(isExerciseProgress)
}

/** Progreso completo. Dato ausente, corrupto, con forma inválida o storage que lanza → {}. */
export function loadProgress(storage: StorageLike): ProgressMap {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    return isProgressMap(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Registra el desenlace de un intento. `now` inyectable para tests (default: reloj real).
 * Nunca lanza: si el storage falla (cuota, modo privado), el progreso simplemente no se guarda.
 */
export function recordResult(
  storage: StorageLike,
  id: string,
  outcome: 'resuelto' | 'fallado',
  now: () => string = () => new Date().toISOString(),
): void {
  try {
    const progress = loadProgress(storage)
    const prev = progress[id]
    const solved = outcome === 'resuelto' || prev?.estado === 'resuelto'
    progress[id] = {
      estado: solved ? 'resuelto' : 'intentado',
      intentos: (prev?.intentos ?? 0) + 1,
      ...(prev?.resueltoEn !== undefined
        ? { resueltoEn: prev.resueltoEn }
        : outcome === 'resuelto'
          ? { resueltoEn: now() }
          : {}),
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // Fallback silencioso: el progreso es un extra, nunca un bloqueo.
  }
}
