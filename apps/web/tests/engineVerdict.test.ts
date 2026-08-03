// El veredicto de la prueba del motor decide un desvío caro: "se va frenando" manda a cazar una fuga de
// memoria, "es lento" manda a bajar presupuesto o convertir una red más chica. Confundirlos cuesta días,
// así que la separación va fijada con tests en vez de quedar a criterio de quien mire los números.
import { describe, expect, it } from 'vitest'
import type { EngineProbeResult, EngineRound } from '../src/diagnostics/engineProbe'
import { loadStoredProbe, PROBE_PRESETS, saveStoredProbe, slowdownRatio } from '../src/diagnostics/engineProbe'
import { formatEngineProbe, judgeEngineProbe, LEAK_SLOWDOWN_THRESHOLD } from '../src/diagnostics/engineVerdict'

/** Tandas con las duraciones dadas, todas pidiendo las mismas 20 visitas. */
function rounds(msPerRound: number[]): EngineRound[] {
  return msPerRound.map((ms, i) => ({
    round: i + 1,
    visits: 20,
    ms,
    visitsPerSecond: Math.round((20 / ms) * 1000 * 10) / 10,
  }))
}

function result(over: Partial<EngineProbeResult> = {}): EngineProbeResult {
  return { modelInOpfs: true, initMs: 3000, rounds: [], ...over }
}

describe('slowdownRatio', () => {
  it('compara la última mitad contra la primera', () => {
    expect(slowdownRatio(rounds([100, 100, 200, 200]))).toBe(2)
    expect(slowdownRatio(rounds([100, 100, 100, 100]))).toBe(1)
  })

  it('con menos de 4 tandas no afirma nada: no hay señal, sólo ruido', () => {
    expect(slowdownRatio(rounds([100, 500, 100]))).toBeNull()
    expect(slowdownRatio([])).toBeNull()
  })
})

describe('judgeEngineProbe', () => {
  it('sin modelo descargado no inventa un veredicto', () => {
    const verdict = judgeEngineProbe(result({ modelInOpfs: false, error: 'el modelo b18 todavía no está' }))
    expect(verdict.kind).toBeNull()
    expect(verdict.detail).toContain('todavía no está')
  })

  it('un fallo dice CUÁNTAS tandas aguantó: en un crash por memoria, ese número ES el dato', () => {
    const verdict = judgeEngineProbe(result({ rounds: rounds([500, 600, 700]), error: 'worker crash' }))
    expect(verdict.kind).toBe('failed')
    expect(verdict.detail).toContain('3 tandas')
    expect(verdict.detail).toContain('worker crash')
  })

  it('un fallo antes de la primera tanda lo dice explícitamente', () => {
    expect(judgeEngineProbe(result({ error: 'sin adapter' })).detail).toContain('antes de completar la primera')
  })

  it('tandas que se alargan → fuga, y lo dice aunque la velocidad promedio sea buena', () => {
    // 20 visitas en 200 ms son 100 v/s: velocidad de sobra. Pero se duplicó, y eso es lo que importa.
    const verdict = judgeEngineProbe(result({ rounds: rounds([100, 100, 200, 200]) }))
    expect(verdict.kind).toBe('leak')
    expect(verdict.detail).toContain('2.0×')
    expect(verdict.detail).toContain('bajar las visitas retrasaría el crash')
  })

  it('la fuga GANA sobre la lentitud: si algo crece, el presupuesto no es la respuesta', () => {
    // Lento (0,5 v/s) Y con desaceleración: tiene que reportar la fuga, no la lentitud.
    const verdict = judgeEngineProbe(result({ rounds: rounds([20_000, 20_000, 60_000, 60_000]) }))
    expect(verdict.kind).toBe('leak')
  })

  it('lento pero ESTABLE → presupuesto o red más chica, no cazar un bug', () => {
    // 20 visitas en 40 s = 0,5 v/s, sin variación.
    const verdict = judgeEngineProbe(result({ rounds: rounds([40_000, 40_000, 40_000, 40_000]) }))
    expect(verdict.kind).toBe('slow')
    expect(verdict.detail).toContain('no cazar un bug')
  })

  it('rápido y estable → el problema está en otra parte, y lo dice', () => {
    const verdict = judgeEngineProbe(result({ rounds: rounds([2000, 2100, 2000, 2050]) }))
    expect(verdict.kind).toBe('ok')
    expect(verdict.detail).toContain('no está en el ritmo de inferencia')
  })

  it('el umbral de fuga es una tendencia, no ruido de medición', () => {
    expect(LEAK_SLOWDOWN_THRESHOLD).toBeGreaterThan(1.2)
    // Justo por debajo del umbral sigue siendo "ok" mientras la velocidad alcance.
    const justUnder = judgeEngineProbe(result({ rounds: rounds([100, 100, 140, 140]) }))
    expect(justUnder.kind).toBe('ok')
  })
})

