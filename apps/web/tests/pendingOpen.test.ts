import { beforeEach, describe, expect, it } from 'vitest'
import { resetPendingOpen, setPendingOpen, takePendingOpen } from '../src/cloud/pendingOpen'

beforeEach(() => resetPendingOpen()) // el singleton vive en module scope: aislar entre tests

describe('pendingOpen — take-once', () => {
  it('consume el valor cuando el modo coincide', () => {
    setPendingOpen({ id: 'g1', mode: 'jugar', sgf: '(;GM[1])', opponent: { kind: 'human', rank: '5k' } })
    expect(takePendingOpen('jugar')).toEqual({
      id: 'g1',
      mode: 'jugar',
      sgf: '(;GM[1])',
      opponent: { kind: 'human', rank: '5k' },
    })
  })

  it('una segunda llamada con el mismo modo devuelve null (ya se consumió)', () => {
    setPendingOpen({ id: 'g1', mode: 'jugar', sgf: '(;GM[1])' })
    takePendingOpen('jugar')
    expect(takePendingOpen('jugar')).toBeNull()
  })

  it('modo equivocado NO consume ni devuelve — el modo correcto puede tomarlo después', () => {
    setPendingOpen({ id: 'g2', mode: 'analizar', sgf: '(;GM[1])' })
    expect(takePendingOpen('jugar')).toBeNull()
    expect(takePendingOpen('analizar')).toEqual({ id: 'g2', mode: 'analizar', sgf: '(;GM[1])' })
  })

  it('sin nada pendiente → null en ambos modos', () => {
    expect(takePendingOpen('jugar')).toBeNull()
    expect(takePendingOpen('analizar')).toBeNull()
  })
})
