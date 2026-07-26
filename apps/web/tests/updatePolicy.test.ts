import { describe, expect, it } from 'vitest'
import {
  classifyRegistration,
  MIN_AUTO_CHECK_INTERVAL_MS,
  PERIODIC_CHECK_MS,
  shouldAutoCheck,
} from '../src/pwa/updatePolicy'

describe('shouldAutoCheck', () => {
  const base = { visible: true, online: true, lastCheckMs: null, nowMs: 1_000_000 }

  it('chequea la primera vez con la app visible y con red', () => {
    expect(shouldAutoCheck(base)).toBe(true)
  })

  it('no gasta red con la app en segundo plano', () => {
    expect(shouldAutoCheck({ ...base, visible: false })).toBe(false)
  })

  it('no chequea sin conexión (fallaría igual, y `onLine: false` no miente)', () => {
    expect(shouldAutoCheck({ ...base, online: false })).toBe(false)
  })

  it('respeta el piso entre chequeos automáticos: justo antes no, justo en el borde sí', () => {
    const now = 1_000_000
    const justBefore = now - MIN_AUTO_CHECK_INTERVAL_MS + 1
    expect(shouldAutoCheck({ ...base, nowMs: now, lastCheckMs: justBefore })).toBe(false)
    expect(shouldAutoCheck({ ...base, nowMs: now, lastCheckMs: now - MIN_AUTO_CHECK_INTERVAL_MS })).toBe(true)
  })

  it('el throttle no depende de la visibilidad: alternar pestañas rápido no dispara un chequeo por toque', () => {
    const now = 1_000_000
    // Simula tres `visibilitychange` seguidos con el último chequeo hace un segundo.
    const input = { ...base, nowMs: now, lastCheckMs: now - 1_000 }
    expect([shouldAutoCheck(input), shouldAutoCheck(input), shouldAutoCheck(input)]).toEqual([false, false, false])
  })

  it('el intervalo periódico es mayor que el piso del throttle (si no, el tick periódico nunca chequearía)', () => {
    expect(PERIODIC_CHECK_MS).toBeGreaterThan(MIN_AUTO_CHECK_INTERVAL_MS)
  })
})

describe('classifyRegistration', () => {
  it('sin nada del otro lado: al día', () => {
    expect(classifyRegistration({ installing: null, waiting: null })).toBe('uptodate')
  })

  it('bajando: NO dice "al día" (el precache del WASM de ORT sigue en curso)', () => {
    expect(classifyRegistration({ installing: {}, waiting: null })).toBe('installing')
  })

  it('esperando: listo para aplicar', () => {
    expect(classifyRegistration({ installing: null, waiting: {} })).toBe('ready')
  })

  it('con los dos presentes gana `waiting`: lo accionable es la versión que ya está lista', () => {
    expect(classifyRegistration({ installing: {}, waiting: {} })).toBe('ready')
  })
})
