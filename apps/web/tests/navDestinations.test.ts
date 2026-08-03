// Los destinos del marco son datos puros, así que se testean en Node sin DOM ni router.
//
// Lo que se fija acá no es la lista (esa cambia con el producto), son las dos propiedades de las que
// depende el marco para no romperse: que TODA ruta tenga una ubicación legible —incluida una que no
// existe— y que los destinos sean distinguibles entre sí.
import { describe, expect, it } from 'vitest'
import {
  NAV_DESTINATIONS,
  activeDestinationFor,
  locationLabelFor,
  normalizePath,
} from '../src/ui/navDestinations'

describe('locationLabelFor', () => {
  it.each([
    ['/', 'Inicio'],
    ['/jugar', 'Jugar'],
    ['/analizar', 'Analizar'],
    ['/partidas', 'Mis partidas'],
    ['/diagnostico', 'Diagnóstico'],
  ])('%s → %s', (path, label) => {
    expect(locationLabelFor(path)).toBe(label)
  })

  it('devuelve la etiqueta del menú para una ruta desconocida', () => {
    // `<ModeMenu path="/" default />` hace que cualquier URL sin ruta propia pinte el menú, así que
    // "Inicio" es lo que el usuario está viendo de verdad. Lo que NO puede pasar es una cadena
    // vacía: dejaría la marca colgando de un separador sin nada al lado.
    expect(locationLabelFor('/ruta-que-no-existe')).toBe('Inicio')
    expect(locationLabelFor('/ruta-que-no-existe')).not.toBe('')
  })

  it('ignora query y hash — volver del login de Google trae `?code=…`', () => {
    expect(locationLabelFor('/partidas?code=abc&state=xyz')).toBe('Mis partidas')
    expect(locationLabelFor('/jugar#seccion')).toBe('Jugar')
  })

  it('trata la barra final como la misma pantalla', () => {
    expect(locationLabelFor('/analizar/')).toBe('Analizar')
  })
})

describe('normalizePath', () => {
  it('deja la raíz como raíz', () => {
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('/?code=abc')).toBe('/')
  })
})

describe('NAV_DESTINATIONS', () => {
  it('no tiene paths duplicados', () => {
    // Un duplicado marcaría dos celdas como activas a la vez y haría que el marco mienta sobre
    // dónde estás. Lo mismo con los ids, que son la clave de render y del estado activo.
    const paths = NAV_DESTINATIONS.map((d) => d.path)
    const ids = NAV_DESTINATIONS.map((d) => d.id)
    expect(new Set(paths).size).toBe(paths.length)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('incluye "Mis partidas" — se ofrece con o sin sesión', () => {
    // Ocultarlo sin sesión haría saltar el marco de 2 a 3 celdas al loguearse; la pantalla de
    // invitación ya existe (`PartidasView`, rama `user === null`).
    expect(NAV_DESTINATIONS.map((d) => d.path)).toContain('/partidas')
  })

  it('cada destino tiene una ubicación con el mismo nombre', () => {
    // Si un destino nuevo se agrega sin su etiqueta de ubicación, el marco lo listaría abajo y
    // arriba diría "Inicio" — dos afirmaciones contradictorias sobre dónde estás.
    for (const d of NAV_DESTINATIONS) {
      expect(locationLabelFor(d.path)).toBe(d.label)
    }
  })
})

describe('activeDestinationFor', () => {
  it('encuentra el destino de la ruta actual', () => {
    expect(activeDestinationFor('/analizar')?.id).toBe('analizar')
    expect(activeDestinationFor('/partidas?code=abc')?.id).toBe('partidas')
  })

  it('no marca ninguno en el menú ni en una ruta desconocida', () => {
    // `undefined` es un estado legítimo del marco: en el menú ningún destino está activo.
    expect(activeDestinationFor('/')).toBeUndefined()
    expect(activeDestinationFor('/ruta-que-no-existe')).toBeUndefined()
  })
})
