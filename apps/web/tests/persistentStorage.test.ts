import { describe, expect, it, vi } from 'vitest'
import {
  ensurePersistentStorage,
  isDurable,
  type PersistableStorage,
} from '../src/models/persistentStorage'

function makeStorage(over: Partial<PersistableStorage> = {}): PersistableStorage {
  return {
    persisted: vi.fn(async () => false),
    persist: vi.fn(async () => true),
    ...over,
  }
}

describe('ensurePersistentStorage', () => {
  it('no vuelve a pedir si el origen YA es persistente', async () => {
    const storage = makeStorage({ persisted: vi.fn(async () => true) })
    await expect(ensurePersistentStorage(storage)).resolves.toBe('already-persisted')
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('pide y reporta la concesión', async () => {
    const storage = makeStorage()
    await expect(ensurePersistentStorage(storage)).resolves.toBe('granted')
    expect(storage.persist).toHaveBeenCalledOnce()
  })

  it('reporta la negativa en vez de asumir durabilidad', async () => {
    const storage = makeStorage({ persist: vi.fn(async () => false) })
    await expect(ensurePersistentStorage(storage)).resolves.toBe('denied')
  })

  it('sin Storage API responde "unsupported", no lanza', async () => {
    await expect(ensurePersistentStorage(undefined)).resolves.toBe('unsupported')
    // Objeto presente pero sin los métodos (navegadores viejos, contextos recortados).
    await expect(ensurePersistentStorage({} as PersistableStorage)).resolves.toBe('unsupported')
  })

  it('un fallo de la API se degrada a "denied" (para el llamador significa lo mismo)', async () => {
    const boom = makeStorage({
      persisted: vi.fn(async () => {
        throw new Error('SecurityError')
      }),
    })
    await expect(ensurePersistentStorage(boom)).resolves.toBe('denied')
  })

  it('isDurable distingue garantía real de "sigue siendo desalojable"', () => {
    expect(isDurable('already-persisted')).toBe(true)
    expect(isDurable('granted')).toBe(true)
    expect(isDurable('denied')).toBe(false)
    expect(isDurable('unsupported')).toBe(false)
  })
})
