RESUMEN: Contrato I/O de los ONNX de KataGo estilo kaya, verificado contra 3 fuentes primarias independientes (código TS de kaya, código Rust de kaya, y decodificación protobuf directa de los .onnx en HuggingFace): entradas `bin_input` float [batch_size,22,height,width] NCHW y `global_input` float [batch_size,19]; 9 salidas: `policy` [b,6,h*w+1], `value` [b,3], `miscvalue` [b,10], `moremiscvalue` [b,8], `ownership` [b,1,h,w], `scoring` [b,1,h,w], `futurepos` [b,2,h,w], `seki` [b,4,h,w], `scorebelief` [b,842]. Los .fp32.onnx y .uint8.onnx tienen I/O float32 (QDQ interno); los .fp16.onnx tienen I/O float16 (contradice la model card de HF que dice "I/O remains FP32" — verificado byte a byte en ambas variantes). Kaya usa onnxruntime-web ^1.24.3 con import 'onnxruntime-web/all', EPs ['webgpu','wasm'], wasmPaths '/wasm/', COOP/COEP + coi-serviceworker para multithreading WASM. Featurización en onnx-featurization.ts: solo llena planos 0-6 y 9-13 (los planos 7-8 y 14-21 quedan en cero) y global[0-5] (pases + selfKomi/20). MCTS batchea hojas con virtual loss: batch = min(maxInferenceBatch, 8); analyzeBatch (escaneo de partida completa con numVisits=1) mete todas las posiciones en una sola llamada si el modelo es de batch dinámico. En HF solo existen 2 variantes de b28c512nbt (no hay b18c384nbt, b10c128 ni b18-humanv0); el conversor kaya-go/katago-onnx existe y sería necesario para generar esas redes. Advisor tool no disponible (falló al invocarlo).

