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
  it('rápido < normal < preciso en las tres palancas', () => {
    expect(speedSettings('fast')).toEqual({ sweepVisits: 20, refineVisits: 100, interactiveVisits: 100 })
    expect(speedSettings('normal')).toEqual({ sweepVisits: 25, refineVisits: 200, interactiveVisits: 200 })
    expect(speedSettings('precise')).toEqual({ sweepVisits: 40, refineVisits: 400, interactiveVisits: 400 })
  })

  it('el barrido siempre cuesta MUCHO menos que el refinamiento: es lo que se paga 42 veces', () => {
    // La relación que hace que las dos pasadas valgan la pena. Si el barrido se acercara al
    // refinamiento, se estaría pagando el precio alto en TODAS las posiciones otra vez — que es
    // exactamente el reparto uniforme que estas dos pasadas reemplazan.
    for (const speed of ['fast', 'normal', 'precise'] as const) {
      const { sweepVisits, refineVisits } = speedSettings(speed)
      expect(refineVisits).toBeGreaterThanOrEqual(sweepVisits * 4)
    }
  })

  it('el barrido no baja de 20 visitas ni en Rápido: de él sale la selección de qué refinar', () => {
    // Un barrido demasiado ruidoso elige mal las posiciones a afinar, y refinar las equivocadas es
    // peor que refinar pocas.
    expect(speedSettings('fast').sweepVisits).toBeGreaterThanOrEqual(20)
  })

  it('refinar un salto grande da la misma calidad que un análisis pedido a mano', () => {
    for (const speed of ['fast', 'normal', 'precise'] as const) {
      const { refineVisits, interactiveVisits } = speedSettings(speed)
      expect(refineVisits).toBe(interactiveVisits)
    }
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
