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
    expect(summarizeUserAgent({ userAgent: 'algo raro' })).toEqual({ isIos: false, iPadOsSuspected: false })
  })
})
