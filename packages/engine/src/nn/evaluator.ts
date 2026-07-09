// Interfaz de la costura neuronal del motor. Archivo 100% de tengen (no adaptado de upstream):
// web-katrain usa TensorFlow.js embebido; tengen inyecta un evaluador de red que devuelve tensores
// CRUDOS (pre-softmax / pre-tanh / pre-multiplicador). El MCTS (`vendor/web-katrain/analyzeMcts.ts`)
// consume esta interfaz en lugar de `model.forward()`; el `OnnxEvaluator` real (onnxruntime-web) es
// Task 9. Contrato: `decisiones-adaptacion.md §3` (firma cruda) y §4 (salida a emular).

import * as ort from 'onnxruntime-web'
import { f32ToF16, f16ToF32 } from '../f16'
import { createOnnxSession, resolveInputNames, resolveOutputNames } from './session'

/**
 * Salida CRUDA de la red para un batch. Layout por-batch contiguo.
 * - `policy`: logits de la cabeza 0 sobre el tablero, `policy[b·boardArea + (y·N + x)]`. Sin softmax.
 * - `policyPass`: logit de pase de la cabeza 0, uno por elemento del batch.
 * - `value`: logits `[win, loss, noResult]` desde la perspectiva del jugador al turno, `value[b·3 + k]`.
 * - `scoreValue`: `[scoreMean, stdevPreSoftplus, lead, varTimeLeft]` crudos, `scoreValue[b·4 + k]`.
 * - `ownership`: opcional, pre-tanh, `ownership[b·boardArea + (y·N + x)]`.
 */
export type RawEval = {
  policy: Float32Array // len batch·boardArea, logits cabeza 0 (NCHW: por-batch contiguo)
  policyPass: Float32Array // len batch, logit de pase cabeza 0
  value: Float32Array // len batch·3, logits [win, loss, noResult] jugador al turno
  scoreValue: Float32Array // len batch·4, [scoreMean, stdevPreSoftplus, lead, varTimeLeft] crudos
  ownership?: Float32Array // len batch·boardArea, pre-tanh
}

/**
 * Evaluador de red neuronal inyectado en el MCTS. Recibe features V7 ya construidos en NCHW:
 * - `bin`: `[batch, 22, N, N]` aplanado (`b·22·N² + c·N² + y·N + x`).
 * - `global`: `[batch, 19]` aplanado.
 * - `meta`: `[batch, 192]` de Human SL (`sgfmetadata`) o `null` si `hasMeta === false`.
 */
export interface NNEvaluator {
  readonly boardSize: number
  readonly hasMeta: boolean
  evaluate(args: {
    bin: Float32Array
    global: Float32Array
    meta: Float32Array | null
    batch: number
    includeOwnership: boolean
  }): Promise<RawEval>
}

/** Decodifica un output ORT a `Float32Array`, sea fp32 (passthrough) o fp16 (`f16ToF32`). El `type`
 *  del tensor de salida es la fuente de verdad por-output (no un flag global): en teoría un modelo
 *  podría mezclar dtypes entre outputs, y así funciona igual. */
function decodeOutput(t: ort.Tensor): Float32Array {
  return t.type === 'float16' ? f16ToF32(t.data as Uint16Array) : (t.data as Float32Array)
}

/**
 * `NNEvaluator` real sobre onnxruntime-web. Archivo 100% de tengen (no adaptado de upstream): carga
 * la sesión ONNX (introspección de nombres de input/output vía `session.ts`), arma los feeds
 * (fp16/fp32 según el modelo, `meta` solo si `hasMeta`), corre `session.run` pidiendo outputs
 * EXPLÍCITOS (los ONNX convertidos exponen outputs numéricos espurios, `fuentes.md §0`) y produce
 * `RawEval` crudo: parte `policy[b, numHeads, área+1]` en cabeza-0 (tablero) + pase, mapea
 * `miscvalue[b,10]` → `scoreValue[b,4]` (índices 0..3, SIN ×20/softplus — eso es `postprocessKataGoV8`,
 * Task 7) y decodifica fp16 con `f16ToF32`. Perspectiva: la red da la del jugador al turno; este
 * evaluador NO convierte a Negro (responsabilidad de Task 7).
 *
 * La sesión ORT vive por-instancia (no en un global) — `ort.env.*`, en cambio, sí es configuración
 * de proceso y se fija una sola vez dentro de `session.ts::createOnnxSession`.
 */
export class OnnxEvaluator implements NNEvaluator {
  readonly boardSize: number
  readonly hasMeta: boolean

  private readonly session: ort.InferenceSession
  private readonly dtype: 'float32' | 'float16'
  private readonly inputNames: { bin: string; global: string; meta?: string }
  private readonly outputNames: { policy: string; value: string; miscvalue: string; ownership?: string }

  private constructor(args: {
    session: ort.InferenceSession
    boardSize: number
    dtype: 'float32' | 'float16'
    inputNames: { bin: string; global: string; meta?: string }
    outputNames: { policy: string; value: string; miscvalue: string; ownership?: string }
  }) {
    this.session = args.session
    this.boardSize = args.boardSize
    this.dtype = args.dtype
    this.inputNames = args.inputNames
    this.outputNames = args.outputNames
    this.hasMeta = args.inputNames.meta !== undefined
  }

