import { describe, expect, it } from 'vitest'
import { KATA_STRENGTH_PRESETS, kataStrengthLabel } from '../src/game/opponentStrength'

describe('kataStrengthLabel — presets exactos', () => {
  it('cada preset devuelve su propia etiqueta', () => {
    for (const { visits, label } of KATA_STRENGTH_PRESETS) {
      expect(kataStrengthLabel(visits)).toBe(label)
    }
  })

  it('50/200/500 → baja/media/alta', () => {
    expect(kataStrengthLabel(50)).toBe('Fuerza baja')
    expect(kataStrengthLabel(200)).toBe('Fuerza media')
    expect(kataStrengthLabel(500)).toBe('Fuerza alta')
  })
})

describe('kataStrengthLabel — valores arbitrarios (partidas guardadas / clamp)', () => {
  it('bucketiza por cercanía al preset más próximo', () => {
    expect(kataStrengthLabel(1)).toBe('Fuerza baja') // clamp mínimo de validateConfig
    expect(kataStrengthLabel(100)).toBe('Fuerza baja') // más cerca de 50 que de 200
    expect(kataStrengthLabel(300)).toBe('Fuerza media') // más cerca de 200 que de 500
    expect(kataStrengthLabel(1000)).toBe('Fuerza alta') // muy por encima → alta
  })

  it('en los puntos medios (empate de distancia) cae al preset más bajo, determinista', () => {
    expect(kataStrengthLabel(125)).toBe('Fuerza baja') // |125-50| == |125-200| → baja
    expect(kataStrengthLabel(350)).toBe('Fuerza media') // |350-200| == |350-500| → media
  })

  it('nunca devuelve cadena vacía para un visits válido', () => {
    for (const v of [1, 42, 125, 200, 350, 777, 5000]) {
      expect(kataStrengthLabel(v)).not.toBe('')
    }
  })
})
