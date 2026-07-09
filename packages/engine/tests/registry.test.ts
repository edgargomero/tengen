import { describe, expect, it } from 'vitest'
import { MODELS } from '../src/bench/registry'

describe('MODELS', () => {
  it('ids únicos y con extensión .onnx', () => {
    const ids = MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.endsWith('.onnx')).toBe(true)
  })
  it('URLs https válidas en los descargables', () => {
    for (const m of MODELS.filter((m) => m.url !== '')) {
      expect(m.url.startsWith('https://')).toBe(true)
    }
  })
  it('los .fp16 declaran dtype float16', () => {
    for (const m of MODELS) {
      if (m.id.includes('fp16')) expect(m.dtype).toBe('float16')
    }
  })
  it('incluye el control b28 de kaya y el b18 de WeiqiPlayground', () => {
    expect(MODELS.some((m) => m.id.includes('b28c512nbt') && m.dtype === 'float16')).toBe(true)
    expect(MODELS.some((m) => m.id === 'b18c384-weiqiplayground.fp32.onnx')).toBe(true)
  })
})
