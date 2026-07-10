// Factory de evaluador de apps/web (contexto WORKER). Lee el ONNX YA CACHEADO en OPFS por el hilo
// principal (ModelGate → ensureModel) y construye un OnnxEvaluator WebGPU desde el ArrayBuffer.
//
// HARD CONSTRAINT (Fase 1): en el worker NO existe `localStorage` → PROHIBIDO tocar `isComplete`/
// `markComplete`/`localStorage`. Este factory usa SOLO `readArrayBuffer` (OPFS puro) + el size-check
// contra el manifest. La completitud (marcador) es responsabilidad del hilo principal antes de init.
import { OnnxEvaluator } from '@tengen/engine'
import type { BoardSize, NetworkId, NNEvaluator } from '@tengen/engine'
import { requireManifestEntry } from './models/netManifest'
import { createOpfsModelStore } from './models/modelStore'

export async function appEvaluatorFactory(net: NetworkId, boardSize: BoardSize): Promise<NNEvaluator> {
  const entry = requireManifestEntry(net) // lanza para redes no disponibles (p.ej. b10).
  const store = createOpfsModelStore()

  let buf: ArrayBuffer
  try {
    buf = await store.readArrayBuffer(entry.opfsName)
  } catch (err) {
    // El archivo no está en OPFS (NotFoundError) u otro fallo de lectura: mensaje accionable.
    throw new Error(
      `modelo ${net} no está en OPFS (${entry.opfsName}); el hilo principal debe cachearlo con ` +
        `ensureModel (ModelGate) antes de init — ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (buf.byteLength !== entry.bytes) {
    throw new Error(`modelo ${net}: tamaño ${buf.byteLength} ≠ esperado ${entry.bytes} en OPFS`)
  }

  return OnnxEvaluator.create(buf, { boardSize, ep: 'webgpu' })
}
