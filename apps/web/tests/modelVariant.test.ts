import { describe, expect, it } from 'vitest'
import { currentModelVariant, modelVariantFor } from '../src/models/modelVariant'
import { summarizeUserAgent } from '../src/diagnostics/userAgent'

// UA REALES, no inventados. Viven en `fixtures/userAgents.ts` porque `opponentStrength.test.ts`
// aserta sobre la MISMA batería para verificar que el criterio de fuerza y el de precisión no
// divergen; dos copias de la lista harían que ese cruce comparara UA distintos sin avisar.
import {
  CHROME_ANDROID,
  CHROME_IOS,
  CHROME_MAC,
  CHROME_WINDOWS,
  IPAD_OS,
  REAL_USER_AGENTS,
  SAFARI_IOS_26,
  SAFARI_IOS_26_FROZEN,
  SAFARI_MAC,
} from './fixtures/userAgents'

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
  const TODOS = [...REAL_USER_AGENTS, 'algo raro']

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
