// Configuración y ciclo de vida de sesiones onnxruntime-web. Archivo 100% de tengen (no adaptado de
// upstream): extrae el patrón de `bench/runner.ts` (fase 0) para uso del evaluador real (Task 9).
// `ort.env.*` es configuración de EJECUCIÓN global (EP/wasmPaths/adapter WebGPU) — se fija una sola
// vez por proceso. La SESIÓN en sí vive por-instancia en quien la crea (`OnnxEvaluator` en
// `evaluator.ts`); nunca se cachea en un global, a diferencia de `ort.env`.

import * as ort from 'onnxruntime-web'

// Mismos tipos mínimos de WebGPU que `bench/runner.ts`: no instalamos "@webgpu/types" solo por esto
// — el código toca únicamente lo declarado aquí (requestAdapter, features, info).
interface MinimalGpuAdapterInfo {
  vendor: string
  architecture: string
}
interface MinimalGpuAdapter {
  info?: MinimalGpuAdapterInfo
  features: { has(name: string): boolean }
}
interface MinimalGpu {
  requestAdapter(opts?: { powerPreference?: 'high-performance' | 'low-power' }): Promise<MinimalGpuAdapter | null>
}
declare global {
  interface Navigator {
    gpu?: MinimalGpu
  }
}

// Cacheado tras la primera llamada: pedir un adapter GPU nuevo en cada sesión es costoso y `ort.env.*`
// es configuración de proceso, no cambia entre sesiones/evaluadores.
let ortConfigured = false
async function configureOrt(): Promise<void> {
  if (ortConfigured) return
  const adapter =
    typeof navigator !== 'undefined' && navigator.gpu
      ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
      : null
  ort.env.wasm.wasmPaths = '/ort-dist/'
  ort.env.wasm.simd = true
  ort.env.wasm.numThreads =
    typeof self !== 'undefined' && self.crossOriginIsolated
      ? Math.min(8, navigator.hardwareConcurrency || 4)
      : 1
  if (adapter) ort.env.webgpu.adapter = adapter
  ortConfigured = true
}

/**
 * Crea una sesión ORT desde una URL (p.ej. `/models/...`) o un `ArrayBuffer` (OPFS/Worker/Node).
 * `ep` por defecto `'webgpu'` (Chrome-first, ver CLAUDE.md — sin fallback WASM en v1). La sesión
 * devuelta vive por-instancia en quien la llama; el caller es responsable de `session.release()`.
 */
export async function createOnnxSession(
  source: string | ArrayBuffer,
  opts?: { ep?: 'webgpu' | 'wasm' },
): Promise<ort.InferenceSession> {
  await configureOrt()
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: [opts?.ep ?? 'webgpu'],
    graphOptimizationLevel: 'all',
  }
  // Overloads de `InferenceSession.create` no se resuelven sobre un parámetro unión (string |
  // ArrayBuffer): se necesita el type guard para que TS elija la sobrecarga correcta en cada rama.
  return typeof source === 'string'
    ? ort.InferenceSession.create(source, options)
    : ort.InferenceSession.create(source, options)
}

/**
 * Introspección de nombres de input — mismo patrón que `bench/runner.ts::buildFeeds` para el caso
 * `inputNames: 'introspect'`. Lanza si faltan `bin`/`global` (entradas obligatorias de toda red
 * KataGo V7); `meta` es opcional (solo presente en redes Human SL con `meta_input`).
 */
export function resolveInputNames(session: ort.InferenceSession): { bin: string; global: string; meta?: string } {
  const bin = session.inputNames.find((n) => n.includes('bin'))
  const global = session.inputNames.find((n) => n.includes('global'))
  if (!bin || !global) throw new Error(`inputs no reconocidos: ${session.inputNames.join(',')}`)
  const meta = session.inputNames.find((n) => n.includes('meta'))
  return meta === undefined ? { bin, global } : { bin, global, meta }
}

/**
 * Introspección de nombres de output. Los ONNX convertidos exponen también outputs numéricos
 * espurios (`'1967'`, …, `fuentes.md §0`) y `moremiscvalue`/`scoring`/`futurepos`/`seki`/`scorebelief`
 * que no usamos — de ahí los `.find` con exclusiones explícitas en vez de un simple `.includes`:
 * `'moremiscvalue'` contiene `'miscvalue'` como substring, así que buscarlo a ciegas devolvería el
 * output equivocado. Lanza si faltan `policy`/`value`/`miscvalue`; `ownership` es opcional (solo se
 * pide en `fetches` cuando el caller necesita `includeOwnership`).
 */
export function resolveOutputNames(
  session: ort.InferenceSession,
): { policy: string; value: string; miscvalue: string; ownership?: string } {
  const names = session.outputNames
  const policy = names.find((n) => n.includes('policy'))
  const value = names.find((n) => n.includes('value') && !n.includes('misc'))
  const miscvalue = names.find((n) => n === 'miscvalue') ?? names.find((n) => n.includes('miscvalue') && !n.includes('more'))
  if (!policy || !value || !miscvalue) throw new Error(`outputs no reconocidos: ${names.join(',')}`)
  const ownership = names.find((n) => n.includes('ownership'))
  return ownership === undefined ? { policy, value, miscvalue } : { policy, value, miscvalue, ownership }
}