HALLAZGOS:
- Nombres EXACTOS de tensores de entrada: 'bin_input' y 'global_input' (no existe 'swa_model_bin_inputs' ni 'input_spatial'). Verificado en la llamada session.run({ bin_input: binTensor, global_input: globalTensor }) y decodificado del protobuf del .onnx real. [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-engine.ts (línea ~259) + decodificación protobuf de https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-s12043015936-d5616446734/kata1-b28c512nbt-s12043015936-d5616446734.uint8.onnx + https://raw.githubusercontent.com/kaya-go/kaya/main/apps/desktop/src-tauri/src/onnx_engine/inference.rs)
- Shapes de entrada: bin_input = [batch_size, 22, height, width] (NCHW, ejes dinámicos batch_size/height/width como dim_param simbólicos); global_input = [batch_size, 19]. Para 19x19 batch 1: [1,22,19,19] y [1,19]. [alta] (Decodificación protobuf directa del ONNX (ValueInfoProto tag 0x5a) en huggingface.co/kaya-go/kaya; coincide con onnx-engine.ts createTensor(..., [batchSize, 22, size, size]) y [batchSize, 19])
- dtype de I/O: .fp32.onnx y .uint8.onnx usan float32 en entradas y salidas (el uint8 tiene QuantizeLinear/DequantizeLinear internos: se ven nodos bin_input_QuantizeLinear en el protobuf); los .fp16.onnx tienen I/O float16 (elem_type=10) en AMBAS variantes (s12043015936 y adam-s11165M). Esto CONTRADICE la model card de HF que dice 'FP16 Conversion: I/O remains FP32 for compatibility' — la model card está desactualizada; hay que alimentar tensores float16. [alta] (Decodificación protobuf de los tails de kata1-b28c512nbt-s12043015936-d5616446734.fp16.onnx y kata1-b28c512nbt-adam-s11165M-d5387M.fp16.onnx vs https://huggingface.co/kaya-go/kaya/blob/main/README.md)
- Salidas (9 en total, decodificadas del archivo real): policy [batch_size, 6, height*width+1] (362 en 19x19; 6 cabezas de policy — la model card dice 2, está desactualizada; kaya solo usa la cabeza 0), value [batch_size, 3] (logits win/loss/noresult), miscvalue [batch_size, 10], moremiscvalue [batch_size, 8], ownership [batch_size, 1, height, width], scoring [batch_size, 1, height, width], futurepos [batch_size, 2, height, width], seki [batch_size, 4, height, width], scorebelief [batch_size, 842]. [alta] (Decodificación protobuf (ValueInfoProto tag 0x62) del uint8 y fp16 .onnx en huggingface.co/kaya-go/kaya; cross-check con processBatchResults en https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-utils.ts y result_processing.rs)
- Interpretación de salidas (onnx-utils.ts processBatchResults, líneas 110-225): winrate del jugador al turno = softmax(value[0..3])[0]; a perspectiva de Negro: pla===1 ? w : 1-w. scoreLead = miscvalue[2] * 20.0 (perspectiva del jugador al turno) * pla para perspectiva de Negro. Policy: softmax sobre los primeros numMoves logits de la cabeza 0 (stride = numHeads*numMoves cuando dims.length===3); índice size*size = PASS, si no y=floor(idx/size), x=idx%size, letras GTP 'ABCDEFGHJKLMNOPQRST' (sin I), fila = size-y. ownership se multiplica por pla para perspectiva de Negro. [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-utils.ts + https://raw.githubusercontent.com/kaya-go/kaya/main/apps/desktop/src-tauri/src/onnx_engine/result_processing.rs (idéntica lógica))
- Featurización (archivo packages/ai-engine/src/onnx-featurization.ts, funciones featurize() y featurizeToBuffer(board, pla, komi, history, bin_input, global_input, batchIndex, size)): de los 22 planos solo llena: 0=todo unos, 1=piedras propias, 2=piedras rivales, 3/4/5=piedras con 1/2/3 libertades (BFS por cadena, clamp a 4), 6=punto prohibido por ko, 9-13=one-hot de las últimas 5 jugadas. Los planos 7, 8 y 14-21 quedan en CERO (simplificación de kaya vs las features V7 completas de KataGo: ladder, pass-alive, encore). global_input (19 floats): índices 0-4 = 1.0 si la jugada n-atrás fue pase; índice 5 = selfKomi/20 con selfKomi = -pla*komi (Sign: Negro=1, Blanco=-1; comentario del código: 'KataGo encodes rowGlobal[5] = selfKomi * 0.05'); índices 6-18 quedan en cero. [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-featurization.ts (líneas 6-124); equivalente Rust: https://raw.githubusercontent.com/kaya-go/kaya/main/apps/desktop/src-tauri/src/onnx_engine/featurization.rs)
- Sesión ORT de kaya (packages/ai-engine/src/onnx-session.ts, createOnnxSession): import * as ort from 'onnxruntime-web/all'; ort.env.wasm.numThreads = crossOriginIsolated ? min(8, hardwareConcurrency) : 1; ort.env.wasm.simd=true; ort.env.wasm.proxy=false; ort.env.wasm.wasmPaths = config.wasmPath || '/wasm/'; pre-configura ort.env.webgpu.adapter con navigator.gpu.requestAdapter({powerPreference:'high-performance'}) y detecta shader-f16 con adapter.features.has('shader-f16') (si falta, avisa que fp16 caerá a WASM). SessionOptions: executionProviders (default ['webgpu','wasm'], filtra webgl siempre y webgpu/webnn si no disponibles), graphOptimizationLevel:'all', logSeverityLevel:2, intraOpNumThreads/interOpNumThreads, enableCpuMemArena:true, enableMemPattern:true, executionMode:'sequential'. Opcional graph capture (solo modelos de shape estático): preferredOutputLocation:'gpu-buffer' + enableGraphCapture:true + buffers GPU preasignados con ort.Tensor.fromGpuBuffer (onnx-gpu.ts). Para WebNN: freeDimensionOverrides {batch_size, height, width}. [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-session.ts + https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-gpu.ts)
- Detección de propiedades del modelo: kaya lee (session as any).handler.inputMetadata (API interna NO documentada de ort-web) para detectar batch estático (dims[0]>0 de bin_input) y dtype fp16 (type==='float16'). Los inputNames/outputNames públicos de InferenceSession son la alternativa documentada para nombres. [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-session.ts (detectModelProperties, líneas 181-242))
- Path fp16: kaya convierte Float32Array → Uint16Array manualmente (float32ToFloat16 en onnx-utils.ts, IEEE 754 half) y crea new ort.Tensor('float16', uint16Data, dims). Confirmado que en ORT 1.24 el type map de tensores define float16: Uint16Array ('Keep using Uint16Array until we have a concrete solution for float 16', js/common/lib/tensor.ts línea 85, rama rel-1.24.1). [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-utils.ts (líneas 9-68) + https://raw.githubusercontent.com/microsoft/onnxruntime/rel-1.24.1/js/common/lib/tensor.ts)
- Entry points de onnxruntime-web 1.24.3 (exports map de npm): '.', './all', './jspi', './wasm', './webgl', './webgpu' (+ paths directos a los .wasm/.mjs). El bundle default '.' registra los backends webgpu, webnn, wasm y cpu (js/web/lib/index.ts con BUILD_DEFS); './all' añade webgl (es el que usa kaya); './webgpu' es el path que documenta el tutorial oficial de WebGPU EP ('import * as ort from onnxruntime-web/webgpu'). Sesión: ort.InferenceSession.create(urlOrBuffer, { executionProviders: ['webgpu'] }). [alta] (https://registry.npmjs.org/onnxruntime-web (versión 1.24.3) + https://raw.githubusercontent.com/microsoft/onnxruntime/rel-1.24.1/js/web/lib/index.ts + https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)
- Flags/headers ORT-web (doc oficial): ort.env.wasm.wasmPaths acepta prefijo string (p.ej. CDN o '/wasm/') o mapa por archivo; los .wasm deben ser de la MISMA versión que el bundle JS. Multithreading WASM solo se activa si crossOriginIsolated === true, lo que requiere headers COOP: same-origin y COEP: require-corp. Kaya los sirve en su dev server (rsbuild.config.ts) y para GitHub Pages usa coi-serviceworker; copia public/wasm → /wasm/ en el build. ort.env.wasm.proxy es incompatible con WebGPU EP. [alta] (https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html + https://raw.githubusercontent.com/kaya-go/kaya/main/apps/web/rsbuild.config.ts)
- Batching de kaya: (a) MCTS (analyze con numVisits>1): selecciona hojas con PUCT + virtual loss y las evalúa en lotes; maxMctsBatch = Math.min(this.maxInferenceBatch, 8) — es decir, batch de hasta 8 posiciones por inferencia con modelos de batch dinámico (comentario del código: '8 strikes a balance for interactive use'). (b) analyzeBatch (escaneo policy-only de partida completa, numVisits=1): featuriza TODAS las posiciones y trocea por maxInferenceBatch — que es Infinity en modelos de batch dinámico, así que va todo en UNA sola llamada session.run. (c) Con staticBatchSize (p.ej. modelos static-b1 o WebNN) trocea y rellena con ceros (zero-padding) hasta el batch estático. [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-engine.ts (líneas 191-240, 269-317, 394-420) + https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-mcts.ts (runMCTS, virtual loss))
- MCTS de kaya (onnx-mcts.ts): PUCT con CPUCT=1.5, virtual loss para diversificar dentro del batch, valores acumulados W (winrate de Negro) y S (score lead), expansión de nodos con la policy filtrando ko/ocupadas, ownership promediado sobre evaluaciones raíz, progreso emitido por lote con yield al event loop, AbortSignal para cancelación, e includeMove con visitas forzadas (mínimo max(3, 5% de visitas)). [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/onnx-mcts.ts)
- El engine corre dentro de un Web Worker (packages/ui/src/workers/ai.worker.ts, module worker) con protocolo postMessage (init/analyze/analyzeBatch/abort); la config se arma en packages/ui/src/workers/engineFactory.ts: wasmPath '/wasm/', executionProviders ['webgpu','wasm'], numThreads min(8, hardwareConcurrency), modelBuffer (ArrayBuffer descargado aparte). Selección automática de cuantización en auto-config.ts: webgpu+shader-f16 → fp16; webgpu sin shader-f16 → fp32; wasm → fp32; uint8 nunca se auto-selecciona ('1.7x slower than fp32 on CPU'). [alta] (https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ui/src/workers/ai.worker.ts + https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ui/src/workers/engineFactory.ts + https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/src/auto-config.ts)
- Modelos disponibles en HF kaya-go/kaya: SOLO dos variantes de b28c512nbt (kata1-b28c512nbt-adam-s11165M-d5387M y kata1-b28c512nbt-s12043015936-d5616446734), cada una en .fp32/.fp16/.uint8. Tamaños verificados (content-length) para s12043015936: uint8=75176896, fp16=146963282 (el adam fp16 mide exactamente lo mismo). NO existen ONNX de b18c384nbt, b10c128 ni b18-humanv0 en ese repo — para benchmarkearlas habría que convertirlas con el conversor kaya-go/katago-onnx (existe, 'Convert KataGo models to ONNX', opset 17, licencia NOASSERTION en GitHub API). Dependencia declarada: onnxruntime-web ^1.24.3 (packages/ai-engine/package.json). [alta] (https://huggingface.co/api/models/kaya-go/kaya + headers HTTP de huggingface.co/kaya-go/kaya/resolve/main/... + https://api.github.com/repos/kaya-go/katago-onnx + https://raw.githubusercontent.com/kaya-go/kaya/main/packages/ai-engine/package.json)
- La model card de HF (kaya-go/kaya README.md) documenta el contrato I/O con ejemplos Python y JS (útil como cita), pero tiene DOS errores vs los archivos reales: dice policy [batch,2,moves] (real: [batch,6,moves]) y dice que fp16 mantiene I/O FP32 (real: I/O float16). Opset 17, ejes dinámicos batch/height/width, conversión con kaya-go/katago-onnx. [alta] (https://huggingface.co/kaya-go/kaya/blob/main/README.md contrastado con decodificación protobuf de los .onnx)

SNIPPETS:
=== 1. CONTRATO I/O EXACTO (decodificado del protobuf de los .onnx reales en huggingface.co/kaya-go/kaya) ===

INPUT  bin_input     float32|float16  [batch_size, 22, height, width]   // NCHW, ejes dinámicos
INPUT  global_input  float32|float16  [batch_size, 19]
OUTPUT policy        [batch_size, 6, height*width + 1]  // 362 en 19x19; usar SOLO cabeza 0 (primeros 362)
OUTPUT value         [batch_size, 3]                    // logits [win, loss, noresult] del jugador al turno
OUTPUT miscvalue     [batch_size, 10]                   // [2] = lead; puntos = lead * 20.0
OUTPUT moremiscvalue [batch_size, 8]
OUTPUT ownership     [batch_size, 1, height, width]     // perspectiva del jugador al turno (* pla → Negro)
OUTPUT scoring       [batch_size, 1, height, width]
OUTPUT futurepos     [batch_size, 2, height, width]
OUTPUT seki          [batch_size, 4, height, width]
OUTPUT scorebelief   [batch_size, 842]
// dtype: .fp32.onnx y .uint8.onnx → I/O float32 (QDQ interno); .fp16.onnx → I/O float16 (¡la model card miente!)

=== 2. LÍNEAS LOAD-BEARING DE KAYA (citas de referencia, AGPL — no copiar) ===
// packages/ai-engine/src/onnx-engine.ts L259:
//   const results = await this.session!.run({ bin_input: binTensor, global_input: globalTensor });
// packages/ai-engine/src/onnx-engine.ts L224:
//   const maxMctsBatch = Math.min(this.maxInferenceBatch, 8);
// packages/ai-engine/src/onnx-utils.ts L65:
//   return new ort.Tensor('float16', float16Data, dims);   // float16Data: Uint16Array
// packages/ai-engine/src/onnx-featurization.ts L123:
//   setGlobal(5, (-pla * komi) / 20.0);                     // selfKomi * 0.05
// packages/ai-engine/src/onnx-utils.ts L172:
//   const leadCurrentPlayer = miscvalue[2] * 20.0;
// import usado en todos los archivos: import * as ort from 'onnxruntime-web/all';

=== 3. CÓDIGO MÍNIMO PROPIO (verificado contra docs oficiales ORT-web 1.24.x) ===
// npm i onnxruntime-web@^1.24.3
// Headers para WASM multihilo (crossOriginIsolated): COOP: same-origin, COEP: require-corp
// (o coi-serviceworker en hosting estático). WebGPU EP NO los necesita, pero el fallback WASM sí.

import * as ort from 'onnxruntime-web';           // bundle default 1.24.x: incluye webgpu+webnn+wasm
// alternativa documentada: import * as ort from 'onnxruntime-web/webgpu';
// (docs: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)

// --- Detección WebGPU + shader-f16 (API estándar WebGPU) ---
async function detectGpu() {
  if (!('gpu' in navigator)) return { webgpu: false, f16: false };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { webgpu: false, f16: false };
  return { webgpu: true, f16: adapter.features.has('shader-f16'), adapter };
}

// --- Sesión ---
const { webgpu, f16, adapter } = await detectGpu();
ort.env.wasm.wasmPaths = '/wasm/';                // copiar node_modules/onnxruntime-web/dist/*.wasm|*.mjs ahí (MISMA versión que el bundle)
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
if (webgpu) { ort.env.webgpu.adapter = adapter; ort.env.webgpu.powerPreference = 'high-performance'; }

const session = await ort.InferenceSession.create(modelUrlOrArrayBuffer, {
  executionProviders: webgpu ? ['webgpu', 'wasm'] : ['wasm'],
  graphOptimizationLevel: 'all',
});
console.log(session.inputNames, session.outputNames); // ['bin_input','global_input'] / ['policy','value',...]

// --- Tensores e inferencia (batch B, tablero N=19) ---
const B = 1, N = 19;
const bin = new Float32Array(B * 22 * N * N);      // llenar con featurización (planos 0-6, 9-13)
const glob = new Float32Array(B * 19);             // glob[5] = -pla * komi / 20
// fp32/uint8:
const feeds = {
  bin_input:    new ort.Tensor('float32', bin,  [B, 22, N, N]),
  global_input: new ort.Tensor('float32', glob, [B, 19]),
};
// fp16 (requiere adapter con shader-f16): convertir a half y usar Uint16Array:
//   new ort.Tensor('float16', f32ToF16(bin), [B, 22, N, N])   // float16 ↔ Uint16Array en ORT 1.24
const t0 = performance.now();
const out = await session.run(feeds);
const dt = performance.now() - t0;                 // inferencias/s = B / (dt/1000); descartar 1as corridas (warmup/compilación shaders)

// --- Lectura de salidas ---
const policy = out.policy.data;                    // Float32Array; cabeza 0 = primeros N*N+1 logits; idx N*N = PASS
const value  = out.value.data;                     // softmax([v0,v1,v2]); [0] = P(gana el que mueve)
const lead   = out.miscvalue.data[2] * 20.0;       // puntos a favor del que mueve
// (con preferredOutputLocation:'gpu-buffer' usar await out.policy.getData())

=== 4. OPCIONAL AVANZADO (kaya, para fase posterior del benchmark) ===
// Graph capture (solo shapes estáticos y todos los kernels en WebGPU):
//   sessionOptions: { preferredOutputLocation: 'gpu-buffer', enableGraphCapture: true }
//   + ort.Tensor.fromGpuBuffer(buf, { dataType: 'float16'|'float32', dims }) con buffers usage COPY_SRC|COPY_DST|STORAGE
// WebNN: freeDimensionOverrides: { batch_size: 1, height: 19, width: 19 }
// URLs modelo control b28 (batch dinámico):
//   https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-s12043015936-d5616446734/kata1-b28c512nbt-s12043015936-d5616446734.{fp16|fp32|uint8}.onnx