  /**
   * Carga la sesión y resuelve nombres/dtype por introspección. `source`: URL (`/models/...`) o
   * `ArrayBuffer` (OPFS/Worker/Node). `boardSize`: los ONNX declaran H/W como ejes dinámicos — no hay
   * forma de leer el tamaño real del tablero del modelo, así que lo fija quien construye el evaluador.
   */
  static async create(
    source: string | ArrayBuffer,
    opts: { boardSize: number; ep?: 'webgpu' | 'wasm' },
  ): Promise<OnnxEvaluator> {
    const session = await createOnnxSession(source, { ep: opts.ep })
    const inputNames = resolveInputNames(session)
    const outputNames = resolveOutputNames(session)
    const binMeta = session.inputMetadata.find((m) => m.name === inputNames.bin)
    const dtype: 'float32' | 'float16' = binMeta && binMeta.isTensor && binMeta.type === 'float16' ? 'float16' : 'float32'
    return new OnnxEvaluator({ session, boardSize: opts.boardSize, dtype, inputNames, outputNames })
  }

  async evaluate(args: {
    bin: Float32Array
    global: Float32Array
    meta: Float32Array | null
    batch: number
    includeOwnership: boolean
  }): Promise<RawEval> {
    const { bin, global, meta, batch, includeOwnership } = args
    const n = this.boardSize
    const area = n * n

    if (this.hasMeta && !meta) {
      throw new Error(
        'OnnxEvaluator.evaluate: la red espera meta_input[192] (hasMeta=true) pero se recibió meta=null — error de programación en el caller',
      )
    }
    if (includeOwnership && !this.outputNames.ownership) {
      throw new Error('OnnxEvaluator.evaluate: includeOwnership=true pero el modelo no expone el output "ownership"')
    }

    const feeds: Record<string, ort.Tensor> = {}
    if (this.dtype === 'float16') {
      feeds[this.inputNames.bin] = new ort.Tensor('float16', f32ToF16(bin), [batch, 22, n, n])
      feeds[this.inputNames.global] = new ort.Tensor('float16', f32ToF16(global), [batch, 19])
      if (this.inputNames.meta) feeds[this.inputNames.meta] = new ort.Tensor('float16', f32ToF16(meta!), [batch, 192])
    } else {
      feeds[this.inputNames.bin] = new ort.Tensor('float32', bin, [batch, 22, n, n])
      feeds[this.inputNames.global] = new ort.Tensor('float32', global, [batch, 19])
      if (this.inputNames.meta) feeds[this.inputNames.meta] = new ort.Tensor('float32', meta!, [batch, 192])
    }

    const fetches: string[] = [this.outputNames.policy, this.outputNames.value, this.outputNames.miscvalue]
    if (includeOwnership && this.outputNames.ownership) fetches.push(this.outputNames.ownership)

    const out = await this.session.run(feeds, fetches)

    const policyTensor = out[this.outputNames.policy]!
    const valueTensor = out[this.outputNames.value]!
    const miscTensor = out[this.outputNames.miscvalue]!

    const policyData = decodeOutput(policyTensor)
    const value = decodeOutput(valueTensor) // [b,3] directo, layout ya coincide con RawEval.value

    // policy [b, numHeads, área+1] head-major: cabeza-0 = primeros (área+1) del bloque del batch b.
    // `numHeads` se lee del tensor real (nunca hardcodeado — puede variar entre redes).
    const numHeads = policyTensor.dims[1]
    if (numHeads === undefined) {
      throw new Error(`OnnxEvaluator.evaluate: output "policy" con dims inesperados: [${policyTensor.dims.join(',')}]`)
    }
    const policy = new Float32Array(batch * area)
    const policyPass = new Float32Array(batch)
    for (let b = 0; b < batch; b++) {
      const base = b * numHeads * (area + 1)
      for (let i = 0; i < area; i++) policy[b * area + i] = policyData[base + i]!
      policyPass[b] = policyData[base + area]!
    }

    // miscvalue [b,10] → scoreValue [b,4] = índices 0..3, CRUDO (sin ×20/softplus): eso es
    // `postprocessKataGoV8` (Task 7), que este evaluador no llama.
    const miscData = decodeOutput(miscTensor)
    const scoreValue = new Float32Array(batch * 4)
    for (let b = 0; b < batch; b++) {
      for (let k = 0; k < 4; k++) scoreValue[b * 4 + k] = miscData[b * 10 + k]!
    }

    let ownership: Float32Array | undefined
    if (includeOwnership) {
      // outputNames.ownership garantizado por el guard de arriba; dims [b,1,H,W] ya aplana al mismo
      // layout que RawEval.ownership (b·área + y·N + x), sin reordenar.
      const ownershipTensor = out[this.outputNames.ownership!]!
      ownership = decodeOutput(ownershipTensor)
    }

    return { policy, policyPass, value, scoreValue, ownership }
  }

  /** Libera la sesión ORT subyacente. No forma parte de `NNEvaluator` (la interfaz no la declara);
   *  quien construye un `OnnxEvaluator` es responsable de llamarla cuando termine de usarlo. */
  async dispose(): Promise<void> {
    await this.session.release()
  }
}
