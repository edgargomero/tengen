// Factory de evaluador de Fase 0: mapea NetworkId → /models/<archivo>.onnx (servido por el middleware
// serve-models del dev server, que apunta a packages/engine/models/) y construye un OnnxEvaluator WebGPU.
// TRIVIAL a propósito: Fase 1 reemplaza esto por caché OPFS + descarga R2 con progreso.
import { OnnxEvaluator } from '@tengen/engine'
import type { BoardSize, NetworkId, NNEvaluator } from '@tengen/engine'

// Nombres de archivo bajo /models/ (dev: packages/engine/models/). Coinciden con los .onnx convertidos
// ya presentes en disco. b10 aún no convertida.
const MODEL_FILES: Record<NetworkId, string> = {
  b18: 'b18c384nbt-kata1.fp16.onnx',
  humanv0: 'b18c384nbt-humanv0.fp16.onnx',
  b10: '',
}

export async function appEvaluatorFactory(net: NetworkId, boardSize: BoardSize): Promise<NNEvaluator> {
  const file = MODEL_FILES[net]
  if (file === '') throw new Error(`red ${net} aún no disponible en apps/web`)
  return OnnxEvaluator.create(`/models/${file}`, { boardSize, ep: 'webgpu' })
}
