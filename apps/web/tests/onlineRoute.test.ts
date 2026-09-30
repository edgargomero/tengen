import { describe, expect, it } from 'vitest'
import { onlineRoomIdFromPath } from '../src/online/onlineRoute'

describe('onlineRoomIdFromPath', () => {
  it('extrae el roomId de /online/:id', () => {
    expect(onlineRoomIdFromPath('/online/abc123')).toBe('abc123')
    expect(onlineRoomIdFromPath('/online/abc123/')).toBe('abc123')
  })
  it('devuelve null en cualquier otra ruta', () => {
    for (const p of ['/', '/jugar', '/online', '/online/', '/online/a/b', '/onlinex/a', '/diagnostico'])
      expect(onlineRoomIdFromPath(p)).toBeNull()
  })
  it('decodifica el id', () => {
    expect(onlineRoomIdFromPath('/online/a%20b')).toBe('a b')
  })
})
