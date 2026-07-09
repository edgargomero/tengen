/** Convierte float32 a float16 (IEEE 754 half) como Uint16Array — el formato
 *  que onnxruntime-web 1.24 usa para tensores 'float16'. */
export function f32ToF16(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length)
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  for (let i = 0; i < src.length; i++) {
    f32[0] = src[i]!
    const x = u32[0]!
    const sign = (x >>> 16) & 0x8000
    const exp = (x >>> 23) & 0xff
    const mant = x & 0x7fffff
    let half: number
    if (exp === 0xff) {
      half = sign | 0x7c00 | (mant ? 0x0200 : 0) // Inf / NaN
    } else {
      const e = exp - 127 + 15
      if (e >= 0x1f) {
        half = sign | 0x7c00 // overflow → Inf
      } else if (e <= 0) {
        if (e < -10) {
          half = sign // underflow → ±0
        } else {
          // subnormal: mantisa con bit implícito, desplazada, preservando sticky bits
          const shift = 1 - e
          const full = mant | 0x800000
          const m = (full >> shift) | ((full & ((1 << shift) - 1)) ? 1 : 0)
          half = sign | ((m + 0x0fff + ((m >> 13) & 1)) >> 13)
        }
      } else {
        // normal, con redondeo al par en el bit 13
        const rounded = mant + 0x0fff + ((mant >> 13) & 1)
        half = sign | (((e << 10) + (rounded >> 13)) | 0)
      }
    }
    out[i] = half
  }
  return out
}

/** Decodifica float16 (IEEE-754 half, Uint16Array de ORT) a float32. */
export function f16ToF32(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) {
    const h = src[i]!
    const sign = (h & 0x8000) ? -1 : 1
    const exp = (h >> 10) & 0x1f
    const mant = h & 0x3ff
    if (exp === 0) out[i] = sign * Math.pow(2, -14) * (mant / 1024)
    else if (exp === 0x1f) out[i] = mant ? NaN : sign * Infinity
    else out[i] = sign * Math.pow(2, exp - 15) * (1 + mant / 1024)
  }
  return out
}
