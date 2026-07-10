import { describe, expect, it } from 'vitest'
import golden9d from './fixtures/meta/preaz_9d.json'
import golden20k from './fixtures/meta/preaz_20k.json'
import golden9dArea81 from './fixtures/meta/preaz_9d_area81.json'
import { fillMetaV1, inverseRank, META_CHANNELS } from '../src/encoding/metaV1'
import type { HumanRank } from '../src/types'

// Goldens generados con el sgfmetadata.py REAL de katago-onnx (AGPL, herramienta local, no
// commiteada como código) — ver docs/research/fase-engine/fuentes.md §2 y
// .superpowers/sdd/task-6-report.md para el driver exacto usado.
const goldens: { rank: HumanRank; boardArea: number; meta: number[] }[] = [
  golden9d as { rank: HumanRank; boardArea: number; meta: number[] },
  golden20k as { rank: HumanRank; boardArea: number; meta: number[] },
  golden9dArea81 as { rank: HumanRank; boardArea: number; meta: number[] },
]

describe('metaV1', () => {
  it('inverseRank: 9d=1, 1d=9, 1k=10, 20k=29', () => {
    expect(inverseRank('9d')).toBe(1)
    expect(inverseRank('1d')).toBe(9)
    expect(inverseRank('1k')).toBe(10)
    expect(inverseRank('20k')).toBe(29)
  })

  it('invariantes: termómetro suma min(invRank,34), one-hots, fecha módulo 1, [74]=0.5', () => {
    const out = new Float32Array(META_CHANNELS)
    fillMetaV1({ rank: '9d', boardArea: 361, out })
    const thermoPla = Array.from(out.slice(6, 40)).reduce((a, b) => a + b, 0)
    const thermoOpp = Array.from(out.slice(40, 74)).reduce((a, b) => a + b, 0)
    expect(thermoPla).toBe(Math.min(inverseRank('9d'), 34)) // = 1
    expect(thermoOpp).toBe(Math.min(inverseRank('9d'), 34)) // = 1
    expect(Array.from(out.slice(75, 82)).reduce((a, b) => a + b, 0)).toBe(1) // time-control one-hot
    expect(out[74]).toBe(0.5)
    for (let i = 0; i < 32; i++) {
      const cos = out[87 + i * 2]!
      const sin = out[87 + i * 2 + 1]!
      expect(cos * cos + sin * sin).toBeCloseTo(1, 5)
    }
  })

  it('termómetro suma min(invRank,34) para 20k (invRank=29, dentro del rango completo)', () => {
    const out = new Float32Array(META_CHANNELS)
    fillMetaV1({ rank: '20k', boardArea: 361, out })
    const thermoPla = Array.from(out.slice(6, 40)).reduce((a, b) => a + b, 0)
    expect(thermoPla).toBe(29)
  })

  it('source one-hot KGS en [153], resto de [151..166] en 0', () => {
    const out = new Float32Array(META_CHANNELS)
    fillMetaV1({ rank: '9d', boardArea: 361, out })
    expect(out[153]).toBe(1)
    const sourceSum = Array.from(out.slice(151, 167)).reduce((a, b) => a + b, 0)
    expect(sourceSum).toBe(1)
  })

  it.each(goldens)(
    'coincide con el golden de sgfmetadata.py ($rank, boardArea=$boardArea)',
    ({ rank, boardArea, meta }) => {
      const out = new Float32Array(META_CHANNELS)
      fillMetaV1({ rank, boardArea, out })
      for (let i = 0; i < META_CHANNELS; i++) {
        expect(out[i]).toBeCloseTo(meta[i]!, 5)
      }
    },
  )
})
