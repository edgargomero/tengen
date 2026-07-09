// Interfaz de la costura neuronal del motor. Archivo 100% de tengen (no adaptado de upstream):
// web-katrain usa TensorFlow.js embebido; tengen inyecta un evaluador de red que devuelve tensores
// CRUDOS (pre-softmax / pre-tanh / pre-multiplicador). El MCTS (`vendor/web-katrain/analyzeMcts.ts`)
// consume esta interfaz en lugar de `model.forward()`; el `OnnxEvaluator` real (onnxruntime-web) es
// Task 9. Contrato: `decisiones-adaptacion.md §3` (firma cruda) y §4 (salida a emular).

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
