# Fase engine — decisiones de adaptación de web-katrain

Fecha: 2026-07-09. Complementa `fuentes.md`. Resuelve, con las interfaces ya verificadas contra el código (web-katrain commit `7a0a487` en `~/dev/vendor/web-katrain`), la estrategia concreta de la fase engine: **adaptar web-katrain (MIT), no reimplementar**. Base de la extracción: 7 lecturas paralelas de los módulos + crítico de completitud (workflow `wf_bcf8bc9b-420`).

## Qué se adapta y qué es nuestro

**Adaptado de web-katrain (MIT, con atribución) — la parte algorítmica difícil ya está portada:**

- `fastBoard.ts`: board con capturas/ko/suicidio (`playMove`/`undoMove`, `SimPosition`), libertades (`computeLibertyMap(Into)`), **solver de escaleras** (`computeLadderFeaturesV7KataGo(Into)` → planos 14/17; `computeLadderedStonesV7KataGo(Into)` → plano 14), **área de Benson** (`computeAreaMapV7KataGo(Into)` → planos 18/19). Presupuesto de escalera: 25 000 nodos. Produce mapas por-punto `Uint8Array` de longitud `BOARD_AREA` en orden row-major `y*BOARD_SIZE+x` — **layout-agnóstico** (no sabe de NHWC/NCHW).
- `featuresV7Fast.ts`: `fillInputsV7Fast` — encoding V7 completo (planos 0–19 + 19 globals). **Escribe NHWC** (`idxNHWC(x,y,c)=(y*W+x)*22+c`).
- `analyzeMcts.ts`: `MctsSearch` (create/run/getAnalysis/reRootToChild), `expandNode` (softmax sobre legales), `selectEdge` (PUCT+FPU), virtual loss (`inFlight`), backup por recompute. Constructor privado; sin `stop()` (aborta por `shouldAbort`), sin `selectMove()` (jugada = `moves[order===0]`, por visitas puras — sin temperatura ni LCB-select).
- `evalV8.ts`: `postprocessKataGoV8` (softmax value, softplus stdev, ×20, ×(1−noResultProb), perspectiva a Negro). `scoreValue.ts`: `expectedWhiteScoreValue` (tabla precomputada de score-utility).

**100% nuestro (web-katrain no lo tiene):**

- **Evaluador ONNX** (onnxruntime-web) que reemplaza el runner TF.js (`KataGoModelV8Tf` + `parseKataGoModelV8` + `binModelParser` = **descartados enteros**).
- **`meta_input[192]` de Human SL** (`sgfmetadata`) — web-katrain no hace Human SL; su `model.forward(spatial, global)` es de **2 inputs**.
- **Interfaz `Engine {init, genMove, analyze, stop}`**, protocolo del Web Worker, caché OPFS.
- **`f16ToF32`** (hoy `f16.ts` solo tiene `f32ToF16`).
- **Tests contra `kata-raw-nn`** (KataGo desktop).

## Conflictos/decisiones resueltos

1. **Policy: head-0 pura, `policyOptimism=0`.** `fuentes.md §3` (cabeza 0, `policy[b,6,H·W+1]` con pase en el último índice) contra el port (mezcla de 2 canales base+optimism con `policyPass` separado). Se resuelve a **head-0 pura**: al adaptar, partir el tensor ONNX `policy[b,6,H·W+1]` en logits de tablero de la cabeza 0 + `passLogit` (índice `H·W`), descartar cabezas 1–5, y **podar la ruta de optimism-mix** del port (no dejar código que lea `policyArr[src+1]` sobre un layout fusionado). Coherente con la decisión de producto.

2. **Layout: encoder en NCHW, reescribiendo el indexador (no transponer).** Los ONNX de tengen son NCHW `bin_input[b,22,H,W]` (`c*H*W+y*W+x`); `fillInputsV7Fast` escribe NHWC. Se **forkea** el encoder a `encoding/featuresV7.ts` con `idxNCHW` y `boardSize` parametrizado (una línea por escritura de plano), evitando transponer 9724 floats por hoja del MCTS.

