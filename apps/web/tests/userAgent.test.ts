// Lo delicado del parseo de UA es el ORDEN de las ramas: el UA de Chrome contiene "Safari" y el de Edge
// contiene "Chrome" y "Safari". Estos casos son UAs reales, no inventados — es la única forma de que el
// test signifique algo.
import { describe, expect, it } from 'vitest'
import { summarizeUserAgent } from '../src/diagnostics/userAgent'

const SAFARI_IOS_26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0.7151.107 Mobile/15E148 Safari/604.1'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
const EDGE_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const IPAD_OS =
  'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

describe('summarizeUserAgent', () => {
  it('Safari en iOS 26: versión de iOS, de WebKit y de navegador, las tres', () => {
    expect(summarizeUserAgent({ userAgent: SAFARI_IOS_26 })).toEqual({
      isIos: true,
      iPadOsSuspected: false,
      iosVersionFrozen: false,
      iosVersion: '26.0',
      webkitVersion: '605.1.15',
      browser: 'Safari 26.0',
      browserVersion: '26.0',
    })
  })

  it('Chrome en iOS se declara CriOS: es el mismo WebKit, y eso es justo el dato que importa', () => {
    const summary = summarizeUserAgent({ userAgent: CHROME_IOS })
    expect(summary.browser).toBe('Chrome iOS 137.0.7151.107')
    expect(summary.iosVersion).toBe('18.5')
    expect(summary.webkitVersion).toBe('605.1.15')
  })

  it('Chrome de escritorio no se confunde con Safari (su UA contiene "Safari")', () => {
    expect(summarizeUserAgent({ userAgent: CHROME_MAC }).browser).toBe('Chrome 137.0.0.0')
  })

  it('Edge no se confunde con Chrome (su UA contiene "Chrome")', () => {
    expect(summarizeUserAgent({ userAgent: EDGE_MAC }).browser).toBe('Edge 137.0.0.0')
  })

  it('Safari de escritorio: sin versión de iOS y sin sospecha de iPad', () => {
    const summary = summarizeUserAgent({ userAgent: SAFARI_MAC, maxTouchPoints: 0 })
    expect(summary).toEqual({
      isIos: false,
      iPadOsSuspected: false,
      iosVersionFrozen: false,
      webkitVersion: '605.1.15',
      browser: 'Safari 26.0',
      browserVersion: '26.0',
    })
  })

  it('iPad que se declara iPad: la versión sale del "CPU OS" (sin el "iPhone" del medio)', () => {
    const summary = summarizeUserAgent({ userAgent: IPAD_OS })
    expect(summary.isIos).toBe(true)
    expect(summary.iosVersion).toBe('26.0')
  })

  it('iPadOS que se hace pasar por Mac: lo delata el táctil, no el UA', () => {
    expect(summarizeUserAgent({ userAgent: SAFARI_MAC, maxTouchPoints: 5 }).iPadOsSuspected).toBe(true)
    expect(summarizeUserAgent({ userAgent: SAFARI_MAC, maxTouchPoints: 1 }).iPadOsSuspected).toBe(false)
  })

  it('un UA irreconocible no lanza ni inventa: devuelve lo que no pudo leer como ausente', () => {
    expect(summarizeUserAgent({ userAgent: 'algo raro' })).toEqual({
      isIos: false,
      iPadOsSuspected: false,
      iosVersionFrozen: false,
    })
  })
})

// ── El UA congelado de iOS 26+ ────────────────────────────────────────────────────────────────
//
// Desde iOS 26, Safari deja de publicar la versión del sistema y la fija en "18_7" para siempre
// (anti-fingerprinting). La lectura es contraintuitiva y por eso va fijada con tests: ver ese valor
// exacto junto a un Safari 26+ es evidencia de que el sistema es NUEVO, no viejo. Leerlo al pie de la
// letra hacía que el diagnóstico reportara iOS 18 en un iPhone actualizado, y que el consejo mandara a
// actualizar un sistema que ya estaba al día.
describe('summarizeUserAgent — versión de iOS congelada', () => {
  const FROZEN =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1'

  it('"18.7" exacto + Safari 26 = congelado (el UA REAL del iPhone 12 de Edgar)', () => {
    const summary = summarizeUserAgent({ userAgent: FROZEN })
    expect(summary.iosVersionFrozen).toBe(true)
    expect(summary.iosVersion).toBe('18.7') // el crudo se conserva; quien lo muestre decide cómo decirlo
    expect(summary.browserVersion).toBe('26.5.2')
  })

  it('un iOS 18.7 DE VERDAD (con su Safari 18.x) no se confunde con uno congelado', () => {
    const real =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
    expect(summarizeUserAgent({ userAgent: real }).iosVersionFrozen).toBe(false)
  })

  it('18.7.8 (tres componentes) no es el valor congelado: el fijo es "18.7" exacto', () => {
    const chrome =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/150.0 Mobile/15E148 Safari/604.1'
    expect(summarizeUserAgent({ userAgent: chrome }).iosVersionFrozen).toBe(false)
  })

  it('iOS 26 que SÍ publica su versión tampoco se marca como congelado', () => {
    expect(summarizeUserAgent({ userAgent: SAFARI_IOS_26 }).iosVersionFrozen).toBe(false)
  })
})
