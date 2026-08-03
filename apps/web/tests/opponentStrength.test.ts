import { describe, expect, it } from 'vitest'
import {
  KATA_STRENGTH_PRESETS,
  MOBILE_VISITS,
  kataStrengthLabel,
  kataStrengthOptions,
  kataStrengthOptionsFor,
} from '../src/game/opponentStrength'
import { modelVariantFor } from '../src/models/modelVariant'
import { CHROME_ANDROID, CHROME_IOS, CHROME_MAC, IPAD_OS, REAL_USER_AGENTS } from './fixtures/userAgents'

describe('kataStrengthLabel — presets exactos', () => {
  it('cada preset devuelve su propia etiqueta', () => {
    for (const { visits, label } of KATA_STRENGTH_PRESETS) {
      expect(kataStrengthLabel(visits)).toBe(label)
    }
  })

  it('50/200/500 → baja/media/alta', () => {
    expect(kataStrengthLabel(50)).toBe('Fuerza baja')
    expect(kataStrengthLabel(200)).toBe('Fuerza media')
    expect(kataStrengthLabel(500)).toBe('Fuerza alta')
  })
})

describe('kataStrengthLabel — valores arbitrarios (partidas guardadas / clamp)', () => {
  it('bucketiza por cercanía al preset más próximo', () => {
    expect(kataStrengthLabel(1)).toBe('Fuerza baja') // clamp mínimo de validateConfig
    expect(kataStrengthLabel(100)).toBe('Fuerza baja') // más cerca de 50 que de 200
    expect(kataStrengthLabel(300)).toBe('Fuerza media') // más cerca de 200 que de 500
    expect(kataStrengthLabel(1000)).toBe('Fuerza alta') // muy por encima → alta
  })

  it('en los puntos medios (empate de distancia) cae al preset más bajo, determinista', () => {
    expect(kataStrengthLabel(125)).toBe('Fuerza baja') // |125-50| == |125-200| → baja
    expect(kataStrengthLabel(350)).toBe('Fuerza media') // |350-200| == |350-500| → media
  })

  it('nunca devuelve cadena vacía para un visits válido', () => {
    for (const v of [1, 42, 125, 200, 350, 777, 5000]) {
      expect(kataStrengthLabel(v)).not.toBe('')
    }
  })
})

describe('kataStrengthLabel — la etiqueta NO depende del dispositivo', () => {
  // El invariante que protege los SGF exportados: `kataStrengthLabel` alimenta el nombre del archivo
  // y la ficha del oponente durante la partida. Si dependiera del aparato, la misma partida guardada
  // se llamaría distinto según dónde la abras.
  it('las 25 visitas del móvil se llaman "Fuerza baja", igual que las 50 del escritorio', () => {
    expect(kataStrengthLabel(MOBILE_VISITS)).toBe('Fuerza baja')
    expect(kataStrengthLabel(50)).toBe('Fuerza baja')
  })

  it('la etiqueta del preset que se OFRECE en móvil es la misma que la del valor guardado', () => {
    // Derivada, no escrita a mano: es lo que impide que el nombre del preset elegido y el que muestra
    // la partida en curso se separen.
    expect(kataStrengthOptionsFor(CHROME_IOS)[0].label).toBe(kataStrengthLabel(MOBILE_VISITS))
  })
})

describe('kataStrengthOptionsFor — qué se OFRECE sí depende del dispositivo', () => {
  it('en móvil hay UNA sola fuerza, de 25 visitas', () => {
    for (const ua of [CHROME_IOS, IPAD_OS, CHROME_ANDROID]) {
      const opciones = kataStrengthOptionsFor(ua)
      expect(opciones).toHaveLength(1)
      expect(opciones[0].visits).toBe(MOBILE_VISITS)
    }
  })

  it('en escritorio siguen estando las tres de siempre', () => {
    const opciones = kataStrengthOptionsFor(CHROME_MAC)
    expect(opciones).toHaveLength(3)
    expect(opciones.map((o) => o.visits)).toEqual([50, 200, 500])
  })

  it('la primera opción es siempre la más débil: es la que el formulario usa por defecto', () => {
    for (const ua of REAL_USER_AGENTS) {
      const opciones = kataStrengthOptionsFor(ua)
      const minimo = Math.min(...opciones.map((o) => o.visits))
      expect(opciones[0].visits).toBe(minimo)
    }
  })

  it('es total: todo UA devuelve al menos una opción (nunca lanza ni deja el formulario vacío)', () => {
    for (const ua of [...REAL_USER_AGENTS, 'algo raro', '']) {
      expect(kataStrengthOptionsFor(ua).length).toBeGreaterThan(0)
    }
  })
})

describe('el criterio de móvil de la FUERZA coincide con el de la PRECISIÓN', () => {
  // Los dos criterios viven en archivos distintos A PROPÓSITO (ver cabecera de `opponentStrength.ts`):
  // `modelVariant.ts` decide qué binario se descarga y su modo de fallo es que el motor no arranque,
  // así que no se refactoriza para acomodar un feature no relacionado. El precio de esa duplicación
  // es que pueden divergir — y esto es lo que lo cobra. Es el ÚNICO lugar donde los dos se tocan.
  //
  // El predicado se deriva del VALOR ofrecido, no de `length === 1`: "móvil tiene una sola opción" es
  // la decisión de producto de hoy, no el criterio. Si mañana escritorio bajara a un preset, un test
  // apoyado en la longitud se invertiría en silencio.
  function ofreceFuerzaDeMovil(ua: string): boolean {
    return kataStrengthOptionsFor(ua)[0].visits === MOBILE_VISITS
  }

  it('para toda la batería de UA reales, ambos criterios dan lo mismo', () => {
    for (const ua of REAL_USER_AGENTS) {
      expect({ ua, movil: ofreceFuerzaDeMovil(ua) }).toEqual({ ua, movil: modelVariantFor(ua) === 'mixed16' })
    }
  })

  it('la batería cubre las dos direcciones (si fuera toda móvil o toda escritorio, no probaría nada)', () => {
    const moviles = REAL_USER_AGENTS.filter(ofreceFuerzaDeMovil)
    expect(moviles.length).toBeGreaterThan(0)
    expect(moviles.length).toBeLessThan(REAL_USER_AGENTS.length)
  })
})

describe('kataStrengthOptions', () => {
  it('fuera de un navegador devuelve los presets de escritorio en vez de lanzar', () => {
    // El entorno `node` de vitest no define `navigator`. Ningún camino de Node arma un formulario, así
    // que la respuesta correcta es la de siempre y no una excepción.
    expect(typeof navigator === 'undefined' ? kataStrengthOptions() : KATA_STRENGTH_PRESETS).toEqual(
      KATA_STRENGTH_PRESETS,
    )
  })

  it('coincide con kataStrengthOptionsFor(navigator.userAgent) cuando hay navegador', () => {
    if (typeof navigator === 'undefined') return
    expect(kataStrengthOptions()).toEqual(kataStrengthOptionsFor(navigator.userAgent))
  })
})
