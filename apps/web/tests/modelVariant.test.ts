import { describe, expect, it } from 'vitest'
import { currentModelVariant, modelVariantFor } from '../src/models/modelVariant'
import { summarizeUserAgent } from '../src/diagnostics/userAgent'

// UA REALES, no inventados: los mismos que ya usa `userAgent.test.ts`, más los dos volcados del
// iPhone 12 Pro Max donde el motor muere alrededor de la inferencia 80 en AMBOS navegadores. Ese
// aparato es la razón de que exista todo esto, así que su UA exacto tiene que estar cubierto.
const SAFARI_IOS_26_FROZEN =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1'
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/150.0 Mobile/15E148 Safari/604.1'
const SAFARI_IOS_26 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const IPAD_OS =
  'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36'
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

describe('modelVariantFor — móvil recibe el mixto', () => {
  // El punto de este bloque: los DOS navegadores del mismo iPhone tienen que dar el mismo resultado.
  // Murieron en las mismas ~80 inferencias, lo que descarta al navegador como variable — si el
  // criterio los separara, estaría modelando algo que la evidencia dice que no existe.
  it('Safari 26 del iPhone 12 Pro Max (versión de iOS congelada) → mixto', () => {
    expect(modelVariantFor(SAFARI_IOS_26_FROZEN)).toBe('mixed16')
  })

  it('Chrome iOS del MISMO iPhone → mixto (mismo aparato, misma respuesta)', () => {
    expect(modelVariantFor(CHROME_IOS)).toBe('mixed16')
  })

  it('los dos navegadores del mismo aparato coinciden', () => {
    expect(modelVariantFor(SAFARI_IOS_26_FROZEN)).toBe(modelVariantFor(CHROME_IOS))
  })

  it('Safari iOS 26 sin congelar → mixto', () => {
    expect(modelVariantFor(SAFARI_IOS_26)).toBe('mixed16')
  })

  it('iPad que se declara iPad → mixto', () => {
    expect(modelVariantFor(IPAD_OS)).toBe('mixed16')
  })

  it('Chrome en Android → mixto', () => {
    expect(modelVariantFor(CHROME_ANDROID)).toBe('mixed16')
  })
})

describe('modelVariantFor — escritorio conserva el fp32 probado en producción', () => {
  it('Chrome en macOS → fp32', () => {
    expect(modelVariantFor(CHROME_MAC)).toBe('fp32')
  })

  it('Safari en macOS → fp32', () => {
    expect(modelVariantFor(SAFARI_MAC)).toBe('fp32')
  })

  it('Chrome en Windows → fp32', () => {
    expect(modelVariantFor(CHROME_WINDOWS)).toBe('fp32')
  })

  it('un UA irreconocible cae en fp32 (el binario probado), no en el nuevo', () => {
    expect(modelVariantFor('algo raro')).toBe('fp32')
    expect(modelVariantFor('')).toBe('fp32')
  })
})

describe('modelVariantFor — la propiedad de la que depende que el motor arranque', () => {
  // El hilo principal descarga y el worker lee de OPFS. Si resuelven distinto, el worker busca un
  // archivo que nadie bajó. La función depende SÓLO del string de UA —el mismo en los dos scopes—,
  // así que dos llamadas con el mismo string no pueden discrepar. Esto es lo que ese contrato dice.
  const TODOS = [
    SAFARI_IOS_26_FROZEN,
    CHROME_IOS,
    SAFARI_IOS_26,
    IPAD_OS,
    CHROME_ANDROID,
    CHROME_MAC,
    SAFARI_MAC,
    CHROME_WINDOWS,
    'algo raro',
  ]

  it('es determinista: mismo UA, misma variante, siempre', () => {
    for (const ua of TODOS) expect(modelVariantFor(ua)).toBe(modelVariantFor(ua))
  })

  it('es total: todo UA devuelve una variante válida (nunca lanza ni devuelve undefined)', () => {
    for (const ua of TODOS) expect(['fp32', 'mixed16']).toContain(modelVariantFor(ua))
  })

  // `maxTouchPoints` NO existe en `WorkerNavigator`. Si el criterio lo usara, el worker resolvería
  // distinto que el hilo principal en un iPad y `tsc` no lo notaría (apps/web tipa `navigator` con la
  // lib DOM). Este test fija que la firma no lo admite ni de casualidad.
  it('ignora maxTouchPoints por completo: sólo consume la cadena de UA', () => {
    expect(modelVariantFor.length).toBe(1)
    // Un Mac con pantalla táctil (o sea, un iPad disfrazado) resuelve igual que un Mac de verdad,
    // porque el UA es el mismo string. Es el límite CONOCIDO y aceptado del criterio: cae en fp32,
    // que es el comportamiento que esos aparatos ya tienen hoy.
    expect(summarizeUserAgent({ userAgent: SAFARI_MAC, maxTouchPoints: 5 }).iPadOsSuspected).toBe(true)
    expect(modelVariantFor(SAFARI_MAC)).toBe('fp32')
  })
})

describe('currentModelVariant', () => {
  it('fuera de un navegador devuelve la variante por defecto en vez de lanzar', () => {
    // El entorno `node` de vitest no define `navigator`; ningún camino de Node descarga ni lee
    // modelos, así que la respuesta correcta es la por defecto y no una excepción.
    expect(typeof navigator === 'undefined' ? currentModelVariant() : 'fp32').toBe('fp32')
  })

  it('coincide con modelVariantFor(navigator.userAgent) cuando hay navegador', () => {
    if (typeof navigator === 'undefined') return
    expect(currentModelVariant()).toBe(modelVariantFor(navigator.userAgent))
  })
})
