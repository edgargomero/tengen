import { describe, expect, it } from 'vitest'
import { netManifest, requireManifestEntry } from '../src/models/netManifest'

describe('netManifest', () => {
  it('requireManifestEntry(b18) devuelve la entrada exacta', () => {
    expect(requireManifestEntry('b18')).toEqual({
      opfsName: 'b18c384nbt-kata1.fp32.v1.onnx',
      sourceUrl: '/models/b18c384nbt-kata1.fp32.onnx',
      bytes: 115800125,
    })
  })

  it('requireManifestEntry(humanv0) devuelve la entrada exacta', () => {
    expect(requireManifestEntry('humanv0')).toEqual({
      opfsName: 'b18c384nbt-humanv0.fp32.v1.onnx',
      sourceUrl: '/models/b18c384nbt-humanv0.fp32.onnx',
      bytes: 108040143,
    })
  })

  it('requireManifestEntry(b10) lanza (red aún no disponible)', () => {
    expect(() => requireManifestEntry('b10')).toThrow('red b10 aún no disponible en apps/web')
  })

  it('netManifest no tiene entrada para b10', () => {
    expect(netManifest.b10).toBeUndefined()
  })
})
