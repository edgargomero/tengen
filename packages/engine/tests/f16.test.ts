import { describe, expect, it } from 'vitest'
import { f32ToF16 } from '../src/bench/f16'

describe('f32ToF16', () => {
  it('convierte valores exactos conocidos', () => {
    const out = f32ToF16(new Float32Array([0, 1, -1, 0.5, 2, -0.375]))
    expect(Array.from(out)).toEqual([0x0000, 0x3c00, 0xbc00, 0x3800, 0x4000, 0xb600])
  })
  it('satura a infinito por encima del máximo half (65504)', () => {
    const out = f32ToF16(new Float32Array([1e6, -1e6]))
    expect(out[0]).toBe(0x7c00)
    expect(out[1]).toBe(0xfc00)
  })
  it('propaga NaN', () => {
    const out = f32ToF16(new Float32Array([Number.NaN]))
    expect((out[0]! & 0x7c00) === 0x7c00 && (out[0]! & 0x03ff) !== 0).toBe(true)
  })
  it('redondea al representable más cercano', () => {
    // 1.0009765625 = 1 + 2^-10 es exacto en half; 1.0004 debe redondear a 1.0
    const out = f32ToF16(new Float32Array([1.0004]))
    expect(out[0]).toBe(0x3c00)
  })
  it('redondea subnormales al par', () => {
    // 2^-25 es el punto medio exacto entre 0x0000 y 0x0001 → al par: 0x0000
    // 2^-24 es exactamente el subnormal mínimo 0x0001
    const out = f32ToF16(new Float32Array([2 ** -25, 2 ** -24]))
    expect(out[0]).toBe(0x0000)
    expect(out[1]).toBe(0x0001)
    // apenas por encima del punto medio 2^-25: los sticky bits deben forzar redondeo hacia arriba
    const above = f32ToF16(new Float32Array([2.9805864443233077e-8]))
    expect(above[0]).toBe(0x0001)
  })
})
