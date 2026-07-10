// Detección de WebGPU (Chrome-first, sin fallback WASM en v1 — ver CLAUDE.md). No basta con que exista
// `navigator.gpu`: puede existir y no entregar adapter (GPU bloqueada, driver, etc.), así que se pide el
// adapter real. La app sólo arranca el motor si esto es true.
interface MinimalGpu {
  requestAdapter(): Promise<unknown | null>
}

export async function detectWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu
  if (!gpu) return false
  try {
    const adapter = await gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}
