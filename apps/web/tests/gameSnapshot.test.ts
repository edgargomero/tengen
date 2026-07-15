// Regresión (fix f9c8130): una partida reabierta NO debe reescribir su nombre en cada guardado.
// `buildGameSnapshot` es la única pieza de esa lógica que vive fuera de PlayView/AnalyzeView (el
// repo no testea UI) — sin este test, revertir el fix pasaría inadvertido (gameSync.test.ts
// siempre pasa un `name` explícito y no puede detectarlo).
import { describe, expect, it } from 'vitest'
import { buildGameSnapshot } from '../src/cloud/snapshot'

const BASE = { sgf: '(;GM[1])', boardSize: 9 as const, mode: 'jugar' as const }

describe('buildGameSnapshot', () => {
  it('partida NUEVA (reopened=false): incluye el name generado', () => {
    const snapshot = buildGameSnapshot(BASE, 'partida nueva', false)
    expect(snapshot).toEqual({ ...BASE, name: 'partida nueva' })
  })

  it('partida REABIERTA (reopened=true): omite name — no pisa el que ya vive en D1', () => {
    const snapshot = buildGameSnapshot(BASE, 'nombre recién generado, no debe usarse', true)
    expect(snapshot).toEqual(BASE)
    expect(snapshot).not.toHaveProperty('name')
  })

  it('el resto de los campos del base viaja intacto en ambos casos', () => {
    const withResult = { ...BASE, result: 'W+R' }
    expect(buildGameSnapshot(withResult, 'x', false)).toEqual({ ...withResult, name: 'x' })
    expect(buildGameSnapshot(withResult, 'x', true)).toEqual(withResult)
  })
})
