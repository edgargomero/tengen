// Fase Aprender T4: progreso por ejercicio en localStorage — patrón exacto de game/persistence.ts
// (StorageLike inyectado, clave versionada, type guard, fallback silencioso a {}).
import { describe, expect, it } from 'vitest'
import { loadProgress, recordResult } from '../src/learn/progress'
import type { StorageLike } from '../src/game/persistence'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v
    },
    removeItem: (k) => {
      delete data[k]
    },
  }
}

const KEY = 'tengen:learn:v1'

describe('loadProgress', () => {
  it('sin dato → {}', () => {
    expect(loadProgress(memoryStorage())).toEqual({})
  })

  it('JSON corrupto o con forma inválida → {} (nunca lanza)', () => {
    expect(loadProgress(memoryStorage({ [KEY]: 'no-json{' }))).toEqual({})
    expect(loadProgress(memoryStorage({ [KEY]: JSON.stringify({ a: { estado: 'x' } }) }))).toEqual({})
    expect(loadProgress(memoryStorage({ [KEY]: JSON.stringify([1, 2]) }))).toEqual({})
  })

  it('storage que lanza (modo privado) → {}', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    expect(loadProgress(broken)).toEqual({})
  })
})

describe('recordResult', () => {
  it('un fallo registra intentado con 1 intento', () => {
    const storage = memoryStorage()
    recordResult(storage, 'gokyo-001', 'fallado', () => '2026-08-04T00:00:00Z')
    expect(loadProgress(storage)).toEqual({ 'gokyo-001': { estado: 'intentado', intentos: 1 } })
  })

  it('resolver marca resuelto y fija resueltoEn UNA vez (la primera)', () => {
    const storage = memoryStorage()
    recordResult(storage, 'gokyo-001', 'fallado', () => 't1')
    recordResult(storage, 'gokyo-001', 'resuelto', () => 't2')
    recordResult(storage, 'gokyo-001', 'resuelto', () => 't3')
    expect(loadProgress(storage)).toEqual({
      'gokyo-001': { estado: 'resuelto', intentos: 3, resueltoEn: 't2' },
    })
  })

  it('resuelto es pegajoso: un fallo posterior suma intento pero no degrada el estado', () => {
    const storage = memoryStorage()
    recordResult(storage, 'gokyo-001', 'resuelto', () => 't1')
    recordResult(storage, 'gokyo-001', 'fallado', () => 't2')
    expect(loadProgress(storage)).toEqual({
      'gokyo-001': { estado: 'resuelto', intentos: 2, resueltoEn: 't1' },
    })
  })

  it('ejercicios distintos no se pisan', () => {
    const storage = memoryStorage()
    recordResult(storage, 'a', 'fallado', () => 't')
    recordResult(storage, 'b', 'resuelto', () => 't')
    expect(Object.keys(loadProgress(storage)).sort()).toEqual(['a', 'b'])
  })

  it('storage roto → no lanza (fallback silencioso)', () => {
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    expect(() => recordResult(broken, 'x', 'resuelto', () => 't')).not.toThrow()
  })
})
