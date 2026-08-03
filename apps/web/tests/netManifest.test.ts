import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VARIANT,
  manifestVariantsOf,
  netManifest,
  requireManifestEntry,
  resolveManifestEntry,
} from '../src/models/netManifest'

// Los `bytes` de acá están fijados a los valores medidos con `stat -f%z` sobre los binarios reales.
// No son decorativos: `ensureModel` rechaza la descarga ante UN byte de diferencia, así que un
// número mal copiado deja el modelo inservible en silencio y este test es lo que lo atrapa.
describe('netManifest', () => {
  it('b18 fp32 devuelve la entrada exacta', () => {
    expect(requireManifestEntry('b18', 'fp32')).toEqual({
      opfsName: 'b18c384nbt-kata1.fp32.v1.onnx',
      sourceUrl: '/models/b18c384nbt-kata1.fp32.onnx',
      bytes: 115800125,
    })
  })

  it('b18 mixed16 devuelve la entrada exacta', () => {
    expect(requireManifestEntry('b18', 'mixed16')).toEqual({
      opfsName: 'b18c384nbt-kata1.mixed16.v1.onnx',
      sourceUrl: '/models/b18c384nbt-kata1.mixed16.onnx',
      bytes: 58093573,
    })
  })

  it('humanv0 fp32 devuelve la entrada exacta', () => {
    expect(requireManifestEntry('humanv0', 'fp32')).toEqual({
      opfsName: 'b18c384nbt-humanv0.fp32.v1.onnx',
      sourceUrl: '/models/b18c384nbt-humanv0.fp32.onnx',
      bytes: 108040143,
    })
  })

  it('humanv0 mixed16 devuelve la entrada exacta', () => {
    expect(requireManifestEntry('humanv0', 'mixed16')).toEqual({
      opfsName: 'b18c384nbt-humanv0.mixed16.v1.onnx',
      sourceUrl: '/models/b18c384nbt-humanv0.mixed16.onnx',
      bytes: 54194233,
    })
  })

  it('b10 lanza en los dos caminos (red aún no disponible)', () => {
    expect(() => requireManifestEntry('b10', 'fp32')).toThrow('red b10 aún no disponible en apps/web')
    expect(() => resolveManifestEntry('b10', 'mixed16')).toThrow('red b10 aún no disponible en apps/web')
  })

  it('netManifest no tiene entrada para b10', () => {
    expect(netManifest.b10).toBeUndefined()
  })

  // El `sourceUrl` es la key PLANA del bucket R2 y el `opfsName` lleva el sufijo de versión `.v1`.
  // Se parecen lo justo para pegarlos mal; si divergen, la descarga trae 404 o la lectura del worker
  // no encuentra el archivo.
  it('sourceUrl es la key de R2 y opfsName lleva versión, en toda entrada', () => {
    for (const net of ['b18', 'humanv0'] as const) {
      for (const { variant, entry } of manifestVariantsOf(net)) {
        expect(entry.sourceUrl).toBe(`/models/${entry.opfsName.replace('.v1.onnx', '.onnx')}`)
        expect(entry.opfsName).toContain(`.${variant}.v1.onnx`)
      }
    }
  })

  it('el mixto pesa alrededor de la mitad que el fp32 (es el punto de convertirlo)', () => {
    for (const net of ['b18', 'humanv0'] as const) {
      const ratio = requireManifestEntry(net, 'mixed16').bytes / requireManifestEntry(net, 'fp32').bytes
      expect(ratio).toBeGreaterThan(0.45)
      expect(ratio).toBeLessThan(0.55)
    }
  })
})

describe('resolveManifestEntry (camino de producción: con fallback)', () => {
  it('devuelve la variante pedida cuando existe', () => {
    const { variant, entry } = resolveManifestEntry('b18', 'mixed16')
    expect(variant).toBe('mixed16')
    expect(entry.opfsName).toBe('b18c384nbt-kata1.mixed16.v1.onnx')
  })

  it('cae a fp32 —informando la variante EFECTIVA— si la pedida no está publicada', () => {
    // Se simula una red sin `mixed16` mutando el manifest, porque hoy las dos redes publican las dos
    // variantes. El caso importa igual: es exactamente lo que pasaría si una conversión futura no
    // pasara su validación y se decidiera no servirla.
    const original = netManifest.humanv0
    try {
      netManifest.humanv0 = { fp32: original!.fp32! }
      const { variant, entry } = resolveManifestEntry('humanv0', 'mixed16')
      expect(variant).toBe('fp32') // ← la EFECTIVA, no la pedida: el caller no puede quedarse con la ilusión
      expect(entry.opfsName).toBe('b18c384nbt-humanv0.fp32.v1.onnx')
    } finally {
      netManifest.humanv0 = original
    }
  })
})

describe('requireManifestEntry (camino de la sonda: estricto)', () => {
  // La asimetría con `resolveManifestEntry` es el punto: una prueba de rendimiento que cae en
  // silencio a otra variante reporta un número correcto con la etiqueta equivocada, y esa medición
  // es la que decide si hace falta convertir una red más chica.
  it('lanza —sin caer a fp32— si la variante pedida no está publicada', () => {
    const original = netManifest.humanv0
    try {
      netManifest.humanv0 = { fp32: original!.fp32! }
      expect(() => requireManifestEntry('humanv0', 'mixed16')).toThrow(
        'red humanv0 no tiene variante mixed16 en apps/web',
      )
    } finally {
      netManifest.humanv0 = original
    }
  })
})

describe('manifestVariantsOf', () => {
  it('lista las dos variantes de una red publicada', () => {
    expect(manifestVariantsOf('b18').map((v) => v.variant)).toEqual(['fp32', 'mixed16'])
  })

  it('devuelve vacío para una red no publicada (no lanza: la limpieza no tiene nada que borrar)', () => {
    expect(manifestVariantsOf('b10')).toEqual([])
  })

  it('toda red publicada tiene la variante por defecto, que es lo que hace viable el fallback', () => {
    for (const net of ['b18', 'humanv0'] as const) {
      expect(manifestVariantsOf(net).some((v) => v.variant === DEFAULT_VARIANT)).toBe(true)
    }
  })
})
