// El consejo del gate. Lo que estos tests protegen es que nunca vuelva a mandar a un iPhone a Chrome:
// ese consejo estuvo en producción y era el contrario del correcto, porque en iOS los navegadores de
// terceros corren sobre WKWebView, que no expone WebGPU hasta iOS 26 — mientras Safari sí puede.
// Confirmado con el volcado de un iPhone 12 real (iOS 18.7.8, Chrome iOS: `navigator.gpu: no`).
import { describe, expect, it } from 'vitest'
import { summarizeUserAgent } from '../src/diagnostics/userAgent'
import { IOS_WEBGPU_ALL_BROWSERS, webGpuAdvice } from '../src/diagnostics/webGpuAdvice'

/** El UA exacto del iPhone 12 de Edgar, del volcado de `/diagnostico` en producción. */
const CHROME_IOS_18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/150.0.7871.113 Mobile/15E148 Safari/604.1'
const SAFARI_IOS_18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
/** UA REAL del iPhone 12 de Edgar: Safari 26.5.2 sobre iOS 18.7, con WebGPU funcionando. Es la prueba de
 * que las dos versiones son independientes, y el caso que corrigió este archivo. */
const SAFARI_26_ON_IOS_18 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1'
const SAFARI_IOS_26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

function advice(userAgent: string, maxTouchPoints = 0): string[] {
  return webGpuAdvice(summarizeUserAgent({ userAgent, maxTouchPoints }))
}

describe('webGpuAdvice', () => {
  it('NUNCA manda a Chrome en un iPhone: es el único navegador de ese aparato que no puede', () => {
    const lines = advice(CHROME_IOS_18).join(' ')
    expect(lines).toContain('Safari')
    expect(lines).not.toMatch(/abre esta página en \*?\*?Chrome/i)
    // Y explica que no es culpa del hardware: el Safari del MISMO teléfono sí puede — verificado en el
    // iPhone 12 de Edgar, que corre Safari 26.5.2 con WebGPU sobre ese mismo iOS 18.
    expect(lines).toContain('WKWebView')
    expect(lines).toContain('18.7.8')
    expect(lines).toContain('no es una limitación del hardware')
    expect(lines).toContain('El Safari del mismo teléfono sí puede')
  })

  it('en Safari VIEJO manda a actualizar SAFARI, no el sistema: son versiones independientes', () => {
    const lines = advice(SAFARI_IOS_18).join(' ')
    expect(lines).toContain('Estás en Safari')
    expect(lines).toContain('Safari 26')
    expect(lines).toContain('Funciones experimentales')
  })

  it('EL caso que enseñó el dispositivo real: Safari 26 sobre iOS 18 no manda a actualizar nada', () => {
    // iPhone 12 de Edgar: Safari 26.5.2 sobre iOS 18.7, con WebGPU funcionando. Decirle "actualiza a
    // iOS 26" sería mandarlo a hacer algo que no cambia nada — su Safari YA sirve.
    const lines = advice(SAFARI_26_ON_IOS_18).join(' ')
    expect(lines).toContain('ya trae WebGPU')
    expect(lines).toContain('el problema es otro')
    expect(lines).not.toContain('Actualiza Safari')
    expect(lines).not.toContain('Funciones experimentales')
  })

  it('en iOS 26+ no culpa al navegador: ahí cualquiera sirve, así que el fallo es información nueva', () => {
    const lines = advice(SAFARI_IOS_26).join(' ')
    expect(lines).toContain('todos sus navegadores')
    expect(lines).toContain('diagnóstico')
    expect(lines).not.toContain('Funciones experimentales')
  })

  it('fuera de Apple mantiene el consejo de siempre', () => {
    expect(advice(CHROME_MAC)).toEqual(['Abre esta página en Chrome o Edge recientes, con WebGPU habilitado.'])
  })

  it('un iPadOS que se hace pasar por Mac recibe el consejo de Apple, no el genérico', () => {
    // Lo delata el táctil (ver `summarizeUserAgent`); sin eso caería en la rama de escritorio.
    const lines = advice(SAFARI_MAC, 5).join(' ')
    expect(lines).toContain('Safari')
    expect(advice(SAFARI_MAC, 0).join(' ')).toContain('Chrome o Edge')
  })

  it('un iPhone sin versión legible en el UA sigue recibiendo el consejo de Safari', () => {
    const lines = advice('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/150.0').join(' ')
    expect(lines).toContain('Safari')
    expect(lines).toContain('esta versión') // sin número, el texto no inventa uno
  })

  it('el umbral es iOS 26, la versión donde WKWebView pasó a exponer WebGPU', () => {
    expect(IOS_WEBGPU_ALL_BROWSERS).toBe(26)
  })
})
