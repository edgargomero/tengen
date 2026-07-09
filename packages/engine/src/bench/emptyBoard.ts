/** Posición de tablero vacío en el esquema de inputs de los ONNX de KataGo
 *  (bin_input [batch,22,N,N], global_input [batch,19]). Suficiente para
 *  benchmark; la featurización completa llega con el engine real. */
export function emptyBoardInputs(
  size: number,
  komi: number,
  batch: number,
): { bin: Float32Array; global: Float32Array } {
  const planeLen = size * size
  const perPosBin = 22 * planeLen
  const bin = new Float32Array(batch * perPosBin)
  const global = new Float32Array(batch * 19)
  for (let b = 0; b < batch; b++) {
    bin.fill(1, b * perPosBin, b * perPosBin + planeLen) // plano 0: máscara del tablero
    global[b * 19 + 5] = (-1 * komi) / 20 // selfKomi/20, Negro al turno (pla=1)
  }
  return { bin, global }
}