describe('formatEngineProbe', () => {
  it('cada tanda entra en el volcado con su duración y su velocidad', () => {
    const lines = formatEngineProbe(result({ rounds: rounds([1000, 1000, 2000, 2000]) }))
    expect(lines[0]).toBe('arranque del motor: 3000 ms')
    expect(lines[1]).toContain('tanda 1: 20 visitas en 1000 ms')
    expect(lines.some((l) => l.includes('desaceleración'))).toBe(true)
  })

  it('un error también viaja en el volcado', () => {
    expect(formatEngineProbe(result({ error: 'boom' })).some((l) => l === 'error: boom')).toBe(true)
  })
})

// ── Persistencia: el crash tiene que dejar rastro ────────────────────────────────────────────
//
// El fallo que se investiga mata el proceso, y con él el DOM. Sin persistir cada tanda, "aguantó 3 de 6"
// —el dato más valioso de la prueba— se perdería exactamente en el escenario que se quiere capturar.

describe('loadStoredProbe / saveStoredProbe', () => {
  function memStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; map: Map<string, string> } {
    const map = new Map<string, string>()
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) }
  }

  it('round-trip de una corrida interrumpida, con `finished: false` intacto', () => {
    const storage = memStorage()
    saveStoredProbe(storage, { at: '2026-07-28T00:00:00.000Z', initMs: 3000, rounds: rounds([100, 200]), finished: false })
    const loaded = loadStoredProbe(storage)
    expect(loaded?.finished).toBe(false)
    expect(loaded?.rounds).toHaveLength(2)
    expect(loaded?.initMs).toBe(3000)
  })

  it('storage vacío → null, sin lanzar', () => {
    expect(loadStoredProbe(memStorage())).toBeNull()
  })

  it('dato corrupto o de otra forma → null, nunca a medio parsear', () => {
    const storage = memStorage()
    storage.setItem('tengen:engine-probe:v1', '{no es json')
    expect(loadStoredProbe(storage)).toBeNull()
    storage.setItem('tengen:engine-probe:v1', '{"at":"x","rounds":[{"round":1}]}') // tanda incompleta
    expect(loadStoredProbe(storage)).toBeNull()
    storage.setItem('tengen:engine-probe:v1', '{"rounds":[]}') // sin `at`
    expect(loadStoredProbe(storage)).toBeNull()
  })

  it('un storage que lanza al escribir no interrumpe nada: la medición vale más que su registro', () => {
    const hostile = {
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => saveStoredProbe(hostile, { at: 'x', rounds: [], finished: false })).not.toThrow()
  })
})

// ── El acumulado por tanda: la variable que separa acumulación de techo ──────────────────────
describe('formatEngineProbe — acumulado', () => {
  it('cada tanda lleva el total de inferencias hasta ese punto', () => {
    const lines = formatEngineProbe(result({ rounds: rounds([100, 100, 100]) }))
    expect(lines[1]).toContain('acumulado 20')
    expect(lines[2]).toContain('acumulado 40')
    expect(lines[3]).toContain('acumulado 60')
  })
})

describe('PROBE_PRESETS', () => {
  it('los dos repartos llegan a un total de inferencias comparable', () => {
    // Comparables a propósito: si un reparto midiera mucho menos trabajo que el otro, "sobrevivió" no
    // significaría nada — habría que preguntarse si aguantó o si simplemente hizo menos.
    const totals = PROBE_PRESETS.map((p) => p.rounds * p.visitsPerRound)
    const [min, max] = [Math.min(...totals), Math.max(...totals)]
    expect(max / min).toBeLessThanOrEqual(2)
  })

  it('el reparto fino usa tandas MUCHO más chicas: es lo que hace el experimento', () => {
    const fina = PROBE_PRESETS.find((p) => p.id === 'fina')!
    const normal = PROBE_PRESETS.find((p) => p.id === 'normal')!
    expect(normal.visitsPerRound / fina.visitsPerRound).toBeGreaterThanOrEqual(4)
  })
})
