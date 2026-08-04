// Fase Aprender T5: refutación del motor ante una jugada fuera del árbol de solución. El contrato
// honesto: el veredicto SIEMPRE es en puntos (scoreLead) y NUNCA 'success' — sin ownership no se
// puede afirmar vida/muerte, solo cuánto costó la jugada. Scheduler mockeado por parámetro (patrón
// guessAgainstEngine: la contención real la testea reviewScheduler.test.ts).
import { describe, expect, it, vi } from 'vitest'
import type { Analysis, MoveAnalysis, Position, Vertex } from '@tengen/engine'
import {
  LEARN_ANALYSIS_GROUP,
  REFUTE_DANGER_POINTS,
  REFUTE_VISITS,
  refuteOutOfTree,
} from '../src/learn/engineRefutation'

const SETUP = { black: [{ x: 2, y: 0 }], white: [{ x: 0, y: 0 }] }
const posBefore: Position = {
  boardSize: 19,
  komi: 7.5,
  rules: 'chinese',
  handicap: 0,
  moves: [],
  setup: SETUP,
  initialTurn: 'black',
}
const posAfter: Position = { ...posBefore, moves: [{ color: 'black', vertex: { x: 9, y: 9 } }] }

function mk(vertex: Vertex, visits: number): MoveAnalysis {
  return { vertex, visits, winrate: 0.5, scoreLead: 0, prior: 0.1, pv: [] }
}

function analysis(scoreLead: number, moves: MoveAnalysis[] = []): Analysis {
  return { winrate: 0.5, scoreLead, scoreStdev: 1, visits: 64, moves }
}

/** Scheduler falso: responde según la posición pedida (before/after) y registra los args. */
function mockScheduler(before: Analysis, after: Analysis) {
  const analyzePosition = vi.fn(async (args: { pos: Position }) =>
    args.pos.moves.length === 0 ? before : after,
  )
  return { analyzePosition }
}

describe('refuteOutOfTree', () => {
  it('Negro juega y el scoreLead cae 3 → pointsLost 3, warning con los puntos en el texto', async () => {
    const scheduler = mockScheduler(analysis(5), analysis(2, [mk({ x: 3, y: 3 }, 40), mk({ x: 1, y: 1 }, 10)]))
    const r = await refuteOutOfTree({ scheduler, posBefore, posAfter, playedColor: 'black' })
    expect(r.pointsLost).toBeCloseTo(3)
    expect(r.baselineScoreLead).toBe(5)
    expect(r.verdict.tone).toBe('warning')
    expect(r.verdict.label).toContain('3')
    expect(r.bestReply).toEqual({ x: 3, y: 3 }) // la candidata MÁS visitada tras la jugada
  })

  it('pide ambos análisis con group learn, priority interactive y REFUTE_VISITS', async () => {
    const scheduler = mockScheduler(analysis(0), analysis(0))
    await refuteOutOfTree({ scheduler, posBefore, posAfter, playedColor: 'black' })
    expect(scheduler.analyzePosition).toHaveBeenCalledTimes(2)
    for (const call of scheduler.analyzePosition.mock.calls) {
      expect(call[0]).toMatchObject({ group: LEARN_ANALYSIS_GROUP, priority: 'interactive', visits: REFUTE_VISITS })
    }
  })

  it('con cachedBaseline NO re-analiza la posición previa (una sola llamada)', async () => {
    const scheduler = mockScheduler(analysis(999), analysis(2))
    const r = await refuteOutOfTree({ scheduler, posBefore, posAfter, playedColor: 'black', cachedBaseline: 5 })
    expect(scheduler.analyzePosition).toHaveBeenCalledTimes(1)
    expect(r.pointsLost).toBeCloseTo(3)
    expect(r.baselineScoreLead).toBe(5)
  })

  it('Blanco juega: el signo se invierte (scoreLead es perspectiva de Negro)', async () => {
    const scheduler = mockScheduler(analysis(-2), analysis(1))
    const r = await refuteOutOfTree({ scheduler, posBefore, posAfter, playedColor: 'white' })
    expect(r.pointsLost).toBeCloseTo(3) // -1 × (-2 − 1)
  })

  it('pérdida ≥ REFUTE_DANGER_POINTS → danger', async () => {
    const scheduler = mockScheduler(analysis(10), analysis(10 - REFUTE_DANGER_POINTS))
    const r = await refuteOutOfTree({ scheduler, posBefore, posAfter, playedColor: 'black' })
    expect(r.verdict.tone).toBe('danger')
  })

  it('pérdida ~0 (o negativa): NUNCA success — texto honesto de "no es la línea de la solución"', async () => {
    const scheduler = mockScheduler(analysis(2), analysis(2.3))
    const r = await refuteOutOfTree({ scheduler, posBefore, posAfter, playedColor: 'black' })
    expect(r.verdict.tone).toBe('warning')
    expect(r.verdict.label).toMatch(/no es la línea de la solución/i)
  })

  it('análisis sin candidatas → bestReply null (no se inventa una respuesta)', async () => {
    const scheduler = mockScheduler(analysis(5), analysis(2, []))
    const r = await refuteOutOfTree({ scheduler, posBefore, posAfter, playedColor: 'black' })
    expect(r.bestReply).toBeNull()
  })

  it('la mejor respuesta puede ser un pase (se entrega tal cual, la vista decide cómo mostrarlo)', async () => {
    const scheduler = mockScheduler(analysis(5), analysis(2, [mk('pass', 50), mk({ x: 1, y: 1 }, 10)]))
    const r = await refuteOutOfTree({ scheduler, posBefore, posAfter, playedColor: 'black' })
    expect(r.bestReply).toBe('pass')
  })
})
