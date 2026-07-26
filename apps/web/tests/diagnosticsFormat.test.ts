// Veredicto + volcado. El veredicto es la única parte del diagnóstico con lógica de decisión, y lo que
// se protege es su ORDEN de preguntas: el caso interesante (y el que motivó el archivo) es "el hilo
// principal ve WebGPU y el worker no", porque ahí el gate de la app pasa y el motor no arranca.
import { describe, expect, it } from 'vitest'
import type { Diagnostics } from '../src/diagnostics/collect'
import { diagnose, formatBytes, formatDiagnostics, warnings } from '../src/diagnostics/format'
import type { GpuProbe } from '../src/diagnostics/gpuProbe'
import { summarizeUserAgent } from '../src/diagnostics/userAgent'

function probe(scope: 'main' | 'worker', overrides: Partial<GpuProbe> = {}): GpuProbe {
  return {
    scope,
    hasNavigatorGpu: true,
    adapter: 'ok',
    device: 'ok',
    adapterInfo: { vendor: 'apple', architecture: 'common-3' },
    features: ['shader-f16'],
    limits: { maxBufferSize: 4294967296 },
    crossOriginIsolated: true,
    hasSharedArrayBuffer: true,
    hardwareConcurrency: 8,
    elapsedMs: 12,
    ...overrides,
  }
}

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

function diagnostics(overrides: Partial<Diagnostics> = {}): Diagnostics {
  return {
    buildId: 'cbc4328 · 2026-07-26 12:00 UTC',
    collectedAt: '2026-07-26T12:34:56.000Z',
    url: 'https://tengen.kntor.io/diagnostico',
    displayMode: 'standalone',
    language: 'es-CL',
    userAgentRaw: UA_IPHONE,
    userAgent: summarizeUserAgent({ userAgent: UA_IPHONE }),
    serviceWorker: { supported: true, controlled: true, scope: 'https://tengen.kntor.io/', waiting: false },
    storage: { persisted: true, usageBytes: 223_840_268, quotaBytes: 1_000_000_000 },
    models: [{ net: 'b18', opfsName: 'b18c384nbt-kata1.fp32.v1.onnx', bytes: 115_800_125, cached: true }],
    main: probe('main'),
    worker: probe('worker'),
    ...overrides,
  }
}

describe('diagnose', () => {
  it('todo sano: veredicto positivo con la GPU nombrada como evidencia', () => {
    const verdict = diagnose(diagnostics())
    expect(verdict.ok).toBe(true)
    expect(verdict.detail).toContain('apple · common-3')
  })

  it('sin adapter en el hilo principal: culpa al hilo principal, con el motivo textual', () => {
    const verdict = diagnose(
      diagnostics({
        main: probe('main', { adapter: 'null', adapterError: 'requestAdapter() devolvió null', device: 'skipped' }),
      }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toContain('requestAdapter() devolvió null')
  })

  it('adapter sí y device no: lo reporta como fallo, no como éxito (el gate lo dejaría pasar)', () => {
    const verdict = diagnose(
      diagnostics({ main: probe('main', { device: 'error', deviceError: 'OperationError: sin memoria' }) }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toContain('OperationError: sin memoria')
  })

  it('un device que se pierde solo NO es un device sano', () => {
    const verdict = diagnose(diagnostics({ main: probe('main', { deviceLost: 'unknown: lost' }) }))
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toContain('se perdió solo')
  })

  it('EL caso que el gate no ve: la página ve WebGPU, el worker no', () => {
    const verdict = diagnose(
      diagnostics({
        worker: probe('worker', { hasNavigatorGpu: false, adapter: 'unsupported', device: 'unsupported' }),
      }),
    )
    expect(verdict.ok).toBe(false)
    expect(verdict.headline).toContain('no en el worker')
    expect(verdict.detail).toContain('navigator.gpu')
  })

  it('un worker que no arranca se reporta como fallo del worker, no como "todo bien"', () => {
    const verdict = diagnose(diagnostics({ worker: { error: 'el worker no respondió en 12000 ms' } }))
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toContain('no respondió')
  })
})

describe('warnings', () => {
  it('sin aislamiento cross-origin avisa por página y por worker (deciden numThreads del motor)', () => {
    const notes = warnings(
      diagnostics({
        main: probe('main', { crossOriginIsolated: false, hasSharedArrayBuffer: false }),
        worker: probe('worker', { crossOriginIsolated: false }),
      }),
    )
    expect(notes.some((n) => n.includes('COOP/COEP'))).toBe(true)
    expect(notes.some((n) => n.includes('El worker no está cross-origin isolated'))).toBe(true)
    expect(notes.some((n) => n.includes('SharedArrayBuffer'))).toBe(true)
  })

  it('avisa si la cuota no alcanza para los pesos que la app guarda', () => {
    const notes = warnings(diagnostics({ storage: { quotaBytes: 50_000_000 } }))
    expect(notes.some((n) => n.includes('cuota de almacenamiento'))).toBe(true)
  })

  it('nada que avisar en un dispositivo sano', () => {
    expect(warnings(diagnostics())).toEqual([])
  })
})

describe('formatDiagnostics', () => {
  it('incluye build, UA crudo y los DOS scopes: es lo que se pega en un reporte', () => {
    const dump = formatDiagnostics(diagnostics())
    expect(dump).toContain('build: cbc4328 · 2026-07-26 12:00 UTC')
    expect(dump).toContain(UA_IPHONE)
    expect(dump).toContain('webgpu · hilo principal')
    expect(dump).toContain('webgpu · worker')
    expect(dump).toContain('iOS: 26.0')
    expect(dump).toContain('WebKit: 605.1.15')
    expect(dump).toContain('modo de display: standalone')
  })

  it('la unidad legible va SÓLO en los límites que son tamaños, no en los que son conteos', () => {
    const dump = formatDiagnostics(
      diagnostics({
        main: probe('main', {
          limits: { maxBufferSize: 4294967292, maxComputeWorkgroupsPerDimension: 65535 },
        }),
      }),
    )
    expect(dump).toContain('maxBufferSize: 4294967292 (4.3 GB)')
    // Un conteo de grupos de trabajo con "(65.5 kB)" al lado sería un dato inventado con cara de real.
    expect(dump).toContain('maxComputeWorkgroupsPerDimension: 65535\n')
    expect(dump).not.toContain('65535 (')
  })

  it('un worker fallido aparece como error en su sección, sin perder el resto del volcado', () => {
    const dump = formatDiagnostics(diagnostics({ worker: { error: 'no se pudo crear el worker: SecurityError' } }))
    expect(dump).toContain('error: no se pudo crear el worker: SecurityError')
    expect(dump).toContain('webgpu · hilo principal')
  })

  it('el estado de cada modelo en OPFS entra en el volcado (una cuota corta explica fallos sin WebGPU)', () => {
    const dump = formatDiagnostics(
      diagnostics({
        models: [
          { net: 'b18', opfsName: 'a.onnx', bytes: 115_800_125, cached: true },
          { net: 'humanv0', opfsName: 'b.onnx', bytes: 108_040_143, cached: false },
        ],
      }),
    )
    expect(dump).toContain('b18: en caché — 115.8 MB')
    expect(dump).toContain('humanv0: falta — 108.0 MB')
  })
})

describe('formatBytes', () => {
  it('usa unidades decimales, las mismas en que están escritos el manifest y el informe de fase 0', () => {
    expect(formatBytes(115_800_125)).toBe('115.8 MB')
    expect(formatBytes(1_000_000_000)).toBe('1.0 GB')
    expect(formatBytes(512)).toBe('512 B')
  })
})
