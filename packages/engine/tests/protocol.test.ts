import { describe, expect, it } from 'vitest'
import { decodeResponse, encodeRequest, transferablesOf } from '../src/worker/protocol'
import type { WorkerRequest, WorkerResponse } from '../src/worker/protocol'
import type { Analysis, Position } from '../src/types'

// Tests del protocolo tipado del Worker. Serialización pura: NO instancia ningún Worker real ni
// LocalEngine (el round-trip end-to-end vive en worker.test.ts). Estos son los tests-gate del plan,
// escritos con aserciones REALES (el ejemplo del plan usaba `.toBeDefined` sin paréntesis → no
// aseveraba nada; aquí se corrige) y con validación honesta (encode/decode estrechan la unión).

const EMPTY: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }

describe('protocolo Worker — encodeRequest', () => {
  it('devuelve la request intacta para cada variante válida', () => {
    const reqs: WorkerRequest[] = [
      { type: 'init', id: 1, network: 'b18', boardSize: 19 },
      { type: 'genMove', id: 2, pos: EMPTY, level: { kind: 'kata', visits: 100 } },
      { type: 'analyze', id: 3, pos: EMPTY, visits: 50 },
      { type: 'stop', id: 4 },
    ]
    for (const r of reqs) expect(encodeRequest(r)).toEqual(r)
  })

  it('lanza ante un `type` desconocido (no es un no-op)', () => {
    expect(() => encodeRequest({ type: 'bogus', id: 1 } as unknown as WorkerRequest)).toThrow()
  })

  it('lanza si falta el id numérico', () => {
    expect(() => encodeRequest({ type: 'stop' } as unknown as WorkerRequest)).toThrow()
  })
})

describe('protocolo Worker — decodeResponse', () => {
  it('estrecha una response válida de cada variante', () => {
    const ready: WorkerResponse = { type: 'ready', id: 1 }
    expect(decodeResponse(ready)).toEqual(ready)

    const move: WorkerResponse = { type: 'move', id: 2, move: { color: 'black', vertex: { x: 4, y: 4 } } }
    expect(decodeResponse(move)).toEqual(move)

    const err: WorkerResponse = { type: 'error', id: 3, message: 'boom' }
    expect(decodeResponse(err)).toEqual(err)
  })

  it('lanza ante datos inválidos (no-objeto, sin id, o type no-response)', () => {
    expect(() => decodeResponse(null)).toThrow()
    expect(() => decodeResponse(42)).toThrow()
    expect(() => decodeResponse({ type: 'ready' })).toThrow() // sin id
    expect(() => decodeResponse({ type: 'init', id: 1 })).toThrow() // 'init' es request, no response
    expect(() => decodeResponse({ type: 'bogus', id: 1 })).toThrow()
  })
})

describe('protocolo Worker — transferablesOf', () => {
  it('extrae el buffer de `ownership` del ownership de una analysis', () => {
    const analysis: Analysis = {
      winrate: 0.5,
      scoreLead: 0,
      scoreStdev: 1,
      visits: 10,
      moves: [],
      ownership: new Float32Array(361),
    }
    const t = transferablesOf({ type: 'analysis', id: 2, analysis, final: false })
    expect(t).toContain(analysis.ownership!.buffer)
  })

  it('devuelve [] cuando el mensaje no tiene arrays transferibles', () => {
    expect(transferablesOf({ type: 'ready', id: 1 })).toEqual([])
    const analysis: Analysis = { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits: 10, moves: [] }
    expect(transferablesOf({ type: 'analysis', id: 3, analysis, final: true })).toEqual([])
  })
})
