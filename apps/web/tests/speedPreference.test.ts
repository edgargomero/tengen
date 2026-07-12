import { describe, expect, it } from 'vitest'
import type { StorageLike } from '../src/game/persistence'
import { DEFAULT_ANALYZE_SPEED, loadAnalyzeSpeed, saveAnalyzeSpeed, speedSettings } from '../src/analysis/speedPreference'

/** Mock in-memory de StorageLike (mismo patrón que persistence.test.ts). */
function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('speedSettings', () => {
  it('rápido < normal < preciso en ambos visits, normal coincide con el comportamiento actual', () => {
    expect(speedSettings('fast')).toEqual({ reviewVisits: 50, interactiveVisits: 100 })
    expect(speedSettings('normal')).toEqual({ reviewVisits: 100, interactiveVisits: 200 })
    expect(speedSettings('precise')).toEqual({ reviewVisits: 200, interactiveVisits: 400 })
  })
})

describe('saveAnalyzeSpeed / loadAnalyzeSpeed — round-trip', () => {
  it('guarda y recupera cada nivel', () => {
    const storage = memStorage()
    saveAnalyzeSpeed(storage, 'fast')
    expect(loadAnalyzeSpeed(storage)).toBe('fast')
    saveAnalyzeSpeed(storage, 'precise')
    expect(loadAnalyzeSpeed(storage)).toBe('precise')
  })
})

describe('loadAnalyzeSpeed — casos de fallo (nunca lanza, cae a Normal)', () => {
  it('storage vacío → Normal', () => {
    expect(loadAnalyzeSpeed(memStorage())).toBe(DEFAULT_ANALYZE_SPEED)
    expect(DEFAULT_ANALYZE_SPEED).toBe('normal')
  })

  it('JSON corrupto → Normal', () => {
    const storage = memStorage()
    storage.map.set('tengen:analyze-speed:v1', '{no es json válido')
    expect(loadAnalyzeSpeed(storage)).toBe('normal')
  })

  it('valor con forma equivocada (no es uno de los 3 niveles) → Normal', () => {
    const storage = memStorage()
    storage.map.set('tengen:analyze-speed:v1', JSON.stringify('turbo'))
    expect(loadAnalyzeSpeed(storage)).toBe('normal')
  })

  it('storage.getItem lanza (modo privado / storage bloqueado) → Normal, no propaga', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new DOMException('storage blocked', 'SecurityError')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    expect(() => loadAnalyzeSpeed(storage)).not.toThrow()
    expect(loadAnalyzeSpeed(storage)).toBe('normal')
  })
})