3. **La costura neuronal.** El MCTS no recibe evaluador inyectado: llama a `evaluateBatch` interna, que llama `model.forward()`/`forwardPolicyValue()` (TF.js, ~L1447-1466). Se sustituye **solo ese bloque** por `NNEvaluator.evaluate(...)`. Firma objetivo: `evaluate(bin: Float32Array /*b·22·N·N NCHW*/, global: Float32Array /*b·19*/, meta: Float32Array|null /*b·192*/, batch, includeOwnership): Promise<{ policy; policyPass; value; scoreValue; ownership? }>` con **arrays crudos** (pre-softmax/pre-tanh/pre-multiplier). El softmax vive en `expandNode`; el postproceso value/score en `evalV8`. También hay que quitar la detección de backend `tf.getBackend()` (decide batchSize) por una señal propia de WebGPU.

4. **Contrato de salida a emular (verificar contra el export real de katago-onnx antes de cablear índices):** `value[b,3]`=[win,loss,noResult] logits (jugador al turno); `miscvalue[b,10]`→`scoreValue[4]`=[scoreMean, stdev_preSoftplus, lead, varTimeLeft] con `[0]·20=scoreMean, softplus([1])·20=stdev, [2]·20=lead`, y ×(1−noResultProb); `ownership[b,1,H,W]` pre-tanh. **`postProcessParams`** (mult=20, outputScale=1) NO están en el contrato ONNX → constante por-modelo; correctos para b18c384nbt. Para humanv0: **confirmado** leyendo el header de `humanv0.bin.gz` (version 15, 22 canales, 19 globals) que los multiplicadores de score son `20/20/20` — los defaults de `evalV8` sirven también para Human SL; doblar-confirmar `outputScaleMultiplier` al leer el header completo si hay duda. Riesgo de doble-postproceso: confirmar que el grafo ONNX emite crudos (no ya-softmaxeado/tanh).

5. **Multi-size 9/13/19: núcleo parametrizado + un Worker por tamaño.** `BOARD_SIZE/BOARD_AREA/PASS_MOVE` son `export let` module-global en `fastBoard`; `setBoardSize` realloca todo el scratch; `scoreValue.expectedSVTable` cachea **una** tabla por tamaño. Decisión: cada Worker fija `setBoardSize(N)` una vez en `init()` y **no cambia** (sin thrashing); la app recrea el Worker al cambiar de tamaño de partida. **Prohibido**: dos tamaños intercalados o dos búsquedas concurrentes en el mismo Worker (scratch module-global mutable, no reentrante — una búsqueda a la vez, sin `await` entre `playMove` y la lectura). Romper el acoplamiento a globales en `scoreValue` pasando `boardSize`/`sqrtBoardArea` explícitos.

6. **Reentrancia.** Todo el stack (fastBoard, featuresV7, scoreValue, MCTS) usa buffers scratch module-global. `genMove` y `analyze` no pueden solaparse en un Worker. Paralelismo real = varios Workers.

7. **`playMove` NO es transaccional en el suicidio (landmine descubierto en Task 3).** En `fastBoard.playMove`, los rechazos por punto ocupado y por ko simple lanzan **antes** de mutar (`throw` en las guardas iniciales), pero el rechazo por suicidio lanza **después** de haber hecho `pos.stones[move] = player` (y de correr el bucle de capturas). Como una jugada suicida por definición no captura nada (`totalCaptured===0`, `captureStack` y `koPoint` intactos), el único estado sucio es la piedra fantasma en `pos.stones[move]`. **Implicación para Task 8 (MCTS) y cualquier código que filtre legalidad con `try { playMove } catch`:** un `catch { continue }` ingenuo deja el tablero corrupto en la rama de suicidio. Dos salidas correctas: (a) determinar legalidad **sin** llamar a `playMove` (comprobar suicidio aparte antes de jugar — preferible en el hot path del MCTS, que ya trabaja sobre jugadas legales de la policy enmascarada), o (b) si se usa el patrón try/catch, hacer rollback manual **solo** cuando `err.message === 'Illegal suicide move'` (`pos.stones[move] = EMPTY`; equivalente a `undoMove` con snapshot sintético `{ koPointBefore: pos.koPoint, captureStart: captureStack.length }` tomado antes de la llamada). No hacer rollback en las otras dos ramas: lanzan sin mutar, y deshacer borraría una piedra legítima. El test de Task 3 documenta y ejercita esto (`tests/board.test.ts`).

