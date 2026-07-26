import { describe, expect, it } from 'vitest'
import type { StorageLike } from '../src/game/persistence'
import {
  DEFAULT_PV_DETAIL,
  loadPvDetail,
  PV_DETAIL_LEVELS,
  pvDetailMoves,
  savePvDetail,
} from '../src/analysis/pvDetailPreference'

/** Mock in-memory de StorageLike (mismo patrón que persistence.test.ts / speedPreference.test.ts). */
function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('pvDetailMoves', () => {
  it('los niveles crecen y el tope llega a las 11 jugadas que el motor produce hoy', () => {
    expect(pvDetailMoves('short')).toBe(3)
    expect(pvDetailMoves('medium')).toBe(6)
    // `analysisPvLen: 10` en el motor → `pvDepth = 11`. Pedir más no dibujaría más.
    expect(pvDetailMoves('full')).toBe(11)
  })

  it('el default es el comportamiento previo a existir esta preferencia: dibujar todo', () => {
    expect(DEFAULT_PV_DETAIL).toBe('full')
    expect(PV_DETAIL_LEVELS.at(-1)).toBe('full')
  })
})

describe('savePvDetail / loadPvDetail', () => {
  it('round-trip de cada nivel', () => {
    const storage = memStorage()
    for (const level of PV_DETAIL_LEVELS) {
      savePvDetail(storage, level)
      expect(loadPvDetail(storage)).toBe(level)
    }
  })

  it('storage vacío → el default, sin lanzar', () => {
    expect(loadPvDetail(memStorage())).toBe(DEFAULT_PV_DETAIL)
  })

  it('JSON corrupto o valor de otra versión → el default, sin lanzar', () => {
    const storage = memStorage()
    storage.map.set('tengen:pv-detail:v1', '{no es json')
    expect(loadPvDetail(storage)).toBe(DEFAULT_PV_DETAIL)
    storage.map.set('tengen:pv-detail:v1', '"larguisima"')
    expect(loadPvDetail(storage)).toBe(DEFAULT_PV_DETAIL)
  })
})
