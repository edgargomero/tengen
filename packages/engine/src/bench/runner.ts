import * as ort from 'onnxruntime-web'
import { emptyBoardInputs } from './emptyBoard'
import { f32ToF16 } from './f16'
import type { ModelSpec } from './registry'
import { summarize, type BenchStats } from './stats'

export type BenchResult = {
  model: string
  ep: 'webgpu' | 'wasm'
  batch: number
  stats: BenchStats
  sanity: string[]
  adapter: string
}

// Tipos mínimos de WebGPU: no instalamos "@webgpu/types" solo por esto — el
// código toca únicamente lo declarado aquí (requestAdapter, features, info).
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

let ortConfigured = false
async function configureOrt(): Promise<string> {
  const adapter = navigator.gpu
    ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    : null
  if (!ortConfigured) {
    ort.env.wasm.wasmPaths = '/wasm/'
    ort.env.wasm.simd = true
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.min(8, navigator.hardwareConcurrency || 4)
      : 1
    if (adapter) ort.env.webgpu.adapter = adapter
    ortConfigured = true
  }
  const info = adapter?.info
  return info ? `${info.vendor} ${info.architecture} (f16: ${adapter!.features.has('shader-f16')})` : 'sin WebGPU'
}

function buildFeeds(model: ModelSpec, session: ort.InferenceSession, batch: number, size: number) {
  const { bin, global } = emptyBoardInputs(size, 7.5, batch)
  const names =
    model.inputNames === 'introspect'
      ? {
          bin: session.inputNames.find((n) => n.includes('bin'))!,
          global: session.inputNames.find((n) => n.includes('global'))!,
          meta: session.inputNames.find((n) => n.includes('meta')),
        }
      : model.inputNames
  const feeds: Record<string, ort.Tensor> = {}
  if (model.dtype === 'float16') {
    feeds[names.bin] = new ort.Tensor('float16', f32ToF16(bin), [batch, 22, size, size])
    feeds[names.global] = new ort.Tensor('float16', f32ToF16(global), [batch, 19])
    if (names.meta) feeds[names.meta] = new ort.Tensor('float16', f32ToF16(new Float32Array(batch * 192)), [batch, 192])
  } else {
    feeds[names.bin] = new ort.Tensor('float32', bin, [batch, 22, size, size])
    feeds[names.global] = new ort.Tensor('float32', global, [batch, 19])
    if (names.meta) feeds[names.meta] = new ort.Tensor('float32', new Float32Array(batch * 192), [batch, 192])
  }
  return feeds
}

function sanityCheck(model: ModelSpec, out: ort.InferenceSession.OnnxValueMapType, size: number): string[] {
  const issues: string[] = []
  const outNames = Object.keys(out)
  const policyName = outNames.find((n) => n.includes('policy'))
  const valueName = outNames.find((n) => n.includes('value') && !n.includes('misc'))
  if (!policyName || !valueName) {
    issues.push(`salidas inesperadas: ${outNames.join(',')}`)
    return issues
  }
  const policy = out[policyName]!.data as Float32Array | Uint16Array
  const value = out[valueName]!.data as Float32Array | Uint16Array
  const finite = (v: number) => Number.isFinite(v)
  // fp16 llega como Uint16Array: solo comprobamos que no sea todo ceros
  if (policy instanceof Uint16Array) {
    if (policy.every((v) => v === 0)) issues.push('policy todo ceros (fp16)')
  } else {
    const head0 = policy.slice(0, size * size + 1)
    if (![...head0].every(finite)) issues.push('policy con NaN/Inf')
    const passIdx = size * size
    const argmax = [...head0].reduce((best, v, i) => (v > head0[best]! ? i : best), 0)
    if (argmax === passIdx) issues.push('argmax=PASS en tablero vacío (sospechoso)')
  }
  if (value instanceof Float32Array && ![...value.slice(0, 3)].every(finite)) issues.push('value con NaN/Inf')
  return issues
}

export async function runBench(
  model: ModelSpec,
  opts: { ep: 'webgpu' | 'wasm'; batch: number; warmup: number; runs: number; size: number },
): Promise<BenchResult> {
  const adapter = await configureOrt()
  const session = await ort.InferenceSession.create(`/models/${model.id}`, {
    executionProviders: [opts.ep],
    graphOptimizationLevel: 'all',
  })
  const feeds = buildFeeds(model, session, opts.batch, opts.size)
  let sanity: string[] = []
  for (let i = 0; i < opts.warmup; i++) {
    const out = await session.run(feeds)
    if (i === 0) sanity = sanityCheck(model, out, opts.size)
  }
  const timings: number[] = []
  for (let i = 0; i < opts.runs; i++) {
    const t0 = performance.now()
    await session.run(feeds)
    timings.push(performance.now() - t0)
  }
  await session.release()
  return { model: model.id, ep: opts.ep, batch: opts.batch, stats: summarize(timings, opts.batch), sanity, adapter }
}