## Oráculos y tolerancias de test

- **`@sabaki/go-board` = oráculo de REGLAS.** Contra él: `playMove/undoMove` (capturas, suicidio, ko simple), legalidad, secuencias con captura+deshacer. Exacto (mismo estado). Ojo: `playMove` **lanza** en ilegal; comparar solo semántica común (KataGo = ko simple, no superko posicional).
- **Oráculo diferencial de encoding (coste cero, exacto):** el `fillInputsV7Fast` NHWC original (vendorizado sin tocar) vs nuestro encoder NCHW, plano a plano tras des-transponer. Ancla la reescritura de layout con 0 ULP.
- **`kata-raw-nn` = oráculo de la SALIDA de la red** (policy/value/ownership) dada una posición, NO del encoding ni de reglas. Perspectiva **Blanca** → convertir; `SYMMETRY=0`; `policy` illegal=`NaN` → enmascarar; orden de claves no garantizado → parse tolerante.
- **`meta_input`**: no observable por `kata-raw-nn` → golden de `python/sgfmetadata.py` para un `preaz_9d` conocido (tol ~1e-6) + invariantes (termómetro suma `min(invRank,34)`, one-hots suman 1, cada par de fecha módulo 1, `[74]==0.5`).
- **MCTS**: red mock determinista (`Rand` de semilla fija) — forma del árbol, PUCT/FPU, virtual-loss (`inFlight`), colisiones (deshacer+reintentar), backup, `moves[order===0]`.
- **Tolerancias**: fp32 ONNX (Node) vs `kata-raw-nn` estrecha (winrate |Δ|≲0.01, lead ≲0.3 pt, argmax + top-5 coinciden); fp16 vs fp32 (mismo ONNX) mide solo quantización (winrate |Δ|≲0.02, top-move estable).

## Runtime de test (tres capas)

- **Node/Vitest, sin modelo**: f16 codec, board vs @sabaki, libertades/área/escaleras, encoder NCHW (diferencial), meta, postproceso, MCTS con mock. El grueso.
- **Node con modelo (onnxruntime-web wasm EP headless — ya verificado que corre en Node, `fuentes.md §0`)**: `NNEvaluator` + fp32 end-to-end vs `kata-raw-nn`, fp16 vs fp32. Fuera de Vitest (script dedicado).
- **Browser/WebGPU (Playwright/bench)**: Worker, Engine, OPFS, inf/s real. Reusar headers COOP/COEP + middlewares `/models` `/ort-dist` del bench; no romper `npm run bench`.

## Atribución de licencias

Cada archivo adaptado de web-katrain lleva **cabecera de origen** (web-katrain, commit `7a0a487`, MIT, © autores) + `THIRD-PARTY-LICENSES`/`NOTICE` con el texto MIT: `fastBoard.ts`, `featuresV7.ts` (fork de `featuresV7Fast.ts`), `analyzeMcts.ts`, `searchParams.ts`, `scoreValue.ts`, `evalV8.ts`, y el patrón de `types.ts`/`client.ts`/`worker.ts` si se copian. **Kaya es AGPL — prohibido copiar** (check en el plan de que ningún fragmento de Kaya entra). `convert-humanv0.py` ya marcado AGPL (uso local).
