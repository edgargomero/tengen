# Ledger fase engine — plan docs/superpowers/plans/2026-07-09-fase-engine.md

Rama: `fase-engine` (base main @ 53f72f0). Estrategia: subagent-driven-development.
Docs base commiteados: 25915ed (plan + research + CLAUDE.md).

## Prep de entorno (background) — LISTO
- KataGo desktop 1.16.5 instalado (brew).
- b18c384nbt.bin.gz (**97898094 bytes**) + humanv0.bin.gz (**99066230 bytes**) descargados y validados (gzip ok) en packages/engine/models/katago-bin/. Bytes reales corrigen los del plan original (eran 214M/324M, mal; ya corregidos en el plan). humanv0 header: postProcessParams=20/20/20 (confirma decisiones-adaptacion §4).

## Estándar transversal (fijado)
- Adaptabilidad upstream + reanudable por LLM: log en `docs/research/fase-engine/adaptaciones-upstream.md` (runbook re-sync + guía retomar). Constraint global en el plan. Commit b77f9f0. Toda adaptación de terceros registra sus cambios ahí.

## [OBSOLETO — Task 8 ya completa, ver lista de Tasks. La PRÓXIMA ACCIÓN vigente está más abajo (Task 11).] PRÓXIMA ACCIÓN histórica — Task 8 (costura neuronal del MCTS).

**Qué es:** adaptar `analyzeMcts.ts` (2811 líneas) reemplazando la costura TF.js por un `NNEvaluator` inyectado. Es el cambio de mayor riesgo de re-sync. HEAD actual = `4e242a8`.
**Brief completo (leer primero):** `.superpowers/sdd/task-8-brief.md` (119 líneas; incluye la interfaz `NNEvaluator`/`RawEval`, el test con mock, y los 5 cambios a–e). Contexto de costuras: `decisiones-adaptacion.md §3` (firma cruda del evaluador) y `§4` (contrato de salida a emular).
**Modelo:** opus (tarea núcleo grande e intrincada, como Task 5). Despachar síncrono.

**Archivos:** modify `vendor/web-katrain/analyzeMcts.ts`; create `nn/evaluator.ts` (SOLO la interfaz `NNEvaluator` + tipo `RawEval`; el `MockEvaluator` vive en el test) y `search/mcts.ts` (`createSearch` mapea `GameState`→lo que `MctsSearch.create` espera e inyecta el evaluador); test `tests/mcts.test.ts` (red mock determinista). Actualizar `adaptaciones-upstream.md` (fila de analyzeMcts) en el mismo commit.

**Los 5 cambios (a–e, ver brief L869):** (a) quitar `import * as tf` (L7) + `./modelV8` (KataGoModelV8Tf); (b) constructor/`create` recibe `evaluator: NNEvaluator` en vez de `model`; (c) **la costura está en L1455–1500 de evaluateBatch**: reemplazar `tf.tensor4d(spatialBatch,[b,N,N,22])`/`model.forward()`/`.data()`/`.dispose()` (L1455–1474) por: construir `bin` NCHW+`global`+`meta` con `fillFeaturesV7NCHW` (Task 5) para cada estado del batch, `await evaluator.evaluate({...})`, usar `RawEval`; (d) **podar el bloque optimism-mix L1476–1500** (`usePolicyOptimism`/`mix`/`policyArr[src+1]`) → usar `policy`/`policyPass` head-0 directos (el evaluador ya hace el split); postprocessKataGoV8 (L1512) se queda; (e) `tf.getBackend()==='webgpu'` (L2405, L2412) → flag `preferLargeBatch` en args (default false).
**Intacto:** expandNode (softmax sobre legales), selectEdge (PUCT+FPU), virtual loss (`inFlight`), backup, getAnalysis, class MctsSearch (L1537).

**Interfaz objetivo (de decisiones §3 + brief):** `evaluate({ bin: Float32Array /*b·22·N·N NCHW*/, global /*b·19*/, meta: Float32Array|null /*b·192*/, batch, includeOwnership }): Promise<RawEval>` con `RawEval = { policy; policyPass; value; scoreValue; ownership? }` **CRUDO** (pre-softmax/tanh/mult). Task 9 hace el `OnnxEvaluator implements NNEvaluator`; el mock del test también lo implementa.

**Trampa NCHW:** `evaluateBatch` hoy arma `spatialBatch` NHWC in-place (antes de L1455). Rewirearlo a `fillFeaturesV7NCHW` para `bin` NCHW. El evaluador consume NCHW; NO transponer.

**Los 40 errores tsc (TODOS en analyzeMcts.ts) hay que resolverlos en Task 8:** 20× `Move.x/.y/.player` (definir `Move` LOCAL estilo web-katrain `{x,y,player}` — NO es el `Move` de tengen `{color,vertex}`; resolver como los demás tipos locales); missing exports de `../../types`: `Player`/`GameRules`/`RegionOfInterest`/`FloatArray`/`BoardState` → defs locales mínimas; missing modules `@tensorflow/tfjs`+`./modelV8` (se eliminan con la costura), `./limits`+`../../utils/animationFrame` (inline/stub mínimo); 6× `noUncheckedIndexedAccess` → guards. Meta: analyzeMcts a 0 errores tras Task 8.

**Passthrough de Task 7 en analyzeMcts (L461/L475/L487/L499):** ya pasa `getSqrtBoardArea(BOARD_AREA)` y `boardSize: BOARD_SIZE` a scoreValue. Task 8 puede mantenerlo o limpiarlo al desacoplar board size; no romperlo.

**Gate:** `tests/mcts.test.ts` con mock determinista (jugada más visitada = favorito; determinismo con mismo mock sin ruido). Task 10 gatea end-to-end vs `kata-raw-nn`.

Tras despachar impl → `review-package 4e242a8 <head>` + task-reviewer (opus, diff grande y de riesgo). Cómo retomar/continuar: `docs/research/fase-engine/adaptaciones-upstream.md`.

Herramienta útil confirmada: `sgfmetadata.py` real de KataGo en `~/dev/vendor/katago-onnx/src/katago/game/` (AGPL, vía pixi) — sirvió para el golden de Task 6.

## Tasks
- Task 0: **complete** (impl `d080ff5`; fix review `854cec9`; review spec ✅ + calidad Approved tras 1 Important arreglado). `setup-katago.sh` + `gen-reference.mjs` (driver GTP, reutiliza proceso katago, parseo tolerante + `NAN`→`null`) + 10 fixtures en `tests/fixtures/reference/` + script `gen-reference` en package.json. Sanity anclado OK (hoshi 60/72/288/300 + whiteWin≈0.63, determinismo intra-proceso) verificado por controlador, implementador Y reviewer (que re-derivó a mano 5/10 fixtures: geometría/orientación/máscara de null exactas; seki genuino por libertades pese a que `final_status_list` de katago lo maljuzga; ko con 7 piedras+suicidio+ko-ban). **Important arreglado (854cec9):** `gen-reference.mjs` no tenía handler `proc.on('exit')` (pese a un comentario que lo afirmaba) → si katago arrancaba pero moría después, el send en vuelo colgaba para siempre y el stderr diagnóstico se descartaba. Ahora buffer de stderr acotado + handler 'exit' que rechaza lo pendiente con code/signal+stderr + ignora EPIPE en stdin. Ruta feliz idéntica → fixtures no cambian. Task 0 NO adapta código de terceros (invoca el binario katago, no copia fuente GPL) → sin entrada en adaptaciones-upstream.md.
- Task 1: complete (impl 479552b, cabeceras 4176677, fix review 4b69c25; review clean tras 1 Important arreglado [THIRD-PARTY-LICENSES pointer]). Vendoring verbatim verificado byte a byte, sin AGPL, HUMAN_RANKS 29 ok, tsconfig ok.
- Task 2: complete (impl 0539ef9, fix subnormal 03dddea; review clean tras 1 Important arreglado [cobertura rama subnormal exp==0]). f16 9/9 verde.
- Task 3: **complete** (impl ea4fddd, fix cobertura 10de079; review clean tras 1 Important [test no ejercitaba capturas/ko] arreglado y re-revisado Approved). Board validado vs @sabaki: fuzz 9×9 con guard de capturas>0 + tests deterministas de captura y KO_SIMPLE. fastBoard.ts sin cambios de lógica.
  - **CAVEAT descubierto (afecta Task 8):** `fastBoard.playMove` NO es transaccional en el suicidio — muta `pos.stones[move]` antes de lanzar `'Illegal suicide move'` (las ramas ocupado/ko simple sí lanzan antes de mutar). Documentado en `decisiones-adaptacion.md §7` + nota de re-sync en `adaptaciones-upstream.md`. Task 8 debe filtrar legalidad SIN `try{playMove}catch` ingenuo (o hacer rollback acotado al mensaje de suicidio).
  - Minor (para review final): rollback del test depende del string literal `'Illegal suicide move'`; ya cubierto por la nota de re-sync.
- Task 4: **complete** (impl 6d2e184; review clean Approved, sin Critical/Important). Test-only: 8 tests validan el solver de escaleras (incl. rompe-escaleras con idéntico conteo de libertades → prueba lectura de secuencia real, no heurística) y el área de Benson. **Hallazgo load-bearing para Task 5:** `computeAreaMapV7KataGo(Into)` hardcodea `safeBigTerritories:true` Y `unsafeBigTerritories:true` (marca territorio de grupos matados por Benson si la región no toca al rival) — divergencia de flags vs KataGo solo se gatea en Task 10, no en el diff-oracle de Task 5. Ver decisiones-adaptacion §8. `currentPlayer` en el solver solo afecta a `ladderWorkingMoves` (plano 17), no a `ladderedStones` (plano 14).
- Task 5: **complete** (impl 79f1466, fix regresión 4eacd0e; review Approved a fondo con opus tras 1 Important [gap de cobertura de buildGameState] cerrado). Fork NCHW == oráculo NHWC verbatim (confirmado por diff directo vs upstream: solo layout+N+imports); GameState correcto (fallback de historial COINCIDE con KataGo, no es desviación; currentPlayer = opuesto de última jugada). featuresV7Fast vendorizado (verbatim salvo imports + 2 `!`). Desviaciones (koPoint histórico=−1, handicap orientation, flags de área) gateadas por Task 10.
- Task 6: **complete** (impl f2f85f9; review Approved, sin Critical/Important). meta_input[192] con 3 goldens del `sgfmetadata.py` REAL de KataGo (9d@361, 20k@361, 9d@81) — comparación index-by-index de los 192 canales; reviewer recomputó fórmulas independientemente (fecha, logs de tiempo, área). `inverseRank` correcto en borde dan/kyu. Añadido `resolveJsonModule:true` a `packages/engine/tsconfig.json` (acotado). Sin copia AGPL.
- Task 7: **complete** (impl 4e242a8; review Approved SIN hallazgos). evalV8.ts verbatim salvo cabecera + `Player` local + 6 `!`; scoreValue.ts desacoplado de BOARD_AREA/BOARD_SIZE globales → parámetro, cache re-keyed por tamaño (test de re-keying no tautológico, verificado por sabotaje independiente del reviewer). Parche de 6 líneas en analyzeMcts.ts (call-sites de scoreValue, pasa los mismos globals → behavior-idéntico, documentado como passthrough que Task 8 reemplaza). evalV8/scoreValue a 0 errores tsc.
- Task 8: **complete** (impl 76cd535; review spec ✅ + calidad Approved, sin Critical/Important). Costura TF.js reemplazada por `NNEvaluator` inyectado: `import * as tf`/`KataGoModelV8Tf`/`modelV8` eliminados por completo; `evaluateBatch` construye `bin` NCHW por-estado con `fillFeaturesV7NCHW` (Task 5) + simetría en NCHW → `evaluator.evaluate()` → `RawEval` crudo; policy-optimism **podado** (head-0 pura, sin leer canal +1); `tf.getBackend()`→flag `preferLargeBatch`. `analyzeMcts` 40→0 errores tsc. Nuevos: `nn/evaluator.ts` (solo interfaz `NNEvaluator`+`RawEval`), `search/mcts.ts` (`createSearch` mapea GameState→create args con defaults deterministas nnRandomize=false/rootSymmetrySamples=1/maxChildren=N²+1). Gate `tests/mcts.test.ts`: 3 tests (favorito más visitado; determinismo; **test 3 = bridge de encoding**, captura el `bin` del root y lo compara vs `fillFeaturesV7NCHW(buildGameState(pos))` en posición con ko real koPoint=10 + historial — verificado no-tautológico por el reviewer). Suite 65/65. Atribución MIT + fila de adaptaciones-upstream.md en el mismo commit. `expandNode`/`selectEdge`/virtual-loss/backup/`getAnalysis` intactos (solo `!` de noUncheckedIndexedAccess). Landmine de suicidio evitado (sin try/playMove/catch nuevo).
  - **Diferido (autorizado por el brief, NO defecto — para tareas posteriores):** simetría `sym!=0`, `reRootToChild` y `analyzeMcts` standalone solo COMPILAN (sin test; se ejercitan en tareas de analyze/genMove); `meta:null` con `// TODO(task-9)`; correctitud real end-to-end del encoder es **Task 10** (`kata-raw-nn`) — el test 3 valida el PUENTE, no `fillFeaturesV7NCHW==KataGo`.
- Task 9: **complete** (impl a4eaf4c [el subagente implementador murió por error de API tras escribir ambos archivos, ANTES de commitear/reportar; el controlador verificó tsc verde + cotejó cada fórmula de índice vs fuentes.md §3 + leyó ambos archivos, y commiteó]; fix de review 8c3c1b9; review spec ✅ + calidad Approved tras 1 Important arreglado). `nn/session.ts` (createOnnxSession URL|ArrayBuffer + resolveInput/OutputNames por introspección, maneja moremiscvalue⊃miscvalue) + `OnnxEvaluator` en `nn/evaluator.ts` (interfaz NNEvaluator/RawEval de Task 8 INTACTA). Split `policy[b,numHeads,área+1]` head-0 (numHeads del tensor real, no hardcodeado) + guard de forma; `scoreValue=miscvalue[b,0..3]` CRUDO; `value`[b,3]/`ownership`[b,1,H,W] directos; fetches explícitos (§0); decode fp16 por-output vía `type`; dtype de inputMetadata; sesión por-instancia + dispose(). Gate: tsc verde (sin test propio, por diseño; behavioral → Task 10). **Important arreglado:** `wasmPaths` era `/ort-dist/` incondicional → override en createOnnxSession/OnnxEvaluator.create para ORT-en-Node (Task 10 debe pasar la ruta Node).
- Task 10: **complete** (impl `965d4a8`; fix review `3104b97`; review spec ✅ + calidad Approved tras 1 Important arreglado). `tests/nn.reference.test.ts` (aislado vía `vitest.nn.config.ts` + exclude en `vitest.config.ts`; script `test:nn`). Pipeline real end-to-end: buildGameState→fillFeaturesV7NCHW→OnnxEvaluator fp32/wasm en Node→postprocessKataGoV8, vs los 10 fixtures. **El controlador des-riesgó con un spike** (pipeline corrido sobre los 10) ANTES de escribir el brief: (1) encoding CONFIRMADO correcto — empty-19 reproduce whiteWin 0.630 (NO 0.557); (2) corrigió un BUG del plan en la perspectiva (`whiteWin=1-blackWinProb-blackNoResultProb`, sin ramificar por turno; `whiteLead=-blackScoreLead`); (3) orientación resuelta `gtpToVertex y=N-rank` (Q16→idx72, C4→idx287, argmax asimétricos exactos); (4) fixture policy = PROBABILIDADES post-softmax vs raw.policy = LOGITS → softmax conjunto tablero+pase; (5) tolerancias MEDIDAS por régimen (japonés más laxo por divergencia de value crudo territorial wasm-fp32 vs metal, respaldado por evidencia, NO papering-over). Deuda de cobertura de Task 9 cubierta (forma/finitud/determinismo del OnnxEvaluator). **Important arreglado (3104b97):** la aserción passProb era vacía (softmax solo-tablero → Σ=1 → passProb≈0 sin tocar raw.policyPass); ahora softmax conjunto → passProb deriva del logit real (único punto de la suite que valida esa salida). test:nn 10/10, suite 65/65, tsc 0. No adapta terceros → sin entrada en adaptaciones-upstream.md.
- Task 11: **complete** (impl `f5e14ed`; review spec ✅ + calidad Approved, sin Critical/Important). `src/humansl.ts` (100% tengen): `rankTemperature` (interpolación lineal sobre índice de HUMAN_RANKS, 0.85→0.30, v1 calibrable por fuentes §5) + `sampleHumanMove` (softmax(policy/temp) sobre casillas legales = vacías && ≠koPoint; muestreo por CDF con `rng`, guarda contra rng→1.0; ignora `policyPass` por `humanSLChosenMoveIgnorePass`; pass solo si no hay candidatas; devuelve `{color: currentPlayer, vertex}`). 5 tests (monotonía temp, temp-baja→máximo, no-pasa/ignora policyPass, determinismo por seed con policy no-degenerada, tablero-lleno→pasa). Reviewer verificó a mano que el test temp→máximo NO es flaky (CDF≈0.9999999999999 en el máximo, mulberry32(1) primer draw≈0.627). Suite 70/70, tsc 0. NO ejecuta ONNX (solo muestreo con policy sintética) — la ejecución de la red humana con meta_input se integra en Task 12.
- Task 12: **complete** (impl `46e2bb9`; review spec ✅ + calidad Approved, sin Critical/Important). `LocalEngine implements Engine` en `src/engine.ts` — ensambla Tasks 5–11 SIN reimplementar: `init` (setBoardSize + evaluatorFactory), `genMove` kata (createSearch→run{shouldAbort}→getAnalysis→moves[order===0]) / human (fillFeaturesV7NCHW+fillMetaV1→evaluate{batch:1}→sampleHumanMove con `raw.policyPass[0]`, guarda `hasMeta`), `analyze` (IIFE async con chunks de 32 visitas, `CancelFn` síncrona, try/catch para no dejar promesa flotante), `stop` (flag único `this.cancelled` leído por `shouldAbort`). Helper `mapAnalysis` mapea perspectiva de Negro DIRECTO (winRate/scoreLead; NO usa *Lost); `ownership` omitido (ownershipMode:'none'). `gtpToVertex` exportado (inverso de moveToGtp, salto de 'I' verificado por el reviewer contra el fuente). `mulberry32` promovido a `src/rng.ts` (re-exportado desde testutil/rng.ts). 7 tests nuevos (2 del plan verbatim + rama humana con determinismo por seed + no-meta lanza + `stop()` corta analyze + gtpToVertex H/J). Suite 77/77, tsc 0. **`defaultEvaluatorFactory` = decisión del controlador sobre punto sub-especificado del plan** (mapea NetworkId→'/models/*.onnx', ep:'webgpu'; NO ejercitada en la suite; el Worker de Task 13 inyecta su propia factory OPFS/ArrayBuffer) — reviewer la juzgó Minor/aceptable. NO adapta terceros → sin entrada en adaptaciones-upstream.md.
- Task 13: **complete** (impl `9502f7c`; review spec ✅ + calidad Approved, sin Critical/Important). Web Worker: `src/worker/protocol.ts` (unión discriminada WorkerRequest/WorkerResponse + `encodeRequest`/`decodeResponse` que ESTRECHAN y lanzan en type desconocido + `transferablesOf` que extrae `ownership.buffer`), `src/worker/engine.worker.ts` (`createWorkerHandler(engine, post)` PURO y testeable: cola serial `queue=queue.then(task)` + streaming de analyze + **bypass de `stop` FUERA de la cola** [verificado por el reviewer: sin él, deadlock — `stop` encolado tras un analyze que solo termina al cancelarse]; entrada de browser bajo guarda `typeof self!=='undefined' && document===undefined`), `src/worker/client.ts` (`WorkerEngine implements Engine` + supertipo estructural `WorkerLike`, `Map` de pending/analyzers por `id` monotónico sin fugas), `engine-smoke.html`+`smoke-main.ts` (verificación MANUAL en Chrome, NO automatizada). **Extensión autorizada de `LocalEngine.analyze` en `src/engine.ts`:** 4º param opcional `hooks?:{onDone?;onError?}` (retrocompat verificado: interfaz `Engine` sigue 3-arg, tsc 0, tests de Task 12 intactos); `onDone`→`{analysis,final:true}` SOLO en completado natural, cancelación NO emite mensaje; `onError`→`{type:'error'}`. `index.ts` exporta `WorkerEngine`. NO tocó `vite.config.ts` (HTML de raíz auto-servidos como bench.html; verificado en dev). Tests: `protocol.test.ts` (7, con aserciones reales — corregido el `.toBeDefined` sin paréntesis del plan) + `worker.test.ts` (4, canal MOCK round-trip init→genMove kata + analyze streaming + `stop` corta en vuelo, sin ONNX/Worker real). Suite 88/88, tsc 0. La factory por defecto `/models/*.onnx` queda JUSTIFICADA (la smoke page la ejercita → ya no es código muerto). 100% tengen → sin entrada en adaptaciones-upstream.md.
- Task 14: **complete** (verificación, sin commit — el árbol quedó limpio; Tasks 12/13 ya committearon todos los exports de `index.ts`: types, LocalEngine, WorkerEngine, WorkerLike, WorkerRequest/Response). Gates corridos por el controlador el 2026-07-09, TODOS verdes: `tsc --noEmit` 0; `npm test` (todos los workspaces) 88/88 (17 archivos); `test:nn` 10/10 (ORT fp32/wasm real en Node, 9.4s); licencias OK (`grep -rL "web-katrain" src/vendor/web-katrain/` vacío, sin refs a Kaya/AGPL); `src/bench/` solo cambió por el movimiento de `f16.ts`→`src/f16.ts` (Task 2, esperado). **Pendiente MANUAL de Edgar (headless no puede driver WebGPU):** `npm run bench` arranca en Chrome (no-regresión de fase 0) + abrir `engine-smoke.html` en Chrome (init+genMove con WebGPU+modelo real, valida la ruta Worker-real que ningún test automatizado cubre). El commit `chore(engine): cierre` del plan es un no-op (nada que capturar) → omitido a propósito.

## FASE ENGINE COMPLETA — PR ABIERTO. Tasks 0–14 cerradas + review final de rama (Ready to merge) + `finishing-a-development-branch`.
**CIERRE (2026-07-09):** repo GitHub creado `edgargomero/tengen` (PÚBLICO, decisión de Edgar; `convert-humanv0.py` AGPL se conserva público, etiquetado). Empujados `main` (base @53f72f0) y `fase-engine`. **PR #1 abierto: https://github.com/edgargomero/tengen/pull/1** (`fase-engine → main`, 29 commits). Rama viva para iterar. **Falta para mergear:** (1) gates MANUALES de Edgar en Chrome — `npm run bench` (no-regresión fase 0) + `engine-smoke.html` (Worker real + ONNX + WebGPU); (2) triaje/fix opcional de la deuda pre-apps-wiring (M-1..M-4 + Task 13a) documentada arriba. Cuando Edgar valide → mergear el PR (fast-forward posible, main sin divergencia).

## (histórico) PRÓXIMA ACCIÓN — Task 14 (cierre: typecheck, suite, no-regresión) + review final de rama. HEAD actual = `9502f7c`. Árbol LIMPIO. Tasks 0–13 completas.
**ESTADO:** Task 13 CERRADA. Motor completo de punta a punta: `LocalEngine` + `WorkerEngine` implementan `Engine`. Suite 88/88, tsc 0. Task 14 es VERIFICACIÓN (el controlador corre los gates directamente, sin subagente de implementación ni review por-tarea): `tsc --noEmit` 0, `npm test` verde en todos los workspaces, `test:nn` 10/10 (requiere modelos ONNX descargados en packages/engine/models/), `git diff --stat` no toca `src/bench/` salvo el import de f16, check de licencias (`grep -rL "web-katrain" src/vendor/web-katrain/` vacío). Bench (Chrome/WebGPU) y smoke page = verificación MANUAL de Edgar (headless no puede driver WebGPU). Tras Task 14 → review final de rama completa (`review-package $(git merge-base main HEAD) HEAD` + code-reviewer opus), triaje de Minors del ledger, y `superpowers:finishing-a-development-branch`.

**Task 13 — Web Worker (protocolo tipado + `WorkerEngine` + smoke):** ver plan `docs/superpowers/plans/2026-07-09-fase-engine.md` Task 13 (línea ~1137) y brief `.superpowers/sdd/task-13-brief.md`. Envuelve `LocalEngine` en un Web Worker: `src/worker/protocol.ts` (WorkerRequest/WorkerResponse tipados + `encodeRequest`/`decodeResponse`/`transferablesOf`, ids de correlación, Transferables del ownership), `src/worker/engine.worker.ts` (hospeda `LocalEngine`, cola serial `queue=queue.then(handle)` por el scratch no-reentrante, streamea updates de analyze), `src/worker/client.ts` (`WorkerEngine implements Engine`, `Map<id,{resolve,reject}>` + onUpdate por id, `analyze` devuelve CancelFn que postea `stop`), `engine-smoke.html` (smoke manual en Chrome), `index.ts` exporta `WorkerEngine`, `vite.config.ts` sirve la smoke page. Test `tests/protocol.test.ts` (serialización pura, sin Worker real). **Carry-forward de Task 12 (a atender aquí):** el `analyze` de LocalEngine traga errores en su IIFE — el Worker DEBE convertir ese fallo en un mensaje `'error'` (no dejar el silencio). Modelo: sonnet/opus según pida el protocolo. Antes de despachar: leer plan Task 13 + verificar firma pública de `LocalEngine`/`Analysis`/`Move` en `src/engine.ts`+`src/types.ts`, decidir el gate del smoke test (worker_threads de Node vs mock del canal).

**Datos de katago (medidos por el controlador, para re-gen de fixtures):** invocación validada `katago gtp -config /opt/homebrew/share/katago/configs/gtp_example.cfg -model <abs>/packages/engine/models/katago-bin/b18c384nbt.bin.gz -override-config numSearchThreads=1,logToStderr=false`. Formato real de `kata-raw-nn 0` y ancla de sanity: documentados en `.superpowers/sdd/task-0-brief.md`. **Spike funcionante de Task 10** (pipeline ORT-en-Node completo) guardado en el scratchpad de la sesión: `spike_t10_funcionante.ts`.

## REVIEW FINAL DE RAMA — HECHO (2026-07-09, opus, `review-package 53f72f0..9502f7c`, 29 commits/555KB)
**Veredicto: Ready to merge: YES.** Cero Critical, cero Important. Verificó las costuras cross-cutting (perspectiva siempre-Negro en `mapAnalysis`; `LocalEngine`/`WorkerEngine` intercambiables; `run()` con `visits` cumulativo sobre `rootNode.visits` persistente; bypass de `stop` fuera de la cola serial + `resolveActiveAnalyze`; limpieza de promesas/recursos en el cliente; type-safety en las junturas) — todas sostienen. Licencias completas (6 vendor/ con cabecera MIT + THIRD-PARTY-LICENSES enumera los 6 + el fork NCHW; sin derivación AGPL/Kaya; los únicos hits "kaya" son URLs de pesos en bench/registry.ts, fuera del diff). Triaje: TODOS los Minors del ledger confirmados Minor (incl. Task 13a queue-wedge → Minor, "fix antes de cablear apps/web"; 13b zombie → folded en M-1). Ningún issue es alcanzable en el artefacto entregado (aún sin consumidor).

**Nuevos Minor del review final (deuda pre-apps-wiring, NO bloquean merge):**
- **M-1 [cancelación global]:** todo el motor comparte un flag `this.cancelled`; el `stop` del Worker ignora `req.id` (global). Consecuencias (benignas hoy, JS mono-hilo, emits de id descartado ignorados): cualquier `CancelFn`/`stop()` aborta TODA búsqueda en vuelo; una `CancelFn` stale de un `analyze` ya terminado, invocada durante un `genMove` vivo (p.ej. cleanup de efecto React), aborta ese genMove (resuelve, pero con jugada legal poco buscada); raíz común de la revival zombie 13b. Fix para apps/web: un Worker por rol, o cancelación por-`id` con settle-signal. Mantener el modelo de flag único fuera de cualquier path que interleave operaciones sobre una instancia.
- **M-2 [analyze sin canal de error]:** `Engine.analyze` devuelve `CancelFn` y no tiene canal de error. Vía Worker, `onError` postea `{type:'error'}` pero el `onMessage` del cliente no halla `pending` para un id de analyze → `analyzers.delete(id)` en silencio. Un analyze que falla (init malo, boardSize mismatch, fallo ONNX) da 0 updates y ninguna señal → una UI giraría para siempre. Limitación de DISEÑO de interfaz, no defecto de código; apps/web debe decidir cómo analyze expone fallo (añadir `onError`/status a la interfaz, o timeout).
- **M-3 [rama fp16 del OnnxEvaluator sin cobertura automatizada]:** los modelos de producción son fp16 pero `test:nn` corre fp32/wasm en Node → la rama fp16 (detección de dtype, feeds `f32ToF16`, decode `f16ToF32` por-output) solo la ejercita el smoke manual. Las funciones de conversión puras SÍ están unit-tested (f16.test.ts); el riesgo residual es solo el WIRING (qué output se decodifica con qué dtype). Baja probabilidad, alto impacto. Recomendado (no bloqueante): un unit en Node contra un ONNX fp16 pequeño, o registrar el smoke manual como el gate fp16 explícito.
- **M-4 [handicap: throw latente]:** `placeHandicap` (gameState.ts) lanza para `handicap>1` en tableros ≠19×19, y el throw ocurre en tiempo de `genMove`/`analyze` (dentro de `buildGameState`), no en `init`. Orientación de handicap y compensación de komi sin validar (Task 10 usa handicap 0). Limitación v1 aceptable; considerar validar `handicap` en `init` para fallar temprano.

**Hardening barato que se puede batchear (del review final, opcional):** `assert(state.boardSize === BOARD_SIZE)` en el encoder (Task 8a); `setBoardSize(N)` defensivo en `fillFeaturesV7NCHW` (Task 5); test de exclusión de ko (Task 11a); validar `handicap` en `init` (M-4); clamp `visits>=1` en el borde de `analyze` (Task 13a).

**Gates MANUALES que quedan como precondición de merge (ningún test automatizado los cubre — headless no puede WebGPU):** `npm run bench` (no-regresión fase 0 en Chrome) + abrir `engine-smoke.html` (init+genMove con Worker real + ONNX real + WebGPU).

## Findings Minor acumulados (para el review final de rama) — TRIADOS ARRIBA (todos confirmados Minor)
- Task 3: dependencia del test en el string literal `'Illegal suicide move'` de vendored (mitigado con nota de re-sync en adaptaciones-upstream.md).
- Task 5: paths no-cero sin test diferencial (plano 6 ko, plano 5 3-libs, path de pase + globals 0-4/14 + `conservativePassAndIsRoot`) — byte-idénticos al oráculo por inspección; una posición con pase + una con ko lo cerrarían. Footgun: `fillFeaturesV7NCHW` depende de `setBoardSize(N)` externo (garantizado por buildGameState; un `setBoardSize(N)` defensivo al inicio lo quitaría).
- Task 6: (a) loop de fecha en metaV1.ts se parece estructuralmente al de sgfmetadata.py (AGPL) — el reviewer lo juzga OK (fórmula sin margen de expresión alternativa); una línea en la cabecera afirmando independencia reforzaría la postura. (b) fixtures JSON sin newline final (cosmético). (c) fórmulas de time-control (82-85) omiten los caps de sgfmetadata.py — sin efecto para el perfil fijo preaz_ (valores dentro de caps), pero re-añadir caps si se generaliza fillMetaV1 a tiempos del llamador.
- Task 0: (a) contrato del fixture: policy ilegal = `null` (JSON no soporta NaN) → `Array<number|null>`, NO el `number[]` con NaN del brief; Task 10 mapea `null`→NaN al leer (load-bearing, no es defecto). (b) `gen-reference.mjs` hardcodea la ruta de `gtp_example.cfg` a Homebrew/macOS (override `KATAGO_GTP_CONFIG`) — aceptable por ser herramienta local, no CI/producto. (c) el caso `seki` no es reconocido como seki por `final_status_list` de katago (heurístico OOD) pero es seki correcto por reglas — no afecta el output crudo de `kata-raw-nn` que es lo que se compara. (d) [review Task 0] `setup-katago.sh` `dl()` no re-valida bytes POST-descarga (a diferencia de `download-models.sh`); `curl -fL`+`set -e` ya corta transferencias truncadas, gap residual = respuesta 200 con contenido de tamaño equivocado (portal cautivo/redirect) → fallo opaco de carga de modelo. Plan-mandated (copiado del brief Step 1), bajo riesgo por ser tooling local no ejecutado en este task. (e) [review Task 0] `ladder-works.json`/`ladder-fails.json` ambos dan `whiteWin≈1.0` — el valor crudo NN no discrimina las dos posiciones (blind spot conocido de la red sin búsqueda en escaleras largas). NOTA para Task 10: NO usar el delta de `whiteWin` entre esos fixtures como diferenciador; comparar planos de input/policy codificados. (f) [review Task 0, ⚠️] el determinismo commiteado en `gen-reference.mjs` re-corre empty-19 DENTRO del mismo proceso katago (intra-proceso), no cross-process; el controlador midió bit-exactness cross-run en pre-flight pero el script solo re-establece intra-proceso. Si Task 10 ve drift de fixtures en un `npm run gen-reference` fresco, re-verificar determinismo cross-process antes de asumir que están stale.
- Task 9: (a) duplicación del patrón `configureOrt`/tipos `MinimalGpu*`/`declare global Navigator` entre `nn/session.ts` y `bench/runner.ts` (autorizado por el brief — runner.ts fuera de scope); unificar cuando se toque runner.ts, riesgo de divergencia de `numThreads`/adapter. (b) aliasing fp32: `value`/`ownership` se devuelven como buffer del tensor ORT sin copia (fp16 sí copia) — reviewer verificó en analyzeMcts que el consumo es síncrono y los campos retenidos se copian, así que es cosmético; documentar si algún caller futuro retiene el RawEval a través del siguiente evaluate(). (c) [ya arreglado en 8c3c1b9: guard de forma de policy + wasmPaths override].
- Task 8: (a) `analyzeMcts.ts` ~L1323 — `createSearch`/`evaluateBatch` fijan `GameState.boardSize = BOARD_SIZE` (global de fastBoard) confiando en que el caller corrió `setBoardSize(state.boardSize)` sin guarda; autorizado por "un Worker por tamaño" (decisiones §5), pero un `assert(state.boardSize === BOARD_SIZE)` barato lo endurecería para la fase Worker (Task 13). (b) comentario obsoleto `// len 361` en `NeuralEval.policy` (~L1280): es `subarray` de `BOARD_AREA` (81 en 9×9), heredado de upstream — cosmético. (c) perf: puente asigna `GameState`+mapas por elemento del batch en el hot loop (`// TODO(perf): reutilizar scratch`) — correcto para el gate, optimizar si el perfilado del Worker lo pide. (d) campos vestigiales de `EvalState` (`prevKoPoint`/`prevLibertyMap`) y `meta:null` con `// TODO(task-9)` — sin impacto, se resuelven en Task 9.
- Task 11: (a) la rama de exclusión de ko (`i !== state.koPoint`, humansl.ts:70) no tiene test dedicado aislado (los 5 tests no la ejercitan directamente); un 6º test con `state.koPoint` en una casilla vacía verificando que nunca se elige lo cerraría (barato). (b) `humansl.ts:84` usa `Float64Array` para los pesos normalizados aunque el contrato público es `Float32Array` — decisión de precisión razonable para la CDF, no defecto; merece un comentario de una línea.
- Task 13: (a) [Minor] `analyze` con `visits <= 0` CUELGA la cola del Worker permanentemente: el `while (target < opts.visits)` nunca corre → `last` queda `undefined` → ni `onDone` ni `onError` disparan → la promesa de `handleAnalyze` nunca resuelve → toda `init`/`genMove`/`analyze` posterior cuelga hasta que llegue un `stop`. Input degenerado (ningún caller realista manda visits≤0; el cliente tampoco lo guarda) → Minor, pero VIOLA el invariante "cada entrada de la cola siempre se resuelve" que sostiene el diseño. Fix barato (3 líneas): garantizar settlement en un `finally` de `analyze` o un settle-path independiente de `onDone` en `handleAnalyze`. Candidato a arreglar en el triaje del review final. (b) [Minor, carrera post-cancelación — nota CORREGIDA por el reviewer respecto al reporte del implementer] SIN impacto de correctitud ni memoria (fp16 copia el input síncronamente antes del `await session.run`; `expandScratch` se consume en una llamada síncrona; cada búsqueda tiene su propio árbol `MctsSearch`; los emits tardíos se descartan porque la `CancelFn` borró el callback). PERO la caracterización "un onUpdate tardío / session.run breve" es demasiado suave: como `genMove`/`analyze` resetean `cancelled=false` al entrar, una secuencia `analyze→stop→genMove` inmediata REVIVE el analyze cancelado, que corre hasta su target COMPLETO de `visits` como búsqueda zombie, contendiendo por la única sesión ONNX y degradando toda búsqueda concurrente hasta autoterminar. Secuencia realista (analiza → juega → stop+genMove). Carry-forward ACEPTABLE para Task 13 (el brief fijó el contrato de 2 hooks sin settle-signal); acción para `apps/web`: dimensionar mitigación (un Worker por rol, o esperar un settle-signal) con esta forma correcta, NO la suave. (c) [nit] `createWorkerHandler` recibe `engine: LocalEngine` (no `Engine`) porque los hooks `onDone`/`onError` viven en la clase concreta, no en la interfaz (dejada intacta a propósito) — desviación-con-razón, en pie de igualdad con `WorkerLike`. (d) [nit] en completado natural el mismo objeto `Analysis` se emite en `final:false` (último onUpdate) y `final:true` (onDone) — benigno hoy (`transferablesOf`=[] porque ownership siempre undefined); si se habilita ownership, transferir el MISMO buffer en ambos mensajes lo doble-detacharía (`DataCloneError`) — comentar cuando llegue ownership.
- Task 12: (a) `engine.ts:97-105` `defaultEvaluatorFactory` — `b10: ''` es un placeholder nunca leído (el guard `if(net==='b10')throw` precede al lookup); más limpio dropear `b10` del record o usar `Record<NetworkId, string|null>`. Es la factory especulativa marcada por el controlador (código muerto, no ejercitada); Task 13/apps la reemplazan con la factory OPFS/ArrayBuffer real — reconsiderar si sigue justificada al cablear el Worker. (b) `engine.ts:178-201` `analyze` traga TODOS los errores dentro del IIFE (por diseño del brief: init-no-llamado o boardSize-mismatch producen 0 updates sin señal, a diferencia de `genMove` que rechaza la promesa) — aceptable aquí porque el Worker de Task 13 convierte el fallo en mensaje `'error'`; asegurarse de que Task 13 efectivamente propague ese error (no dejar el silencio como carry-forward accidental).
- Task 10: (a) el snippet del brief `req.resolve('onnxruntime-web/package.json')` LANZA `ERR_PACKAGE_PATH_NOT_EXPORTED` en ORT 1.24.3 (el `exports` map no expone `./package.json`); el impl lo resolvió con `dirname(req.resolve('onnxruntime-web'))+'/'` (verificado: apunta al `dist/` con los `.wasm`). NO copiar el snippet roto al runbook de adaptación. (b) la banda de tolerancia laxa (japonés) solo la NECESITA realmente `opening-34`; `empty-13`/`endgame` (también japoneses) pasan con la tolerancia china estricta — si se añaden más fixtures japoneses, revisar si la banda sigue justificada. (c) bias ~1e-5 en `maxProbDiff` del tablero por la normalización conjunta con el pase (inmaterial, dentro de 0.06) — cosmético.

---

# Ledger Fase 0 — plan docs/superpowers/plans/2026-07-10-fase-0-scaffold-web.md

Rama: `main` (Edgar autorizó trabajar en main directamente). Estrategia: subagent-driven-development.
Base de la fase: commit del plan (ver `git log`).

Tasks:
- Task 1: motor — extraer createWorkerHandler a worker/handler.ts + exports para apps/web. (pendiente)
- Task 2: scaffold apps/web (Preact+Vite+TS) + middlewares serve-models/serve-ort-dist. (pendiente)
- Task 3: worker propio de apps/web + factory trivial. (pendiente)
- Task 4: gate WebGPU + smoke init/genMove en UI. (pendiente)

Gate manual pendiente de Edgar (headless no puede WebGPU): `npm run dev -w @tengen/web` → "Correr smoke".

Task 1: complete (commit 7206643, review clean — spec ✅, sin issues)
Task 2: complete (commit 2cff7a4, review Approved — 1 Minor: orden del npm install en el brief, corregido en el plan)
Task 3: complete (commit 315c532, review Approved — 1 Minor: MODEL_FILES duplica el mapa de defaultEvaluatorFactory, candidato a fuente única en Fase 1). Nota: agente implementer murió por API error tras commitear; reporte reconstruido + verificado por el controller (tsc 0, build 0).
Task 4: complete (commit 64efad3, review Approved — 0 issues; concern del wasm 26.8MB en dist/ clasificado informativo/diferido a Fase 4/6, atribuible a la cadena de import de Task 3, no defecto de Task 4).

## Fase 0 COMPLETA (Tasks 1–4 aprobadas). Pendiente: review final whole-branch + gate manual WebGPU de Edgar.

## CIERRE Fase 0 (roadmap app) — 2026-07-10
- Review final whole-branch: **SALTADO por decisión de Edgar** (opción b: cierra él con el smoke manual). Cada tarea ya pasó su review por-tarea (todas Approved, 0 Critical/Important).
- Gates auto-verificables RE-CORRIDOS por el controller en HEAD `64efad3`, todos verdes:
  motor `tsc` 0 · unit **88/88** · `test:nn` **10/10** · apps/web `tsc` 0 · `vite build` exit 0 (27 módulos). Working tree limpio.
- Commits de la fase: `6939b0e`(plan) `7206643`(motor) `2cff7a4`(scaffold) `315c532`(worker+factory) `5875843`(fix plan) `64efad3`(gate+smoke).
- **PENDIENTE (gate manual de Edgar, headless no puede WebGPU):** `npm run dev -w @tengen/web` → botón "Correr smoke" en Chrome/Edge → esperar `jugada:{...}` + `OK ✓`.
- Follow-ups anotados (NO bloquean Fase 0):
  1. Fase 1: unificar el mapa de nombres de red (appFactory.ts vs defaultEvaluatorFactory) en una fuente única; y ES el objeto de la fase (OPFS+R2).
  2. Fase 2: el chunk del hilo principal pesa 423 KB (gzip 118) porque el barrel arrastra LocalEngine+MCTS+ORT al importar WorkerEngine. Considerar subpath export o `"sideEffects": false` en @tengen/engine para tree-shaking, o importar WorkerEngine/tipos por un subpath sin ORT.
  3. Fase 4/6: `vite build` emite el .wasm de ORT (~26.8 MB) a dist/ (dead-weight en prod; en runtime carga de /ort-dist/) — resolver al configurar el serving de ORT en producción.

## Gate manual WebGPU — CORRIÓ (2026-07-10)
- Smoke ejecutado en Chrome real con WebGPU (adapter Apple metal-3, crossOriginIsolated=true). Log:
  `init b18 en 9×9…` → `genMove kata (100 visitas)…` → `jugada: {"color":"black","vertex":{"x":0,"y":0}}` → `OK ✓`.
- WIRING end-to-end VERIFICADO (Worker + OnnxEvaluator WebGPU + MCTS → jugada + OK, sin error). Fase 0 gate cumplido.
- **CAVEAT ABIERTO (posible bug de la ruta de inferencia WebGPU/fp16):** la jugada devuelta es 1-1 (esquina exacta), implausible como mejor jugada de b18 en 9×9 vacío. La ruta `ep:'webgpu'` NO está cubierta por `test:nn` (que corre en Node `ep:'wasm'`). Investigar antes de Fase 2: comparar la salida del evaluador WebGPU vs wasm/reference para la misma posición vacía, y/o subir visitas para ver si converge a una jugada sensata. Podría ser (a) discrepancia de layout de salida del EP WebGPU, (b) precisión fp16 en WebGPU, o (c) benigno. NO confirmado como bug aún.

## DIAGNÓSTICO jugada 1-1 — CONFIRMADO: bug del modelo fp16 (NO WebGPU, NO MCTS) (2026-07-10)
Matriz (tablero vacío 9x9, b18, kata 100 visitas; genMove completo):
- WebGPU + fp16 => {x:0,y:0} esquina (el smoke original). WebGPU + fp32 => {x:3,y:5} central OK.
- wasm  + fp16 => {x:0,y:0} esquina; RAW policy = TODA NaN. wasm + fp32 => {x:3,y:5} central OK; RAW top central (D4/F6/D6/F4/E5).
Referencia KataGo desktop (empty-9.json): mejor jugada E5 {x:4,y:4} 47.5%; esquina {0,0} 0.005%.
CAUSA: el ONNX **fp16** (b18c384nbt-kata1.fp16.onnx) produce policy NaN en AMBOS EP (wasm y WebGPU). Con NaN el argmax degenera al índice 0 = esquina {0,0}. El pipeline del motor es correcto (WebGPU+fp32 == wasm+fp32 == {3,5}). `test:nn` (10/10) NO cubre fp16 (usa b18c384nbt-kata1.fp32.onnx) → nunca lo pilló.
IMPACTO: choca con CLAUDE.md "Formato a servir: fp16". Probable misma falla en humanv0.fp16 (misma pipeline de conversión) — sin verificar aún. Investigación reproducible (temp files borrados): correr genMove/raw-eval con OnnxEvaluator sobre el .fp16 en Node ep:'wasm'.
DECISIÓN PENDIENTE DE EDGAR: (a) diagnosticar por qué el fp16 da NaN (overflow fp16 en el trunk vs bug de conversión katago-onnx) y arreglar la conversión, o (b) servir fp32 (2x peso: b18 115MB, y actualizar la decisión de CLAUDE.md), o (c) mixto. appFactory revertida a fp16 (estado committeado); la app NO juega bien hasta resolver esto.

## RESOLUCIÓN fp16→fp32 (decisión de Edgar: "servir fp32 ya") — 2026-07-10
- appFactory: b18 → b18c384nbt-kata1.fp32.onnx. CLAUDE.md: "Formato a servir" revocado a fp32 con la corrección del bug fp16.
- VERIFICADO en Chrome WebGPU real (estado committeado): smoke b18 fp32 => jugada {x:3,y:5} central + OK ✓. apps/web tsc 0 + build 0.
- Commit del fix + doc. Fase 0 ahora juega bien (KataGo/b18).
- PENDIENTE Human SL: NO existe b18c384nbt-humanv0.fp32.onnx (solo fp16, presuntamente NaN igual). appFactory deja humanv0→fp16 con comentario ⚠️. Human SL no jugará bien hasta generar su fp32 con la tooling de conversión (~/dev/vendor/katago-onnx + convert-humanv0.py AGPL, desde models/katago-bin/humanv0.bin.gz). Tarea aparte, pendiente de greenlight de Edgar. (Nota: el smoke de Fase 0 usa b18/kata, no humanv0 — Fase 0 no bloqueada por esto.)

## Human SL (humanv0) fp32 — RESUELTO (2026-07-10)
- Descubrimiento: convert-humanv0.py YA genera el fp32 como intermediate; existía en ~/dev/vendor/katago-onnx/artifacts/b18c384nbt-humanv0.fp32.onnx (108 MB). Copiado a packages/engine/models/ (gitignored). Sin re-conversión.
- Verificado (Node wasm): humanv0 fp16 RAW policy = NaN → genMove human(5k) => {8,8} esquina (roto igual que kata1); humanv0 fp32 RAW top = E5 {4,4} 4.12 (central) → genMove human(5k) => {4,4} tengen (correcto).
- Verificado (Chrome WebGPU real, ruta meta_input[192] que nunca se había ejercitado en WebGPU): smoke humanv0/human(5k) => {x:4,y:4} tengen + OK ✓. Coincide con wasm.
- appFactory: humanv0 → b18c384nbt-humanv0.fp32.onnx. CLAUDE.md actualizado. Commit del fix. apps/web tsc 0 + build 0. main.tsx revertido al smoke b18 (exacto).
- AMBAS redes del producto (b18 kata + humanv0 Human SL) ahora fp32 y verificadas end-to-end en WebGPU. Fase 0 juega bien con las dos.

---

# Fase 1 — Entrega de modelos (OPFS cache + descarga con progreso)

Plan: `docs/superpowers/plans/2026-07-10-fase1-modelos.md`. Roadmap v1: `docs/superpowers/plans/2026-07-10-tengen-v1-roadmap.md`. Estrategia: subagent-driven-development sobre **main** (Edgar autorizó). **BASE de Fase 1 = `7d67224`** (commit de docs; el diff whole-branch de la review final va `7d67224..HEAD`).

Decisión de arquitectura central (validada con advisor): descomposición **sink-based** — el loop getReader()+progreso+validación+orquestación del marcador viven en `ensureModel` (modelCache.ts, Node-testeable); `modelStore.ts` es sink delgado OPFS; `markComplete` separado de `close()`, llamado solo tras validar bytes. Esto hace que el test de ruta de fallo en Node sea significativo (no un test-de-mock). Interfaz autoritativa en el plan §"Contratos e interfaces AUTORITATIVAS".

## Tasks Fase 1
- Task 1: complete (commits 7d67224..47a277a, review spec ✅ + Approved, sin issues). netManifest.ts (bytes exactos + requireManifestEntry throw b10), progress.ts (port verbatim MIT web-katrain getContentLength/getProgressPercent + cabecera), apps/web/THIRD-PARTY-LICENSES nuevo, fila en adaptaciones-upstream.md, vitest infra (npm test -w @tengen/web = 15/15). BASE Task 2 = 47a277a.
- Task 2: complete (commits 47a277a..ce4a2b5, review spec ✅ + Approved). ensureModel (8 pasos verbatim: marcador solo tras close()+validación; abort en fallo/mismatch; valida contra entry.bytes no total). Interfaz ModelStore/WritableSink (createOpfsModelStore ausente → Task 3). Tests Node 24/24 (9 nuevos): fallo-a-mitad pull-based (bytesWritten===2000 → abort, sin markComplete, re-descarga), byte-mismatch ambos sentidos, progreso monotónico, cache short-circuit. Sin materializar 115 MB (sink que cuenta). BASE Task 3 = ce4a2b5.
  - Minor abiertos (para review final, NO bloquean): (1) modelCache.ts:78-80 `await sink.abort()` en el catch puede enmascarar el error original si abort() rechaza → envolver abort en try/catch propio; (2) modelCache.ts:65 `res.body.getReader()` fuera del try → throw ahí dejaría el sink abierto sin close/abort (inalcanzable en la práctica).
- Task 3: complete (commits ce4a2b5..b8bb109, review spec ✅ + Approved, sin Critical/Important). createOpfsModelStore(): openWritable (getFileHandle{create}+createWritable, close=commit/abort=discard, idempotente vía flag `settled` seteado ANTES del await → evita TypeError de doble-close), markComplete (localStorage tengen:model:<name>), isComplete (marcador===String(bytes) Y file.size===bytes, NotFoundError→false, nunca true por mera existencia), readArrayBuffer (OPFS puro, sin localStorage → worker-safe). Verificación: tsc 0 / tests 24/24 / vite build 0 (OPFS sin test Node por diseño → se verifica en browser en Task 4). Cast narrow `Uint8Array<ArrayBuffer>` (TS≥5.7) documentado, sin any. BASE Task 4 = b8bb109.
  - Minor (reviewer: no-change-needed): isComplete propaga errores no-NotFound (lectura literal, safe); readArrayBuffer propaga NotFoundError crudo (el wrap amigable es de Task 4/worker); write() no chequea `settled` (mal-uso teórico, ensureModel serializa ops).
- Task 4: complete (commits b8bb109..e6a7f8a, review spec ✅ + Approved, sin Critical/Important). ModelGate.tsx (Preact: idle→downloading→ready|error+Reintentar; ARIA valuenow condicional; race de red vía flag `stale` por-efecto; `ready` por promesa no por percent → recarga cacheada con 0 onProgress llega a ready). appFactory (worker) lee OPFS via readArrayBuffer+byteLength-check, SIN localStorage/isComplete (landmine cerrado, verificado trazando el call-graph). main.tsx: selector b18/humanv0 + gate + smoke por-red (kata 100 / human 5k), terminate en finally, gate WebGPU intacto. Verificación: tsc 0 / tests 24/24 / vite build 0. Browser (progress→100%, recarga-OPFS-sin-red, integridad) PENDIENTE Chrome/WebGPU real.
  - Minor (para review final): main.tsx:112 `let move` evolving-let (cosmético); ModelGate.tsx:284-288 acoplamiento implícito percent===null ⟺ total===null (un comentario lo endurece).

## Cierre Fase 1 — review final + fix wave
- **Review final whole-branch** (7d67224..e6a7f8a) como Workflow multi-agente (6 dimensiones: corrección/anti-corrupción, runtime-safety, test-quality, simplificación, integración-contratos, seguridad-licencias → verificación adversarial por-hallazgo → síntesis con triage). NOTA de proceso: el 1er intento (wf_6c830890) pasó `args` como string JSON → `args.diffPath` llegó `undefined` a los finders → review vacua (6 findings:[] espurios). Diagnosticado vía journal; re-lanzado (wf_8d4b3cee) con rutas LITERALES embebidas. El 2º corrió correcto (finders leyeron el diff real).
- **Veredicto**: MERGEABLE, mustFixBeforeMerge vacío. 1 CONFIRMED minor (gap de test: faltaba el branch close()-rechaza, la única ruta anti-corrupción sin cobertura — el código ya era correcto) + 1 REFUTED (nit DRY en modelStore, descartado). Defensa en profundidad confirmada: aún si markComplete se llamara tras close() fallido, isComplete devuelve false por el size-check → ONNX truncado nunca se lee como cacheado.
- **Fix wave** (commit `d89a0a2`, sonnet): (1) test del branch close()-rechaza (mock `failClose` → ensureModel rechaza, markComplete vacío, sin entrada, isComplete false, re-fetch); (2) los 2 `await sink.abort()` del failure path envueltos en try/catch propio (un fallo de abort no enmascara el error primario) + `getReader()` movido dentro del try (cierra el leak teórico de sink); (3) `let move: Move` en main.tsx. NO se tocó: settled-guard de write (YAGNI), DRY de modelStore (REFUTED), comentario de ModelGate (ya existía en :7).
- **Verificación final (evidencia primaria, corrida por el controlador):** motor `npm test` 88/88 (17 files) intacto · web `npm test -w @tengen/web` 25/25 · `tsc --noEmit` 0 · `vite build` 0 (32 módulos, worker empaquetado). Server-side: dev sirve ambos ONNX con Content-Length exacto (115800125 / 108040143) y SIN gzip → la barra llega a 100% y la validación received===bytes cuadra.
- **PENDIENTE (gate manual de Edgar, Chrome/WebGPU real — headless no soporta WebGPU, precedente Fase 0):** (1) primera carga: barra→100% + jugada central (b18 {3,5}, humanv0 {4,4}); (2) recarga con Network offline → lee de OPFS sin red; (3) integridad: DevTools→Application→OPFS archivo = bytes exactos del manifest + marcador localStorage `tengen:model:<opfsName>` presente. Comando: `npm run dev -w @tengen/web` → abrir en Chrome.

**Estado Fase 1: COMPLETA en código (4 tasks + fix wave, review final mergeable). Commits en main: 47a277a, ce4a2b5, b8bb109, e6a7f8a, d89a0a2 (+ docs 7d67224). Falta solo el gate manual de browser de Edgar.**

---

# Fase 2 — Modo Jugar

Plan: `docs/superpowers/plans/2026-07-10-fase2-jugar.md`. Estrategia: subagent-driven-development sobre **main** (Edgar autorizó). **BASE de Fase 2 = commit del plan doc** (el diff whole-branch de la review final va BASE..HEAD).

## Hechos verificados antes de despachar (exploración de ejecución)
- `signMap` se indexa `signMap[y][x]` (fila primero). Verificado con go-board real: `makeMove(1,[3,15])` → `signMap[15][3]===1`. Tuplas `[x,y]`, mapa `[y][x]`.
- `getHandicapPlacement(h)` de go-board == `handicapPoints19` del motor (como conjunto) para h=2..9. Sin divergencia display↔motor.
- Handicap NO va en `moves[]`: es `pos.handicap`; con handicap≥2 Blanco mueve primero (buildGameState lo deriva). Invariante cross-Task 1/2.
- `WorkerEngine.analyze` no expone `final` al llamador → el manager resuelve con `analysis.visits>=target` + timeout portante (fallback al último Analysis; reject solo si ninguno).
- `localStorage` ausente en vitest Node → persistence.ts con Storage inyectable.

## Tasks Fase 2
- Task 1: complete (commits c2b0926..83b8405, review spec ✅ + Approved, sin Critical/Important). coords.ts (footgun signMap[y][x] documentado), gameConfig.ts (M-4 lanza handicap>1 fuera de 19; clamp visits>=1; networkForOpponent human→humanv0/kata→b18; handicap 1 normalizado a 0), rules.ts (boardFromMoves/currentTurn/validateMove/applyMove/signMapOf/capturesOf, go-board como oráculo). @sabaki/go-board añadido como dep directa. Reviewer cross-check: turn/handicap byte-consistente con buildGameState del motor; tests ko/suicidio/overwrite/captura/handicap reales. web 66/66 (25 Fase 1 + 41 nuevos), tsc 0. BASE Task 2 = 83b8405.
  - Minor abiertos (para review final, NO bloquean): (1) rules.test.ts drift-guard compara go-board contra constantes hardcodeadas (verificadas correctas hoy) en vez del handicapPoints19 privado del motor — no cazaría drift del motor; cerrarlo requeriría exportar la fn del motor (scope). (2) gameConfig.ts:131-136 opponent compartido por referencia cuando no se clampa (inofensivo, config inmutable por convención). (3) nombre de test cosmético ('reduce libertades' asevera captura+contador).
- Task 2: complete (commits b33d3fc..4f26a85 + fix 17c1aa4, review spec ✅ + Approved, sin Critical/Important). gameTree.ts (árbol mutable-con-cursor; raíz = inicio post-handicap, no jugada; addMove dedup/variación; positionAt deriva Position recorriendo raíz→cursor; handicap solo en meta, nunca en moves). sgf.ts (exportSgf/importSgf sobre @sabaki/sgf con DEFAULT import — named no resuelve en ESM nativo; exporter canónico → export∘import∘export byte-idéntico; AB regenerado desde handicapVertices, nunca almacenado; import HA→handicap ignora AB). persistence.ts (StorageLike inyectable, payload {sgf,cursorPath} bajo tengen:game:v1, cursor como path de índices, loadGame→null en corrupto/vacío). types/sabaki-sgf.d.ts. @sabaki/sgf movido a dependencies. Reviewer opus: idempotencia es byte-equality REAL + tests de recuperación-de-valores separados (handicap 2 → moves=[W,B], moves[0].color==='white', raíz sin B/W, RE recuperado) que pinnan import; consistente con buildGameState. web 102/102 (+36) → 103/103 tras fix. tsc 0. BASE Task 3 = 17c1aa4.
  - FIX aplicado (17c1aa4, sonnet, RED→GREEN): loadGame getItem movido dentro del try → no lanza si storage.getItem falla (SecurityError en modo privado/storage bloqueado). +1 test.
  - Minor abierto (para review final, NO bloquea): sin test para payload JSON-válido-pero-basura en sgf (parsea a árbol default-meta en vez de null; el catch protege de throws, pero la reconstrucción silenciosa no está aseverada).
  - Concern no-bloqueante del implementer: navegación por-id no implementada (solo por path, que es lo correcto — ids se reasignan al reimportar); añadir toNode(id) solo si Task 5 lo necesita (YAGNI).
- Task 3: complete (commits ef43415..c53e66e, review spec ✅ + Approved, sin Critical/Important). engineManager.ts (Node-testeable, SIN Worker/import.meta.url): EngineManager con race-contra-crash (Promise.race([op, live.crash]) por Live; onError setea alive=false + crashReject(WorkerCrashError)), reconcile idempotente (rebuild en cambio de network/boardSize o crash; termina el managed anterior; ready guarda fallo de init), genMove con reintento-único SOLO ante WorkerCrashError (error determinista propaga sin reintentar), analyzeToScore (resuelve en visits>=target; timeout portante → último Analysis o reject si ninguno). init() también en la race (cierra hang-hole de init). workerManagedEngine.ts (browser-only factory: Worker real + WorkerEngine + error→onError; sin test Node). 11 tests (matriz completa) con vi.useFakeTimers para timeouts; mutation-check confirma que los 2 tests de crash ejercen la race real. Reviewer opus verificó los 8 puntos + stderr pristine (sin unhandled rejections). web 114/114 (+11), tsc 0. BASE Task 4 = c53e66e.
  - Minor abiertos (para review final, NO bloquean): (1) reconcile() pre-op en genMove fuera del try puede lanzar WorkerCrashError si el init de un rebuild crashea (bypassa retry-once; se auto-cura en la siguiente llamada); (2) test de resolve-en-target solo ejerce emit síncrono (WorkerEngine real emite async; correcto por inspección); (3) sin test para crash-luego-error-determinista-en-retry (coverage).
- Task 4: complete (commits 66bff3a..2dd5392, review spec ✅ + Approved, sin Critical/Important). endgame.ts (puro: formatResult B+/W+/Draw/W+R/B+R + isGameOverByTwoPasses; TDD). NewGameForm.tsx (tamaño 9/13/19, oponente Human SL rank | KataGo 50/200/500, komi default 7.0 chino/6.5 japonés atado a reglas, handicap gateado M-4 solo 19×19, validateConfig al enviar). PlayView.tsx (ModelGate→EngineManager lifecycle useRef+dispose; bucle humano=Negro/IA=Blanco; handicap≥2 IA abre; pasar/rendirse; fin-2-pases→analyzeToScore(100)→formatResult con try/catch; nav view-only; clics solo en tip+turno humano+no busy). app.css + main.tsx reescrito (gate WebGPU→form→play). @sabaki/shudan→dependencies. Reviewer opus auditó ciclo de vida de efectos: diseño estado-en-ref-mutable elimina stale closures; todo async guardado por staleRef/endedRef; fix resign-durante-genMove correcto y necesario; preact (no compat) evita doble-worker; Shudan empaqueta limpio sin optimizeDeps. web 126/126 (+12 endgame), tsc 0, vite build 0. BASE Task 5 = 2dd5392.
  - PLEGAR EN TASK 5 (Minor #1): busy arranca true → panel muestra "IA pensando…" durante la carga del ONNX aunque el humano mueva primero (engañoso). Fix: estado "Preparando motor…" o gatear "IA pensando" en turn==='white'. Task 5 ya edita PlayView.
  - Minor abiertos (review final, NO bloquean): void finishTurn() traga rechazo (inofensivo hoy); tras fallo de genMove el humano queda varado (solo Rendirse/Nueva partida — Task5 YAGNI); handleResign no limpia scoring (result tiene prioridad visual; inofensivo).
  - GATE DE EDGAR (browser Chrome/WebGPU, sin cobertura auto de UI): (1) rendirse mientras "IA pensando…" → result W+R, spinner para, nav operable ya; (2) latencia de score: 2 pases → analyzeToScore(100) con timeout 30s (a ~2.79 inf/s, 100 visitas rozan el techo) — debe mostrar score o "No se pudo estimar", nunca colgar; (3) primera carga sin handicap: el "IA pensando…" transitorio no debe ser jarring (ver Minor #1); (4) handicap≥2 en 19×19: IA/Blanco abre sola; (5) "Nueva partida" mid-genMove: sin errores de consola, worker terminado; (6) navegar atrás mid-game: ignora clics fuera del tip, Pasar disabled, vuelve jugable en el tip.
- Task 5: **complete** (impl `df9f163`; review spec ✅ + Approved a fondo con opus, 0 Critical / 0 Important, 5 Minors). Cierre del Modo Jugar: `GameTreePanel.tsx` (100% tengen: línea-principal-recta como fila de botones + variaciones indentadas, nodo actual resaltado, clic navega, etiqueta `●/○`+GTP-like), Export/Import SGF (Blob download `tengen-YYYY-MM-DD.sgf` / `<input file>`→`importSgf`→`onImport` bubbléa a `main.tsx`), persistencia con restauración al recargar (`useState(restoreSession)` síncrono, sin parpadeo), modo exploración de variaciones SIN IA, fix Minor #1 de Task 4 (estado `booting`→"Preparando motor…"). web **139/139** (+6 persistence R3 +7 gameTree isAtLiveTip), tsc 0, vite build 0. BASE del review final whole-branch = `d89a0a2` (pre-Fase-2).
  - **Refinamiento load-bearing (advisor-caught durante impl):** la R1 literal del controlador (`children.length===0` como "atTip") tenía un bug — un nodo FRESCO de variación TAMBIÉN es hoja → leaf-detection re-dispararía la IA dentro de la variación en la 2ª jugada (viola Decisión #2). Fix: `GameTree.isAtLiveTip()` compara el cursor vs el tip de `mainLine()` (que sigue estrictamente `children[0]`); las variaciones se appendan vía `appendChild`-push, nunca entran en `mainLine` → el predicado excluye TODO nodo de variación (incl. variación multi-jugada cuya última hoja es leaf). El reviewer opus RE-DERIVÓ la corrección independientemente y la confirmó no-tautológica. Usado consistente por `isExploring()` y el guard de `boot()` (R1).
  - **Contrato de persistencia extendido (R2/R3, TDD RED→GREEN):** payload `{opponent, sgf, cursorPath}` bajo la MISMA clave `tengen:game:v1` (no bumpeada; el guard `isRankLevel` exige opponent válido → payload viejo v1 `{sgf,cursorPath}` cae fuera → `null` limpio, nunca GameConfig medio-formado; `restoreSession` envuelve `validateConfig` en try/clear). Fin de partida se persiste vía `tree.meta.result` (reusa el round-trip `RE` ya testeado de sgf.ts, Task 2); `formatResult` emite solo strings RE-válidos; "No se pudo estimar…" (no RE-válido) NO se escribe en `meta.result`. Restore inicializa `result`/`endedRef` desde `meta.result`. Import/restore/nueva-partida por remonte de `PlayView` vía `sessionKey` key-change en `main.tsx` (dispone el `EngineManager` viejo, crea fresco).
  - Minors abiertos (para review final, NO bloquean): (1) **plan-mandated / R2-autorizado**: partida de 2-pases cuyo `analyzeToScore` FALLA muestra "Partida terminada" en-sesión pero NO se persiste como terminada (sin `meta.result`) → al recargar vuelve a estar viva; benigno (tras 2 pases toca Negro; el guard `white`-only de `boot()` nunca auto-juega la IA); R2 autoriza el trade-off explícitamente. (2) banner "Modo exploración" gated en `result===null` → partida terminada permite clics de variación sin hint en pantalla (cosmético). (3) `URL.revokeObjectURL` síncrono tras `a.click()` (funciona en Chrome único target; patrón robusto difiere el revoke con setTimeout). (4) partida restaurada TERMINADA corre `ensureReady` innecesariamente; `busy` deshabilita el panel (nav/árbol/import) durante esa ventana (UX, flaggeado por el implementer). (5) `handleResign` clickeable durante exploración de posición pasada → rinde toda la partida con cursor en variación (edge, coincide con contrato "resign always available" de Task 4).
  - **Decisión propia del implementer (no en brief, anotada para el gate):** tras importar, adelanta el cursor al tip de la main line (`while toChild(0)`) para mostrar la posición final; esto es la CAUSA de que un import de partida NO-terminada con turno Blanco dispare la IA (coherente con humano=Negro/IA=Blanco + "import comparte el camino de restore"). Decisión de producto para el eyeball de Edgar, NO gap de spec (el brief no pidió modo-revisión).
  - **GATE DE EDGAR (browser Chrome/WebGPU real — R1/R2/R4 son UI-wired, sin cobertura auto):** (1) exploración multi-jugada: navegar atrás, jugar variación de 2+ movimientos alternando color, la IA NUNCA interviene, banner "Modo exploración"; re-jugar la secuencia real → reencuentra la main line → la IA vuelve a responder. (2) Export→Import round-trip: tablero/árbol/turno idénticos. (3) recargar → restaura donde quedó (incl. si toca IA → retoma sola). (4) restaurar partida TERMINADA (resign/2-pases) → "Partida terminada"+resultado de inmediato, sin flash de "Preparando motor…"/"IA pensando…", no revive. (5) import SGF no-terminado turno Blanco → la IA juega (esperado, eyeball de producto). (6) "Preparando motor…" durante la carga, cambia a "IA pensando…" solo en turno Blanco real. (7) panel de árbol legible con variaciones (`.tree-panel` max-height 16rem + scroll).

## CIERRE Fase 2 — COMPLETA en código (Tasks 1–5 + review final + fix wave + pulido). Pendiente: gate manual de browser de Edgar + push a origin/main (con su OK).

### Review final whole-branch (Workflow multi-agente, ultracode, `d89a0a2..HEAD`)
- Workflow `wf_89e9b162-698`: 6 dimensiones (corrección/anti-corrupción, runtime-safety, test-quality, simplificación, integración-contratos, licencias) → **verificación adversarial por-hallazgo** (default: refutar) → síntesis con triage. 20 agentes, 0 errores. La dimensión "licenses" retornó findings:[] — CORRECTO (GameTreePanel.tsx 100% tengen; apps/web USA @sabaki/* como deps npm, no copia código).
- **Veredicto: mergeable=true tras una fix wave.** 10 hallazgos confirmados (tras dedup cross-dimensión → 4 mustFix + 4 deferred + 2 adicionales que el controlador trió a mano).
- **Overturn notable:** la verificación adversarial REFUTÓ la disposición previa del ledger de M5.1 ("benigno, R2 autoriza"): en el orden IA-pasa-primero, una partida terminada por dos pases SÍ revive al recargar (la IA juega tras el fin, o el humano puede clickear) → M5.1 promovido de "diferido" a "arreglar ahora". Lección: un review por-tarea aceptó un razonamiento incompleto; solo el review adversarial independiente lo desmontó.

### Fix wave (commit `7472a49`, sonnet; review de la fix wave por opus: Approved, 0 Critical/0 Important, 2 Minors)
Los 5 defectos del review, todos verificados de primera mano por el controlador contra el código real ANTES de despachar (a pedido de Edgar):
- **FIX 1 [Important]:** import de SGF ilegal (overwrite/ko/suicidio, o HA de colocación libre cuyo hoshi regenerado colisiona) crasheaba TODA la SPA (throw en el render de ReadyPlayView, fuera del try, sin error boundary). Fix: `isMoveSequenceLegal` (rules.ts, pura/no-lanzante) valida la main line DENTRO del try de `handleImportFile` (cursor avanzado al tip ANTES de validar → línea validada == línea renderizada) + `ErrorBoundary` de Preact (getDerivedStateFromError/componentDidCatch) envuelve `<App/>` como red para variaciones ilegales navegadas.
- **FIX 2 [Minor confirmado]:** partida de dos-pases resucitaba al recargar. Fix: `boot()` detecta `isGameOverByTwoPasses` → `endedRef.current=true` (cierra AMBOS paths: el aiTurn por su guard, y el click humano vía isExploring) sin re-correr analyzeToScore; el catch de `finishTurn` persiste `meta.result='Void'` (RE-válido).
- **FIX 3 [Minor]:** pase legacy `tt`/off-board importado como jugada fantasma → `moveFromData(data, boardSize)` trata off-board como pass.
- **FIX 4 [Minor]:** import no persistía → `saveGame` en la secuencia validar→saveGame→onImport.
- **FIX 6 [Minor correctness]:** `importSgf` no normalizaba `HA[1]`→0 → `handicap:1` espurio al motor; normalizado (no rompe el round-trip de Task 2, que nunca emite HA[1]).
- Tests: web 139→150 (+5 `isMoveSequenceLegal` en rules.test.ts, +6 en sgf.test.ts para FIX 3/6), RED→GREEN.

### Pulido del review de la fix wave (commit `e0a1762`, controlador directo — 2 Minors triviales)
- `saveGame` de `handleImportFile` ahora best-effort (try/catch propio, como `persist()`): un fallo de storage (modo privado/quota) en un import VÁLIDO ya no lo aborta con el mensaje engañoso "No se pudo importar el SGF".
- Test Node del round-trip de `meta.result='Void'` + supervivencia de los dos pases (guarda FIX 2). web 150→**151**.

### Deuda DIFERIDA a una fase de robustez posterior (NO va al gate de Edgar — invisible a un eyeball de browser; registrada aquí para no perderla)
- **genMove/analyze no-cancelables (engineManager.ts:146):** un `genMove`/`analyze` en vuelo NO settlea al `dispose()`/reconcile (el Worker terminado no emite 'error'/'move') → la cadena aiTurn→genMove queda pendiente (fuga acotada por acción); y `handleResign` no cancela la búsqueda del motor (cómputo desperdiciado hasta autoterminar). Fix no-trivial: exponer cancelación en EngineManager (error distinto de WorkerCrashError) + rechazar el pending Map + cablear resign. Relacionado con M-1 del review de la fase engine ("un Worker por rol o cancelación por-id").
- **Test de `crash.catch` idle (engineManager.ts:184):** la línea anti-unhandled-rejection ante crash IDLE (sin op en vuelo) no tiene test; borrarla deja los 11 tests verdes y el fallo solo aparece en browser. Añadir 2 tests con la harness `fireError` (idle + init-que-nunca-resuelve).
- Cobertura de la frontera 'Draw' de `formatResult` (banda cercana-a-cero); duplicación del mapeo GameConfig (restoreSession↔handleImportFile) y de la secuencia post-jugada (handleVertexClick↔handlePass) — pulido/refactor.
- Minors del ledger de Tasks 1–4 (M1.1–M4.3) y de Task 5 (M5.2–M5.5): triados como `defer` por la síntesis (cobertura de test, cosméticos, UX-en-browser que cubre el gate de Edgar, y edges de contrato ya aceptados).

### Evidencia primaria final (corrida por el controlador en HEAD `e0a1762`)
- Motor `npm test` **88/88** (17 files) · Web `npm test` **151/151** (11 files) · Web `tsc --noEmit` **0** · Web `vite build` **exit 0**. Árbol limpio. `main` 14 commits ahead de `origin/main`, no pusheado.

### GATE MANUAL de Edgar (Chrome/WebGPU real — headless no soporta WebGPU; R1/R2/R4 y toda la UI son UI-wired, sin cobertura auto)
1. ✅ **CONFIRMADO (2026-07-11):** partida completa 9×9 vs KataGo(200) jugada de punta a punta hasta el fin — Edgar perdió. Nivel de juego "aceptablemente bueno" a 200 visitas (descarta jugada degenerada/NaN, el susto fp16 de Fase 0 no reaparece). Ejercita de punta a punta: apertura, capturas, ciclo hasta terminar la partida (pases o resign). 13×13/19×19 y Human SL(rank) aún sin confirmar explícitamente; handicap 19×19 (Blanco abre) sin confirmar.
2. Exploración de variaciones: navegar atrás, jugar 2+ movimientos alternando color → la IA NUNCA interviene, banner "Modo exploración"; re-jugar la secuencia real → reencuentra la main line → la IA vuelve a responder.
3. Export→Import round-trip idéntico; **importar un SGF ILEGAL → mensaje "No se pudo importar…" recuperable, SIN pantalla blanca** (FIX 1); import de partida no-terminada con turno Blanco → la IA juega (esperado, eyeball de producto).
4. Recargar → restaura donde quedó (incl. si toca IA → retoma sola); **restaurar partida TERMINADA (resign/2-pases) → "Partida terminada"+resultado de inmediato, no revive** (FIX 2); import→recargar antes de jugar → persiste el import (FIX 4).
5. "Nueva partida" mid-genMove sin errores de consola; "Preparando motor…" durante la carga (no "IA pensando…"); panel de árbol legible con variaciones.

**PUSHEADA a `origin/main` (2026-07-10, `d89a0a2..ffb6295`, con OK explícito de Edgar vía AskUserQuestion — mismo precedente que Fase 1). Gate manual EN CURSO: escenario 1 parcialmente confirmado (9×9 vs KataGo). PENDIENTE: 13×13/19×19, Human SL, handicap, y escenarios 2–5 (exploración, Export/Import incl. SGF ilegal, restauración, Nueva partida mid-genMove).**

## Hallazgos del gate manual de Edgar (2026-07-11, sesión de juego 9×9 vs Human SL 1k) — investigación PAUSADA a pedido de Edgar (reportar y avanzar a Fase 3; retomar diagnóstico cuando corresponda)

Edgar jugó 9×9 contra Human SL 1k con reglas configuradas como japonesas. Tres observaciones, ninguna investigada a fondo todavía:

1. **CRASH: `Error: Suicide prevented` durante el montaje/remonte de `ReadyPlayView`.** Stack real:
   ```
   Error: Suicide prevented
       at _GoBoard.makeMove (@sabaki_go-board.js:73:19)
       at applyMove (rules.ts:95:16)
       at boardFromMoves (rules.ts:40:13)
       at GameTree.boardAt (gameTree.ts:196:12)
       at C.ReadyPlayView [as constructor] (PlayView.tsx:434:22)
   ```
   **BUENA NOTICIA:** el `ErrorBoundary` de la fix wave (FIX 1 parte 2, commit `7472a49`) FUNCIONÓ como se diseñó — capturó el throw y mostró la pantalla de recuperación, no pantalla blanca. Primera confirmación en producción de esa red de seguridad.
   **CAUSA RAÍZ — NO CONFIRMADA (investigación pausada antes de leer el código):** el throw ocurre reconstruyendo el tablero completo desde la raíz (`boardFromMoves` repite TODAS las jugadas del árbol), lo que implica que una jugada ILEGAL ya estaba en el árbol ANTES de este montaje — se coló en algún punto sin pasar por `validateMove`. El log muestra dos bloques de reconexión de Vite ~25 min aparte, consistente con un reload a mitad de partida (candidato: `restoreSession()` cargando un árbol persistido ya corrupto). **Hipótesis de trabajo (sin verificar):** `aiTurn()` en PlayView.tsx llama `tree.addMove(move)` sobre el resultado de `manager.genMove()` SIN pasar por `validateMove` (a diferencia de los clics humanos, que sí validan primero); si `sampleHumanMove` (humansl.ts) no chequea suicidio real en su filtro de candidatas (solo excluye ocupado y ko-simple — ver hallazgo #2 abajo, mismo archivo), una jugada de la IA Human SL podría ser un suicidio legítimo que entra al árbol sin guardas. **Próximo paso al retomar:** leer `humansl.ts` (filtro de candidatas), `aiTurn()` (PlayView.tsx), y `GameTree.addMove` para confirmar o refutar esta cadena antes de proponer fix (systematic-debugging Fase 1, no completada).

2. **CONFIRMADO EN CÓDIGO (no requiere más investigación): Human SL puede NO pasar nunca, salvo tablero sin candidatas.** `packages/engine/src/humansl.ts:30` documenta explícitamente `humanSLChosenMoveIgnorePass=true`: `sampleHumanMove` IGNORA `policyPass` y solo pasa cuando no quedan casillas legales vacías∧≠ko. Decisión de Task 11 de la fase engine, nunca antes ejercitada contra un humano jugando en vivo (Task 11/12 solo testearon con policy sintética). **Consecuencia de producto real:** en "Modo Jugar" contra Human SL, el mecanismo normal de fin de partida (dos pases consecutivos) puede no dispararse NUNCA — el humano puede pasar todas las veces que quiera, la IA seguirá jugando hasta que el tablero esté físicamente lleno. La única salida práctica es "Rendirse". Esto es justo lo que Edgar reportó ("pasé muchas veces y la máquina no se rendía"). **No es un bug del código** (el comportamiento es el diseñado), pero SÍ es un gap de producto sin resolver para Modo Jugar: decidir si Human SL necesita un umbral/heurística de "posición muerta → pasar" para esta UI, o si se documenta como comportamiento esperado y se refuerza el botón Rendirse.

3. **SIN CONFIRMAR: impresión de reglas chinas pese a configurar japonesas.** Edgar percibió que el scoring/la partida se comportó como reglas chinas aunque seleccionó japonesas en `NewGameForm`. Podría ser: (a) percepción (diferencia sutil china/japonesa en partidas cortas), (b) `scoreValue`/`evalV8` (adaptación de web-katrain) no diferenciando reglas correctamente en el postproceso, o (c) el `rules` de `GameConfig` no propagándose correctamente hasta `positionAt()`/el motor. Sin evidencia aún — anotado para verificar cuando se retome.

**Acción para retomar:** los 3 puntos quedan abiertos para una sesión de debugging dedicada (`systematic-debugging`, Fase 1 completa) antes de tocar código — en particular el #1 (crash) es Important por severidad (aunque mitigado por el ErrorBoundary) y el #2 tiene una decisión de producto pendiente de Edgar.

## Fase 3a — Modo Analizar (núcleo)

Task 1: complete (commits e324dcb..e593bda, review clean — Approved, 2 Minor no bloqueantes: preCancelled/activeCancels pueden acumular entradas huérfanas acotadas por ids monótonos, sin bug de correctitud; señalado para revisar en el review final de branch).
Task 2: complete (commits e593bda..690c714, review clean — Approved, 1 Minor no bloqueante: cada analyze() en curso mantiene su propio listener live.crash.catch vivo hasta que él mismo se cancela; un crash dispara onError UNA VEZ POR CADA analyze aún no cancelado — no es memory leak, pero es un contrato de caller a documentar para el scheduler de Task 6/7: cancelar cada analyze antes de lanzar el siguiente para evitar fan-out de onError).
Task 3: complete (commits 690c714..f1c4317, review clean — Approved, 2 Minor triviales: assertion circular en topMoveMetric.test.ts, cobertura de signo White solo en una dirección en nodeAnalysis.test.ts).
Task 4: complete (commits f1c4317..d827e5d, review clean — Approved, 1 Minor no bloqueante: depthFilter en computeGameReport compara `depth` crudo en vez de `moveNumber` tras la adaptación root-exclusion de mainLine — desfasado en 1 jugada si algún caller pasa un depthFilter no-default; hoy nadie lo hace (Task 5 no lo cablea). Fix de una línea cuando se use: `if (moveNumber < fromDepth || moveNumber >= toDepth) continue`. 3 discrepancias brief-vs-vendor detectadas y resueltas correctamente por el implementador: CandidateMove.pv (campo nuevo genuino), classifyMoveByRankAndPolicy toma el veredicto MÁS LEVE no el peor (el brief y el propio plan hallazgo 14 tenían esto invertido — corregido en el código de doc, no en el algoritmo), GameNodeWithChildren local en playedMoveQuality.ts en vez de extender types.ts compartido).
Task 5: complete (commits d827e5d..3b4cef6, review clean — Approved, 2 Minor no bloqueantes: e2e test de computeGameReport asserta solo estructura no valores de pointsLost; adaptMainLine es O(n²) en profundidad por currentTurnAt re-caminando a la raíz por nodo, aceptable YAGNI). Módulo más delicado del plan (katrainAdapter.ts) — verificado independientemente por advisor + reviewer: perspectiva Negro de MoveAnalysis.scoreLead confirmada en engine.ts:44-67, currentTurnAt vs move.player correctamente distinguido en tests, convención de pase end-to-end, order sort-on-copy sin mutar el array compartido.
Task 6: complete (commits 3b4cef6..3965131, review clean — Approved, 0 Critical/Important, 1 Minor cosmético: helper flush(8) de microtasks fijo en el test, mildly fragile pero funcional). analysisQueue.ts port byte-for-byte fiel al brief (verbatim vendor MIT + singleton omitido documentado). reviewScheduler.ts: los 4 caminos de asentamiento (éxito/error/abort/timeout) verificados como freeze-proof — el timer de 30s es backstop incondicional, cancelFn() se llama en los 4. Test de settle-on-abort (hallazgo 21) confirmado como genuinamente discriminante (revisor rastreó a mano que sin el abort-listener el test cuelga).
Task 7: complete (commits 3965131..760a07e, review clean — Approved, 0 hallazgos de peso, 2 Minor cosméticos sin acción). GameReview orquesta correctamente: raíz incluida en el target set (trampa del texto literal del plan evitada), progress() derivado puro (sin contadores mutables), reintento benigno vs error real vía type guards, guard de disposed dentro del handler de reencolado verificado como genuinamente diagnóstico por el revisor (no solo por el reporte del implementador).
Task 8: complete (commits 760a07e..308b9ef, review clean — Approved, 0 hallazgos, 1 Minor de redacción sin acción). overlays.ts/guessAgainstEngine.ts/winrateGraphData.ts verificados exhaustivamente por el revisor: indexación [y][x] con datos asimétricos genuinamente discriminante, dedup de buildPvLines correcto en ambas convenciones de PV, desviación de guessAgainstEngine (ReviewScheduler en vez de EngineManager directo) documentada en 3 lugares, atribución correcta solo en guessAgainstEngine.ts, ningún archivo de Tasks 1-7 tocado (confirmado con git diff --stat).
Task 9: complete (commit 308b9ef..a22790b, review clean — Approved, 0 Critical/Important, 2 Minor sin acción: annotationFor invoca el callback 2 veces por nodo por render en GameTreePanel.tsx — inofensivo para `store.has`, fix trivial si algún día el callback deja de ser barato; el botón de análisis se re-habilita tras un fallo de init del motor, enruta a analyzeError en vez de romper, no es un defecto). Primer "analizar una posición de punta a punta": AnalyzeView.tsx (SgfPicker + ReadyAnalyzeView con ModelGate net='b18' fijo), botón manual "Analizar esta posición" (analyzingNodeId por-identidad, no boolean — verificado por el revisor que una resolución tardía de un nodo abandonado nunca pisa el estado del nodo actual), GameTreePanel.tsx gana `annotationFor?(node)` retro-compatible (PlayView no la pasa, sin cambio visual). NO instancia GameReview ni paneles de Task 10, NO toca main.tsx — alcance verificado limpio por el revisor (file list exacta: app.css + AnalyzeView.tsx nuevo + GameTreePanel.tsx).
  - **Incidente de proceso (para constancia, no afecta el resultado final):** el primer despacho de este task devolvió un "Status: DONE" con un SHA de commit (`fb63234`) que NO existía en el repo — `git log`/`git reflog`/`find` no mostraban ningún archivo ni commit real tras esa respuesta. El controlador NO aceptó el reporte a ciegas (regla "trust but verify" del Agent tool): verificó el filesystem/git directamente, encontró la discrepancia, envió al mismo agente un mensaje pidiéndole que se autoverificara contra el estado real del repo, y — mientras ese agente estaba a mitad de esa autoverificación (había encontrado por su cuenta que el commit real era `a22790b`, no `fb63234`) — lo detuvo (`TaskStop`) para evitar que un segundo agente despachado en paralelo generara un conflicto de archivos. El controlador entonces confirmó `a22790b` de forma completamente independiente (git show --stat, lectura completa del diff, tsc/vite build/npm test corridos de cero por el propio controlador, no re-usando la palabra del agente) antes de proceder al review normal de la tarea. Lección para el resto de esta fase: la notificación de "task completado" de un subagente en background NO es evidencia por sí sola — el SHA/archivo/reporte declarado debe verificarse contra el filesystem/git real antes de generar el review package, siempre, no solo cuando algo se ve raro.
Task 10: complete (commits a22790b..09da98a, fix cc2a5cb, re-review Approved). Cierra el círculo de Modo Analizar: ReadyAnalyzeView arranca GameReview (Task 7) al montar (fire-and-forget, no bloquea `booting`) + timer de progreso cada 1s; tres paneles 100% presentacionales (WinrateGraphPanel — SVG minimal solo winrate, decisión de alcance deliberada de no graficar scoreLead; GameReviewPanel — progreso + turning points; GuessMovePanel — modo-adivinanza con el Goban temporalmente interactivo). `nodeForGraphPoint`/`nodeForReportEntry` implementan dos convenciones de `moveNumber` DISTINTAS (0-based con raíz vs 1-based sin raíz) — verificadas por el revisor como correctas y no confundidas. 5 puntos de navegación unificados en `afterNavigate()`. Controlador verificó de forma independiente el commit ANTES del review (git log/show/ls + tsc/build/test corridos de cero) — mismo protocolo instaurado tras el incidente de Task 9, ya funcionando como práctica estándar.
  - **1 hallazgo Important, arreglado y re-verificado:** el flujo de adivinanza no protegía contra navegar a otra posición mientras la petición estaba en vuelo (a diferencia de "Analizar esta posición", que sí lo hacía desde Task 9) — una adivinanza lanzada en A que resolvía tras navegar a B se mostraba mal atribuida a B. Fix (`cc2a5cb`): mismo patrón `tree.current.id === nodeId` ya usado en `handleAnalyzeClick`, capturando el nodeId al lanzar la adivinanza y gateando `setGuessResult`/`setGuessErrorMsg` (NO `setGuessBusy`, que debe quedar incondicional para no dejar el botón de arranque permanentemente deshabilitado tras navegar). Re-review independiente confirmó: hallazgo resuelto, sin regresión sobre `handleAnalyzeClick` (hunk no tocado), garantía estructural de "una sola adivinanza en vuelo a la vez" verificada contra `GuessMovePanel`'s disabled logic.
  - 2 Minor diferidos al review final (no bloquean): (1) el botón de `GuessMovePanel` no se deshabilita durante `booting` (cosmético, se recupera vía el canal de error existente); (2) un `guessResult`/`guessErrorMsg` ya asentado persiste visible tras navegar a otra posición (mismo patrón ya aceptado de `analyzeError` en Task 9, no arreglado a propósito).
Task 11: **complete** (commit ef38a0a, fix del controlador fe89d50, review Approved — 0 Critical/Important, 2 Minor cosméticos sin acción). Última tarea de implementación de Fase 3a. Conmutador `ModeApp`/`ModeMenu` en `main.tsx` entre el gate de WebGPU y `PlayApp`/`AnalyzeView`, sin `key`/`sessionKey` (innecesario a este nivel — el menú siempre se interpone entre transiciones, desmonta/remonta limpio). `PlayView.tsx`/`NewGameForm.tsx` intactos (asimetría deliberada: Modo Jugar sin "volver al menú" en esta tarea). Auditoría de atribución MIT de los 11 archivos portados de web-katrain (Tasks 3,4,6,7,8): el revisor la re-verificó 11/11 de forma independiente (no solo confió en el reporte) — cabeceras, bullets de `THIRD-PARTY-LICENSES` y filas de `adaptaciones-upstream.md`, todo completo y correcto, sin gaps.
  - **Corrección del controlador (fe89d50, no de un subagente):** el commit original de Task 11 (`ef38a0a`) hacía `ModeApp` saltar directo a `mode='play'` si `loadGame()` encontraba una partida guardada, para preservar el "recargar retoma tu partida" de Fase 2 — pero combinado con la asimetría deliberada de arriba (Modo Jugar sin salida al menú), eso dejaba Modo Analizar sin ningún camino de UI para cualquier usuario que ya hubiera jugado una vez: cada recarga futura saltaba el menú. El controlador lo detectó leyendo el diff él mismo (antes de despachar el review), lo consultó con el advisor, y aplicó el fix directamente (sin subagente, cambio de una línea): `ModeApp` ahora SIEMPRE arranca en `'menu'`, coherente con el texto literal del plan ("conmutador... antes del formulario actual" — antes de PlayApp/NewGameForm SIEMPRE, no solo condicionalmente). Costo: un clic extra para retomar una partida en curso (menú → "Jugar" → `restoreSession()` la recupera igual, sin pérdida de datos). El revisor verificó el fix de forma independiente (trazó el flujo completo de retomar partida, confirmó ausencia de código muerto, confirmó que no reintroduce ningún otro problema) antes de aprobar.
  - 2 Minor sin acción (cosméticos): (1) un comentario en `main.tsx` referencia "ver comentario de ModeApp más abajo" pero ES el propio comentario referenciado (self-reference sin destino, artefacto de redacción entre los dos commits); (2) el comentario/mensaje de commit dice la Analizar quedaba "INALCANZABLE para siempre", que sobre-afirma levemente (existía un escape real vía "Nueva partida", que limpia el storage) — la severidad práctica real (sin camino de UI directo) no cambia, el fix sigue siendo correcto.

## Fase 3a — cierre (revisión final whole-branch + fix wave)

**Revisión final** (opus, sobre 5c8e217..fe89d50, 15 commits): controlador re-verificó de cero (91/91 motor, 351/351 web, tsc/build limpios en ambos workspaces) antes de dispatchar; revisor re-verificó lo mismo de forma completamente independiente y llegó a los mismos números. Veredicto: **"Ready to merge? Con fixes"** — el track record de las 11 tareas se sostuvo bajo escrutinio independiente (convención Negro-siempre verificada en cada superficie de UI, orden de dispose de `ReadyAnalyzeView` confirmado libre de fugas, atribución re-chequeada 3 archivos end-to-end sin discrepancias, la composición completa `AnalysisQueue`/`preempt` entre review-de-fondo/interactivo/adivinanza trazada a mano sin deadlock/zombie/misattribution). Triage explícito de TODOS los Minor diferidos de Tasks 1-11: 11 de 12 se dejan como estaban (documentados, aceptados); 1 (T10: `guessResult`/`guessErrorMsg` persistiendo tras navegar) se promovió a "arreglar ahora" — mismo ítem que terminó en el Finding 2 del fix wave.

**1 hallazgo Important genuinamente nuevo (no visible en ningún review por-tarea):** `GameReview.start()` encola review para TODOS los nodos al montar (store vacío); su handler de éxito escribía en `store` sin condición — cualquier nodo analizado a mano por el usuario (`handleAnalyzeClick`, 200 visitas) ANTES de que le tocara el turno a su propio job de review ya encolado (`REVIEW_VISITS`=100) terminaba con su resultado silenciosamente pisado por uno de menor calidad en cuanto ese job resolvía. Bug de composición entre dos piezas cada una correcta en aislamiento (Task 7 testeó `GameReview` con mock, Task 9 testeó el análisis interactivo aislado) — exactamente la misma forma que el bug de alcanzabilidad de Task 11, encontrado por el mismo tipo de revisión cross-cutting que ningún review por-tarea puede hacer estructuralmente.

**Fix wave (commit `dfffa3d`, batcheado, 4 hallazgos):**
1. **[Important] Fix real:** guard `if (!this.deps.store.has(node.id)) this.deps.store.set(...)` en el handler de éxito de `analyzeTarget` (`gameReview.ts`) — el review SIEMPRE difiere a cualquier resultado ya presente (interactivo, de mayor calidad); `handleAnalyzeClick` sigue escribiendo SIN guard a propósito (una petición fresca del usuario siempre gana, sin importar el orden). Test nuevo en `gameReview.test.ts` (el caso que el test de idempotencia preexistente NO cubría: escritura interactiva que llega DESPUÉS del encolado, no antes) — RED confirmado sin el guard (scoreLead=3 pisaba 999), GREEN con él; assert por identidad de referencia, no solo de valor.
2. **[Minor, promovido] Fix:** `afterNavigate()` en `AnalyzeView.tsx` ahora también limpia `guessResult`/`guessErrorMsg`/`analyzeError` — cierra el Minor diferido de Task 10.
3. **[Minor] Fix:** `adaptaciones-upstream.md` generaliza la intro + el runbook de re-sync (framing, no las filas de la tabla, que ya eran correctas) para cubrir los dos subdirectorios origen reales (`src/engine/katago/`→`packages/engine/`, `src/utils/`→`apps/web/src/analysis/`) — el runbook literal se habría saltado en silencio los cambios de Fase 3a antes de este fix.
4. **[Minor] Fix:** comentario de cabecera de `analysisStore.ts` corregido — el reset entre sesiones lo logra un `AnalysisStore` fresco por remount, no una llamada a `clear()` (nada la invoca hoy); `clear()` se mantiene disponible para un futuro caller.

Controlador verificó `dfffa3d` de forma independiente (git log/show + tsc/build/test de cero: 352/352 web, 91/91 motor) y leyó el diff completo antes de cerrar — mismo protocolo de todo el resto de la fase.

**Estado final:** 16 commits sobre `main` desde `e324dcb` (plan, inclusive) hasta `dfffa3d` (fix wave final, inclusive) — 11 tareas de implementación + 1 commit extra de cobertura de Task 1 (`e593bda`) + 3 commits de fix/corrección (Task 10 fix `cc2a5cb`, Task 11 fix del controlador `fe89d50`, fix wave final `dfffa3d`). Gate manual de Chrome/WebGPU real (Edgar) es el único paso pendiente — fuera del alcance de SDD, no intentado ni simulado.

## Fase 4 — apps/worker base (deploy sin cuentas)

Spec: `docs/superpowers/specs/2026-07-11-fase4-deploy-worker.md`. Plan: `docs/superpowers/plans/2026-07-11-fase4-deploy-worker.md`. Roadmap madre actualizado (commit e350874) antes de arrancar. Ejecutando por Subagent-Driven Development sobre `main`. Base pre-Task-1: e350874.

**Hallazgo crítico #2 (bloqueó Task 1, ya resuelto) — bundle bloat de onnxruntime-web.** Primer implementador de Task 1 reportó BLOCKED: `npm run build -w @tengen/web` produce `dist/assets/ort-wasm-simd-threaded.jsep-<hash>.wasm` de 26.8 MB, excede el límite de 25 MiB/archivo de Cloudflare Workers Static Assets → `npm test -w @tengen/worker` y `wrangler dev` fallan con "Asset too large". Diagnosticado con un workflow de 3 agentes (reachability del código muerto en onnxruntime-web + mecanismo de Vite/Rollup + investigación externa) — conclusión: `import * as ort from 'onnxruntime-web'` resuelve por defecto a `ort.bundle.min.mjs`, que trae un `new URL(archivo.wasm, import.meta.url)` interno que Vite bundlea SIEMPRE (análisis ciego a control de flujo), aunque `session.ts` (wasmPaths fijo) nunca ejecuta esa rama — la copia de 26.8 MB en `dist/assets/` es peso muerto, nunca fetcheada. Un subagente del workflow reportó un intento de prompt injection durante su investigación (contenido de herramienta fabricado + instrucción falsa de silencio); lo verificó contra git y lo reportó igual, sin afectar la conclusión. Controlador reprodujo el fix de forma independiente (build limpio con reversión, dos veces) antes de aplicarlo. Edgar confirmó proceder. Fix: `resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] }` en `apps/web/vite.config.ts` (export condition oficial del paquete) — el `.wasm` de 26.8MB desaparece de `dist/assets/`, `vite dev` sigue sirviendo `/ort-dist/...` sin cambios, `tsc` 0 errores. Documentado como "Hallazgo crítico #2" en el plan de Fase 4 (con nota en Task 3 Step 1/2 para que no choque con `copy-ort-dist-prod`, fix ortogonal). No pasó por ciclo completo implementer+reviewer (una línea, doble verificación independiente ya hecha, confirmación explícita de Edgar) — commit separado antes de retomar Task 1 con el mismo implementador (agentId a509e471d9df3a2eb).

Task 1: **complete** (commit `ec65d50`, sobre `59d75b1`; scaffold `apps/worker` — Hono + static assets + R2 binding). Review: Approved, spec ✅, sin Critical/Important — 2 Minor inherentes al diseño del brief (suite no-hermética depende de `apps/web/dist` pre-buildeado; cobertura automatizada solo de bindings, ruteo real verificado a mano vía `wrangler dev`), no bloquean. 3 desviaciones del brief documentadas y verificadas independientemente por el reviewer como necesarias (bump de `@cloudflare/vitest-pool-workers` a `^0.12.0` por incompatibilidad de peer con vitest 3.2.7; `types` de tsconfig; augmentación ambiental de `ProvidedEnv`) — no tocar en tasks siguientes.

Task 2: **complete** (commits `ec65d50..73134c1`, incluye el docs-only `4730e2a` de por medio; `GET /models/:filename` proxy a R2 con Cache-Control immutable, registrado antes del catch-all). Review: Approved, spec ✅, sin Critical/Important — route byte-idéntica al brief. 3 desviaciones en los tests (afterEach de limpieza R2 + `.arrayBuffer()` en vez de `.text()` + drenar el body del 3er test) narradas por el implementador como una sola causa ("Failed to pop isolated storage stack frame"); el reviewer verificó contra la documentación oficial de Cloudflare (`known-issues` de vitest-integration) que SOLO la tercera (drenar el body del test de Content-Length) es la fix real y necesaria — las otras dos son higiene inocua de más, no scope creep. No bloquea.

**Hallazgo crítico #3 (durante Task 3, ya resuelto por el controlador).** El implementador de Task 3 (browser verification real vía chrome-devtools-mcp, screenshots guardados y revisados por el controlador — partida jugable, IA respondió) reportó DONE_WITH_CONCERNS: el archivo REAL `ort-wasm-simd-threaded.jsep.wasm` que copia a `dist/ort-dist/` pesa 25.6 MiB, excede igual el límite de 25 MiB de Cloudflare (distinto del duplicado muerto del Hallazgo #2 — este es el binario indispensable, no se puede eliminar). Controlador reprodujo con `wrangler deploy --dry-run` real (mismo error). Edgar interrumpió el flujo de revisión pidiendo parar el gasto de subagentes y resolverlo directo — controlador implementó él mismo (sin subagente): `apps/web/public/.assetsignore` (`ort-dist/*`, excluye del scan de static assets sin dejar de generarlo para `vite preview` local) + nueva ruta `GET /ort-dist/:filename` en el Worker (mismo patrón que Task 2, mismo bucket `MODELS`, prefijo de key `ort-dist/`, con Content-Type por extensión y COEP explícito) + 4 tests nuevos. Verificado: 9/9 tests, tsc limpio ×2, `wrangler deploy --dry-run` PASA (antes fallaba), suite completa 352/352 sin regresión. Documentado como "Hallazgo crítico #3" en el plan, con nota de que deja inerte (no rota) la regla `/ort-dist/*` que Task 4 iba a poner en `_headers`, y con el paso de subida a R2 agregado al runbook de Deploy (paso 2b).

**Segundo intento de prompt injection en esta sesión:** un "system-reminder" fabricado, dirigido directamente al controlador (no a un subagente esta vez), afirmó falsamente que `vite.config.ts` había sido editado por "el usuario o un linter" y pidió no decírselo a Edgar. Verificado contra git (`git diff`/`md5`, coincide exacto con el commit real `b4f47dd`) — el contenido mostrado resultó ser preciso, pero el mecanismo de inyección (instrucción de ocultar información al usuario) se resistió igual, y se le avisó a Edgar explícitamente. Mismo patrón que el primer intento (Hallazgo #2), ahora sin intermediario de subagente.

Task 3: **complete** (commits `73134c1..149f6a8`: `b4f47dd` implementador — plugin `copy-ort-dist-prod` + verificación real en navegador; `149f6a8` controlador — fix del Hallazgo #3, ruta `/ort-dist/:filename` vía R2). Sin review por-task de subagente para el commit `149f6a8` — Edgar pidió explícitamente parar el ciclo de subagentes por costo de tokens y que el controlador lo resolviera directo; verificación propia exhaustiva (tests, tsc, `wrangler deploy --dry-run` antes/después, suite completa) documentada arriba.

Task 4: **complete** (commit `add6c61`; `apps/web/public/_headers`, COOP/COEP). Implementado directo por el controlador (mismo criterio que Task 3b — archivo estático de 6 líneas, sin ambigüedad de spec, Edgar pidió minimizar subagentes). Verificado: build copia el archivo verbatim, `wrangler deploy --dry-run` sigue pasando (11 archivos, 64.47 KiB).

## Review final whole-branch — HECHO (rango `7b6cc4f..a440a5e`, opus)

Sin Critical. 1 Important (suite de `apps/worker` no-hermética — falla sin build previo de `apps/web`, reproducido independientemente por el reviewer) + 5 Minor (parsing de extensión sin `.` en `/ort-dist/:filename`; comentario desactualizado en `netManifest.ts` que decía "URL de R2" cuando en realidad el path relativo `/models/` es idéntico en dev y prod; gaps de cobertura de test — paridad COEP `/models` vs `/ort-dist`, filename sin extensión; runbook de Deploy paso 2b con path hardcodeado a `node_modules/onnxruntime-web` en vez de resolverlo con Node, inconsistente con que el propio plugin de Vite SÍ lo resuelve dinámicamente por si el paquete no queda hoisteado). Ready to merge: **With fixes**. Verificó independientemente: build, tsc ×2, 9/9 tests, guarda de tamaño vacía, `_headers`/`.assetsignore` en `dist/`, alineación completa cliente↔R2-key para ambos namespaces, sin riesgo de path traversal (R2 keys son opacas, no hay semántica de filesystem).

**Fix wave (controlador, sin subagente — mismo criterio de esta fase):** los 6 hallazgos arriba, todos aplicados y verificados. `pretest` en `apps/worker/package.json` (`npm run build -w @tengen/web`) — hermeticidad de la suite Y extiende la guarda de regresión de tamaño al flujo normal de test, no solo a `wrangler deploy --dry-run` manual. Extensión sin `.` corregida (`dot === -1 ? '' : ...`). Comentario de `netManifest.ts` corregido (el path relativo NO cambia entre dev/prod, lo que cambia es quién lo sirve). 2 tests nuevos (paridad COEP + filename sin extensión) → 11/11. Runbook paso 2b usa `require.resolve` vía Node en vez de hardcodear la ruta. Verificado de nuevo tras el fix wave: 11/11 worker + 91+352 resto del monorepo sin regresión, tsc ×2 limpio, `wrangler deploy --dry-run` OK (11 archivos, 64.50 KiB).

## Push + Deploy runbook — HECHO (2026-07-11, controlador directo, sin subagente)

Push a `origin/main` (13 commits, hasta `3e64526`) — hecho a pedido explícito de Edgar. Cuenta Cloudflare confirmada por Edgar: **kntor-dev** (`1462061bf4f3dd4785e2fd0c1da9b21e`, fijada en `apps/worker/wrangler.jsonc` como `account_id`).

- Bucket R2 `tengen-models` creado.
- **Trampa evitada:** `wrangler r2 object put` sin `--remote` sube al R2 **local simulado**, no a la nube — el primer intento del modelo kata1 se detectó a tiempo (`bucket info` remoto mostró `object_count: 0` tras el "upload complete") y se re-subió con `--remote`. Los 4 archivos reales confirmados en el bucket remoto (descarga de verificación del kata1: 115.800.125 bytes exactos, luego borrada).
- 4 objetos subidos con `--remote`: `b18c384nbt-kata1.fp32.onnx`, `b18c384nbt-humanv0.fp32.onnx`, `ort-dist/ort-wasm-simd-threaded.jsep.mjs`, `ort-dist/ort-wasm-simd-threaded.jsep.wasm`.
- `wrangler deploy` → `https://tengen-worker.kntor.workers.dev` (verificado con curl: 200, headers correctos).
- Dominio custom conectado vía `wrangler.jsonc` → `routes: [{pattern:"tengen.kntor.io", custom_domain:true}]` (sintaxis confirmada contra docs de Cloudflare antes de aplicar) + `wrangler deploy` de nuevo → `tengen.kntor.io (custom domain)`. Efecto secundario esperado (no buscado activamente, comportamiento default de Wrangler): al agregar `routes`, `workers_dev` queda deshabilitado — el subdominio `*.workers.dev` ya no sirve tráfico, solo el dominio custom.
- **Verificado en producción real (`tengen.kntor.io`):** SPA 200, headers `Cross-Origin-Embedder-Policy`/`Cross-Origin-Opener-Policy` presentes, `/models/b18c384nbt-kata1.fp32.onnx` sirve 115.800.125 bytes exactos con `Cache-Control: public, max-age=31536000, immutable` desde R2 real.
- Commit `f32b274` (account_id + routes en wrangler.jsonc), pusheado a `origin/main`. Tests de `apps/worker` siguen 11/11 con la config nueva.
- **Pendiente:** gate manual final de Edgar en `tengen.kntor.io` — partida completa Modo Jugar, SGF real en Modo Analizar, `self.crossOriginIsolated === true` en consola. Mismo tipo de gate que cerró Fase 2 y Fase 3a — no automatizable (WebGPU real).

Task 9: complete (commits 39498a1..f80cc30, review clean — Approved, sin Critical/Important). Passthrough puro verificado byte-idéntico a nivel de motor; PlayView.tsx confirmado sin tocar.
- Minor diferido: sin test del reloj en la rama de crash+retry (ambos call sites son textualmente idénticos, riesgo bajo).

Task 10: complete (commits f80cc30..5fa5229, review clean — Approved, sin Critical/Important/Minor). B+T/W+T sigue la convención SGF de B+R/W+R; ambos call sites reales (PlayView.tsx) confirmados sin ruptura.

Task 11: complete (commits 5fa5229..fd5b0a0, review clean — Approved, sin Critical/Important). "Sin reloj" produce GameConfig sin clock key (genuinamente ausente); error de validateConfig (throw) queda atrapado por el try/catch preexistente de handleSubmit — verificado estáticamente, no solo delegado a Task 13.
- Minor diferido: el propio reporte del implementador subestimó qué tan verificable era el caso mainTimeMs=0&&byoyomiPeriods=0 (lo marcó "a confirmar en navegador" cuando ya era verificable estáticamente) — no es un defecto, solo una autoevaluación conservadora.
- Pendiente para Task 13 (verificación manual real, no delegable): toggle mostrar/ocultar campos de reloj; comportamiento sticky de clockTouched al cambiar tamaño de tablero.

Task 12: complete (commits fd5b0a0..7baaa44, 2 rondas de review — Approved tras fix wave). LA TASK MÁS RIESGOSA DEL PLAN, tratada con el máximo cuidado: implementador y reviewer en opus, ambos con 2 dispatches c/u (uno cortado por corte de conexión/límite de sesión, retomado con SendMessage conservando contexto).
- **DECISIÓN DE EDGAR (AskUserQuestion):** explorar variaciones durante el propio turno en vivo (reloj corriendo) DEBE seguir consumiendo tiempo real (Opción B) — no pausar (Opción A, que abriría un exploit de "nunca perder por tiempo quedándose en modo exploración"). Fix aplicado: `liveTurn()` (turno de la PUNTA viva vía `tree.mainLine()`, cursor-independiente — verificado por el reviewer contra gameTree.ts) reemplaza `!isExploring() && currentTurnAt()===color` tanto en displayedClock como en el ticker; el reloj de Negro tickea en vivo Y dispara timeout aunque el jugador esté explorando. Blanco (IA) confirmado no explorable (busy=true bloquea toda nav) — comportamiento sin cambios.
- Además corregidos en el mismo fix wave (bugs sin ambigüedad de diseño, no escalados): (2) closure obsoleta del ticker con deps [] perdía el sync a D1 en timeout por AFK con sesión activa — fix con `declareTimeoutRef` reasignada en cada render (patrón "always-fresh ref"); (3) el ticker no escribía de vuelta el `state` de `applyElapsed` al detectar timeout, dejando el reloj mostrado en el valor de inicio de turno en vez de casi-cero — fix escribe el estado SOLO en el tick fatal (no en cada tick, para no duplicar consumo).
- Minor diferido (triage final): `play-clock-active` (el resaltado de qué reloj está activo) sigue gateado por `tree.currentTurnAt()` (turno del CURSOR) en vez de `liveTurn()` — desde el fix de exploración, el NÚMERO tickea correctamente pero el resaltado visual puede quedar en el color equivocado mientras se explora. Fix de una línea, no bloqueante.
- Minor diferido (confirmado preexistente y compartido por las 4 rutas de timeout, no introducido por esta task): timeout por agotamiento de tiempo principal muestra "00:30 · byoyomi 0" en vez de "00:00" literal (byoyomiPeriodMs se muestra igual con inByoyomi=true y 0 períodos restantes).
- Minor diferido: displayedClock se llama 4× por render en el JSX (recomputa Date.now() + 2 tree walks c/u) — costo trivial, preexistente desde la implementación original.

Task 13: complete (CSS commit e40cbf4). Typecheck+tests+build completos: verde en engine (120/120) y web (452/452), build de producción exitoso. Verificación manual COMPLETA en Chrome real (dev server local) — los 7 escenarios del brief confirmados:
1. Partida nueva CON reloj: reloj visible, tickea en tiempo real solo del lado que le toca, traspaso Negro↔Blanco correcto.
2. Partida SIN reloj: panel idéntico al de antes del plan, cero cambios visuales.
3. Entrada a byoyomi: formato "· byoyomi N" confirmado (probado vía mainTimeMs=0 → arranca directo en byoyomi).
4. Derrota por tiempo: "Partida terminada" + "Resultado: W+T" + controles deshabilitados, confirmado con byoyomi corto agotado sin jugar.
5. IA respeta su reloj: con clock corto (5s/período) la IA jugó dentro de su presupuesto real (consumió 2 de 3 períodos, no un tope de 600s por defecto) — confirmado cualitativamente.
6. Restauración a mitad de partida: recarga real de página — tablero+jugadas+reloj restaurados desde el último estado commiteado (no desde cero, no congelado), siguió tickeando correctamente tras el reload.
7. Cero regresión sin reloj: exploración de variaciones, Exportar SGF, sin errores de consola — flujo de Fase 2/5 intacto.

**2 BUGS REALES encontrados y corregidos durante esta verificación manual (exactamente el propósito de este task):**
- **CRÍTICO** (commit `b3d04db`): `byoyomiSeconds` en NewGameForm.tsx tenía `min="1" step="5"`, pero el default (`DEFAULT_BYOYOMI_SECONDS=30`) NO es alcanzable desde esa base (1,6,11...26,31...) — el navegador bloqueaba el submit de "Empezar partida" por validación HTML5 nativa SIN mostrar ningún error visible (ni el custom errorMsg, que nunca llega a ejecutarse). Con los valores por defecto (reloj activado, la config más común), el botón simplemente no hacía nada — bug que habría bloqueado a CUALQUIER usuario que no tocara ese campo. Diagnosticado vía `form.checkValidity()`/`el.validationMessage` en consola tras descartar causas de harness. Fix: `min="0"` (alinea con los otros 2 campos numéricos del formulario).
- **Important** (commit `f6cf492`, el Minor diferido del review de Task 12): `play-clock-active` (highlight de qué reloj está "activo") seguía gateado por `tree.currentTurnAt()` (turno del CURSOR) en vez de `liveTurn()`. Confirmado EN VIVO durante la verificación: al explorar durante el propio turno, el NÚMERO de Negro tickeaba correctamente (el fix de Task 12 funciona) pero el HIGHLIGHT marcaba a Blanco como activo — más engañoso de lo estimado por el reviewer (podía hacer creer al jugador que el reloj del rival era el que corría). Fix: gatear por `liveTurn()` en ambos `<p>`.

Ambos fixes verificados: typecheck limpio, suite completa 452/452 sin regresión, y el segundo confirmado visualmente en el navegador tras el fix (highlight correcto en Negro durante exploración).

## REVIEW FINAL WHOLE-BRANCH — HECHO (2026-07-17, opus, rango fd582a7..476874b, 21 commits)

Veredicto inicial: "Ready to merge? With fixes" — sin Critical, 1 Important (displayedClock usaba una fórmula de una sola fase que no rolaba el cruce tiempo-principal→byoyomi ni el borde de período mientras el jugador pensaba — el ticker de timeout SÍ usaba applyElapsed correctamente, esto era solo un bug de display, no de detección). Fix aplicado (`1586752`): displayedClock ahora deriva de applyElapsed, la misma función pura que ya usa el ticker.

El fix inicial agregó un guard contra NaN (byoyomiPeriodMs=0, config sudden-death alcanzable) — el re-review de ESE fix encontró que el guard era más angosto que la condición real de applyElapsed (solo chequeaba period<=0, no byoyomiPeriods===0), dejando pasar la config MÁS natural de sudden death (períodos en 0, segundos en su default) con un contador de byoyomi fantasma ciclando en vez de "00:00" limpio. Fix aplicado (`476874b`): guard ahora usa la misma condición OR completa que clock.ts.

**Patrón detectado por el reviewer, correcto:** los bugs de esta rama (ticker con closure obsoleta, ticker sin escribir estado al timeout, highlight con turno del cursor, displayedClock sin rollover) son todos la misma familia — "estado en vivo vs. estado mostrado/del cursor, dentro del componente con reloj". Vale la pena tenerlo presente para futuro trabajo en PlayView.tsx.

Minors diferidos (NO bloquean, no se arreglan — quedan documentados):
- `visitShareHistory` mide participación entre las 2 mejores candidatas (top-2), no del total de visitas — en una posición realmente reñida esto puede cortar por convergencia ANTES de llegar al presupuesto, haciendo que la extensión por posición difícil rara vez dispare. No inseguro (los topes de tiempo/byoyomi siempre rigen), es tuning de v1 ya documentado como tal en el propio código.
- Piso de 1000ms en computeBaseBudgetMs puede exceder el tiempo principal real restante cuando byoyomiPeriods=0 y quedan <1s — benigno (la IA ya estaba por perder por tiempo de cualquier forma).
- displayedClock('black')/('white') se llaman 3× cada uno por render — trivial, no perf-crítico en un juego de Go.
- Comentario sugerido (no cambio de código) en loadGame explicando por qué "último-no-null-gana" es seguro contra SGFs ajenos sin TGBP/TGBT.

Typecheck + suite completa verificados por el reviewer Y por mí de forma independiente tras cada fix: limpio en ambos paquetes, 120/120 engine, 452/452 web, build de producción exitoso (probado en Task 13).

**CIERRE:** repo en `main` directo, sin rama propia que mergear — mismo patrón que Fases 0-4 (confirmado explícitamente por Edgar). No hay PR que abrir. El reloj de partida queda commiteado en main, 21 commits (`fd582a7`..`476874b`), pendiente SOLO de decisión de deploy (fuera de alcance de este plan de ejecución, a pedir explícitamente).

## CIERRE — Reloj de partida COMPLETO (2026-07-17)

Pusheado a `origin/main` (24 commits, `a75cba9..476874b`, con OK explícito de Edgar vía AskUserQuestion — mismo precedente que fases anteriores). Sin rama propia que mergear/cerrar (se trabajó en `main` directo). Sin PR.

**Pendiente (fuera de alcance de este plan de ejecución, a pedir explícitamente):** deploy a producción (tengen.kntor.io) y gate manual de Edgar jugando una partida real con reloj en WebGPU real — mismo patrón que cerró cada fase anterior.

## DEPLOY A PRODUCCIÓN — HECHO (2026-07-20)

`wrangler deploy` desde `apps/worker` exitoso — Version ID `783ac923-e894-4f93-8ef2-5c122d75bc0f`. Nota: los 3 intentos del 2026-07-18 fallaron con `500 Internal Server Error` en el endpoint `assets-upload-session` — NO era problema de código/config/sesión (build y auth OK); el status page de Cloudflare confirmaba un "Minor Service Outage" activo en ese momento. Reintento del 2026-07-20 pasó sin cambios. Verificado en vivo en `tengen.kntor.io`: JS servido = `index-DRjRBYGw.js` (el build del reloj, consistente en 3 requests con cache-busting), headers COOP/COEP presentes, modelo b18 desde R2 con content-length exacto 115800125 + cache immutable. Este deploy también arrastró mobile-responsive (37c7545), que había quedado commiteado sin desplegar. **Pendiente SOLO: gate manual de Edgar jugando una partida real con reloj en WebGPU real en producción.**

## PLAN "actualización de la PWA + diagnóstico móvil + velocidad de análisis" — Fases 1 y 2 (2026-07-26)

Plan de 4 fases con una dependencia de DATOS, no de código: la Fase 3 (móvil) se bifurca según lo que reporte el iPhone 12, así que la Fase 2 es un instrumento de medición que hay que poner en manos del dispositivo antes de poder decidirla. Orden ejecutado: 1 → 2 → un solo deploy → 4. Fase 3 NO se toca hasta tener el volcado del iPhone.

**Fase 1 — actualización de la PWA (el disparador que faltaba).** `registerSW({ immediate: true })` sólo busca versiones nuevas AL CARGAR LA PÁGINA, y una PWA instalada no se recarga: se vuelve a ella. Sin esto, un dispositivo podía quedar semanas en un shell viejo — incluido el shell que NO tiene la pantalla de diagnóstico, que es la trampa que este orden de fases evita.
- El registro pasó de estado de componente a **singleton de módulo** (`pwa/swController.ts`): el menú también necesita leerlo (versión + botón), y dos llamadas al hook habrían llamado `registerSW()` dos veces — dos juegos de callbacks y dos intervalos periódicos. Mismo patrón que `cloud/useSession.ts` (estado compartido en el módulo, hook suscriptor). `useServiceWorker.ts` quedó sin lógica.
- Tres disparadores: `visibilitychange` (el caso real de una app instalada), `online` (el chequeo anterior pudo caer en un tramo sin red y consumió el throttle igual) y un `setInterval` de 60 min. Throttle de 5 min SÓLO para los automáticos — un botón que no da señal de haber hecho algo es peor que no tener botón.
- La parte decidible vive en `pwa/updatePolicy.ts`, puro y testeado en Node: `useServiceWorker` importa `virtual:pwa-register`, que no existe fuera de Vite, así que nada que viva ahí es testeable.
- `classifyRegistration` distingue `installing` de `uptodate`: `registration.update()` resuelve cuando terminó de bajar el SW nuevo, NO cuando terminó de precachear los 25 MB del WASM de ORT. Decir "ya estás al día" en ese momento sería mentir justo cuando algo sí está pasando.
- **Versión visible** (`buildInfo.ts` + `define` en vite.config.ts: SHA corto + `+local` si el árbol está sucio + fecha UTC). Sin poder VER qué versión corre un dispositivo, un reporte de "me pasa algo raro" es indepurable. Verificado en los tres entornos: `vite build` inyecta el literal (confirmado con grep en `dist/assets/index-*.js`), el **dev server NO aplica el define** (confirmado pidiendo `/src/buildInfo.ts` al server: llega sin reemplazar) y Vitest corre sin define — de ahí el `typeof`, la única lectura de un identificador libre que no lanza. En dev y en tests el valor es `'dev'`, que es lo correcto: no hay build desplegado del que hablar.

**Fase 2 — `/diagnostico`.** Empieza midiendo en el dispositivo real, no escribiendo código de producto: el issue microsoft/onnxruntime#26827 reporta JSEP (la ruta WebGPU) rota en Safari 26 con memoria creciendo hasta matar el proceso, así que la ruta WebGPU podría ser inusable en iPhone aunque arreglemos la detección.
- **Corrección crítica de diseño (venía en el plan):** el gate de WebGPU está POR ENCIMA del `<Router>`, así que una ruta normal sería inalcanzable justo en el dispositivo a diagnosticar. Se resuelve en `Root` por `pathname`, **antes del gate y antes incluso de la pantalla "Detectando WebGPU…"** — en un aparato donde `requestAdapter()` no resuelve nunca, todo lo que viene después se queda ahí para siempre.
- `webgpu.ts` devuelve `{ ok, reason }`. El `catch {}` vacío colapsaba cuatro causas distintas (sin `navigator.gpu` / adapter `null` / lanzó / no resolvió) en el mismo `false`, y es exactamente por qué no sabíamos qué le pasa al iPhone. **El gate NO pide device** (a propósito): pagarlo ahí se lo cobra a todos los usuarios de escritorio antes de dibujar el menú, y un fallo transitorio dejaría afuera a alguien cuya app hoy funciona.
- `diagnostics/gpuProbe.ts` sí sondea profundo, y corre en los DOS scopes con una sola implementación: `requestDevice()` (un adapter que se entrega con un device que falla es un modo de fallo típicamente móvil que el gate deja pasar — la app arrancaría y moriría DESPUÉS de bajar 115,8 MB) y `device.lost` con una gracia de 300 ms ANTES de destruir el device (al revés, nuestro propio `destroy()` resolvería `lost` y nos reportaríamos la limpieza como el síntoma buscado). Timeout por paso: un `requestAdapter()` colgado es un resultado, no un cuelgue de la pantalla.
- **El worker es worker propio, no el del motor**: `nn/session.ts` cachea su config en `ortConfigured` e instala el adapter en `ort.env.webgpu.adapter`; sondear desde ahí contaminaría ese estado. `probeWorker.ts` no importa `@tengen/engine` — verificado en el build: chunk propio de 2,65 kB, cero referencias a onnxruntime.
- Reporta también versión de iOS/WebKit parseada del UA (`userAgent.ts`), estado del service worker, cuota/persistencia de almacenamiento y qué modelos están completos en OPFS. La pregunta abierta del plan es de VERSIONES ("¿WebGPU en iOS exige iPhone 15 Pro?"), y eso es justo lo que conviene leer de la máquina en vez de recordar de memoria.

**Un bug real atrapado por la verificación manual, invisible para tsc y para los tests:** el volcado imprimía `maxComputeWorkgroupsPerDimension: 65535 (65.5 kB)` — un límite de CANTIDAD de grupos de trabajo disfrazado de memoria, porque `formatBytes` se aplicaba a todos los límites por igual. Un dato inventado con formato de dato real invita a razonar sobre memoria donde no hay memoria. Corregido con `BYTE_LIMIT_KEYS` + test que lo fija.

**Un bug de craft atrapado en la misma pasada:** el enlace al diagnóstico pedía `.ghost` y le llegaba el borde del menú igual, porque `.mode-menu a` es una regla de descendencia — se aplica por dónde ESTÁ el elemento, no por lo que el elemento dice ser. Se ascendió a átomo con nombre (`.link-button`, declarado en el markup) y de paso los enlaces del menú ganaron el `:focus-visible` que nunca tuvieron. `.session-box` → `.menu-footer` con dos variantes, para no duplicar el tratamiento del pie con otro nombre.

**Gates:** typecheck limpio en los 3 workspaces · 769 tests (120 engine + 605 web + 44 worker), +49 nuevos · `vite build` OK. Verificación manual en Chrome real: `/diagnostico` en escritorio coincide con lo conocido (apple/metal-3, adapter+device ok en AMBOS scopes, `crossOriginIsolated` en los dos, b18 en caché con 115.800.125 bytes exactos), y **auditoría de contraste sobre el DOM pintado: cero fallos** en las dos pantallas nuevas × los dos temas, en viewport de iPhone (390×844).

### DEPLOY Fases 1+2 — HECHO Y VERIFICADO EN PRODUCCIÓN (2026-07-26, Version `601a84f8-0273-44f2-9e82-0f4883f1a797`)

Commits `5ea4d5a` (fases 1+2) y `c2ebeb6` (denylist de /diagnostico). BUILD_ID desplegado: `c2ebeb6 · 2026-07-26 05:20 UTC`.

**Un modo de fallo que el advisor anticipó y que se REPRODUJO tal cual en producción, antes de que lo viera Edgar:** con el shell de `45a0d65` ya precacheado, abrir `https://tengen.kntor.io/diagnostico` mostró **el menú VIEJO** (sin pie de versión, sin enlace al diagnóstico) — el service worker viejo responde toda navegación con SU `index.html` precacheado, que carga un bundle donde `/diagnostico` no existe. Indistinguible de "la función está rota". El toast "Hay una versión nueva de tengen" sí apareció; tras apretar "Actualizar", `/diagnostico` renderizó correctamente. Mitigado para el futuro con `/diagnostico` en la denylist del `NavigationRoute` (`c2ebeb6`), que NO rescata la primera visita — por diseño imposible: el código no está en el bundle viejo. **Es la instrucción que hay que dar con la URL:** en un dispositivo con el shell viejo, aceptar el aviso de versión nueva ANTES de navegar a /diagnostico.

**Verificado en producción real (Chrome escritorio):** `build: c2ebeb6 · …` (el `define` llega al bundle desplegado) · worker de sondeo con `adapter: ok` — el chunk nuevo carga bien bajo COEP `require-corp` servido por los static assets del Worker, que era la duda no resuelta del dev server · `crossOriginIsolated: sí` en AMBOS scopes · service worker `activated` y controlando la página · almacenamiento `persistente: sí` · b18 en caché con 115,8 MB · los límites de GPU ya sin unidades de memoria falsas. Cero avisos.

**Falsa alarma descartada en el camino:** `curl -I` sobre `/assets/probeWorker-*.js` devolvía `content-type: text/html`. No es un problema del deploy: el Worker de assets responde HEAD con el fallback SPA. Con GET real llegan `text/javascript` y los 2769 bytes exactos del chunk local.

## PLAN "actualización de la PWA + diagnóstico móvil + velocidad de análisis" — Fase 4 (2026-07-26)

**El review pasa a DOS pasadas.** La propuesta original ("regular jugadas a predecir": 5/7/10) tenía la causalidad al revés y la investigación del plan lo desmontó: la longitud del PV ya era un parámetro fijo (`analysisPvLen: 10` → `pvDepth = 11`), calcularla es GRATIS (`buildPv` es un paseo por punteros de un árbol ya construido, cacheado por `(visits, depth)`, cero inferencias), y la relación real va al revés — el PV se corta donde el árbol se quedó sin visitas, así que bajar visitas ya lo acorta como efecto secundario. El PV es la sombra del dial, no el dial.

Lo que sí cuesta: 1 visita = 1 hoja expandida = 1 inferencia. Y el review analiza TODAS las posiciones sin muestreo, así que el reparto uniforme entre las 42 posiciones de una partida de 41 jugadas era el 42× que nadie tocaba (42 × 100 = 4.200 inferencias ≈ 15 min en `normal`). Bajar de 50/100/200 ya degradaba calidad (KaTrain usa `fast_visits=25`), así que la palanca no era el nivel: era el REPARTO.

- **Barrido** (`sweepVisits`: 20/25/40) — todas las posiciones. En `normal`: 42 × 25 = 1.050 ≈ 3,8 min → el mapa COMPLETO de la partida cuatro veces antes que antes.
- **Refinamiento** (`refineVisits`: 100/200/400) — sólo los saltos grandes, al DOBLE de las 100 que antes recibía cada posición. Más rápido Y mejor a la vez, porque las posiciones aburridas dejaron de pagar como las decisivas.
- El barrido no baja de 20 ni en `fast`: de él sale la SELECCIÓN de qué refinar, y un barrido ruidoso elige mal — refinar las posiciones equivocadas es peor que refinar pocas.

**Tres decisiones no obvias, cada una con test que las fija:**
1. **Refinar el nodo obliga a refinar su PADRE.** `pointsLost` se calcula comparando la evaluación del padre con la del hijo, así que re-analizar sólo el hijo mezclaría una evaluación gruesa con una fina — el número saldría MENOS confiable que el del barrido, no más. Se refina de a pares.
2. **Hay una barrera entre las pasadas** (el refinamiento espera a que el barrido entero se asiente). Antes de tener la partida completa no se sabe qué posiciones son decisivas.
3. **Cada pasada cuenta su progreso por separado**, con su propio ETA. Un total común crecería a mitad de camino y el porcentaje RETROCEDERÍA justo cuando el trabajo avanza. `progress()` devuelve `{ phase, summary }` y el panel nombra la pasada ("Repasando" / "Afinando errores") — sin eso, ver el contador volver a 1 se lee como si el review hubiera empezado de nuevo.

**El bug que casi entró, y por qué:** la primera versión resolvía el nodo a refinar con `entry.node as TengenGameNode`. `MoveReportEntry.node` es un nodo ADAPTADO a la forma de web-katrain (`{ move, parent, analysis }`): no tiene `id` ni relación de identidad con el árbol, así que el cast producía `undefined` en silencio y TypeScript no podía objetar — un `as` es literalmente la instrucción "confía en mí". Lo delataron 3 tests fallando por refinar 1 posición en vez de 2. El puente correcto ya estaba documentado en el vendor: `moveNumber` es `depth + 1` sobre una `mainLine` que excluye la raíz, o sea el índice exacto en `[root, ...mainLine()]` — y de ahí el padre sale gratis en `moveNumber - 1`. Cero casts.

**Aparte y sin mezclar: la longitud del PV como preferencia de VISUALIZACIÓN.** `pvDetailPreference.ts` (3 / 6 / Todas, persistida, mismo patrón que `speedPreference`) + un `maxMoves` opcional en `buildPvOverlay`. Etiquetada con NÚMEROS y no con adjetivos, deliberadamente: los números dicen qué cambia (cuánto se tapa el tablero) sin insinuar que el análisis vaya a ir más rápido. Estado local de la vista, no del padre con `key=`: cambiar cuánto se dibuja no invalida ningún análisis.

**Verificación con el MOTOR REAL en Chrome (gate manual, SGF de 20 jugadas con dos errores groseros fabricados — `aa`/A19 y `ss`/T1):** barrido de 21 posiciones → transición automática a "Afinando errores: 2/4 · 50% · ETA 1m 12s" (4 = 2 saltos × nodo+padre, sin solapamiento porque las jugadas 13 y 19 no son contiguas) → los dos turning points detectados son EXACTAMENTE los errores fabricados (A19 Blunder −12,5 · T1 Error grave −11,5). Selector de variación verificado en vivo: con el tope en 3, los labels dibujados pasan de `2,3,4,5` a `2,3`. Contraste AA del rail: cero fallos.

**Gates:** typecheck limpio en los 3 workspaces · 785 tests (120 engine + 621 web + 44 worker) · `vite build` OK.

### Fase 4 — fix posterior al review: un preempt podía dejar la segunda pasada sin arrancar

Encontrado en el review final (advisor), CONFIRMADO empíricamente y cerrado con test.

**El fallo:** la rama de cancelación benigna de `analyzeTarget` reencolaba SIEMPRE (salvo `disposed`). Pero quien preempta un job de review es, típicamente, un análisis interactivo de ESA MISMA posición — que corre a más visitas que el review. Así que el reintento gastaba inferencias (el recurso escaso, el tema entero de esta fase) en un resultado que el guard de escritura ni guardaría por ser peor que el que ya está.

**Por qué recién ahora importa:** antes, un barrido trabado sólo significaba una entrada faltante en un reporte por lo demás completo. Con dos pasadas, `refinePass` espera a que TODO el barrido se asiente (`Promise.all`), así que la cadena de reintentos retrasa —o con preempts repetidos, impide— la segunda pasada. Y el desfase es invisible: `progress()` cuenta `!needsAnalysis(...)`, que ya es false porque el interactivo escribió el store, así que **la UI muestra el barrido completo mientras el refinamiento no arranca nunca, sin ningún error**. Apretar "Analizar esta posición" durante un review es la forma normal de usar la pantalla, no un caso raro.

**Fix:** el guard de reencolado también chequea `needsAnalysis(node.id, visits)`. Si alguien más ya cubrió el nodo, se recomputa el reporte y se resuelve en vez de reintentar. Las dos ramas (disposed / cubierto) se mantienen SEPARADAS a propósito: tras `dispose()` no hay a quién reportarle, mientras que un nodo cubierto por otro sí trae un dato nuevo para el reporte.

**Verificado en las dos direcciones** (un test que pasa con y sin el fix no prueba nada): con el fix revertido a mano, el test nuevo falla por **timeout de 5 s** — `await startPromise` cuelga, que es exactamente el síntoma descrito. Restaurado, verde. Suite: 786 tests (120 + 622 + 44).

Efecto colateral documentado en el propio test #8 ("Finding 1"): ese escenario ya no llega al reintento, así que sus asserts siguen valiendo pero dejaron de ejercitar el camino "el reintento se asienta y su escritura es un no-op". Ese guard de escritura queda como defensa en profundidad.

## RESULTADO DEL IPHONE 12 — la premisa del plan era FALSA (2026-07-26)

Volcado de `/diagnostico` en el iPhone 12 de Edgar, en producción. **El dispositivo tiene iOS 18.7.8, no iOS 26**, y la prueba fue en **Chrome iOS 150** (CriOS). `navigator.gpu: no` en los DOS scopes, `adapter/device: unsupported`, sondeo de 0 ms.

**La causa está confirmada y no es el hardware.** En iOS todos los navegadores usan WebKit, y de ahí el plan concluyó que "Chrome y Safari en el iPhone son una sola señal, no dos". **Eso era falso en el detalle que importaba:** Chrome, Edge y Firefox en iOS corren sobre **WKWebView**, y las feature flags de Safari no lo alcanzan. Un ingeniero de Apple en los foros oficiales (developer.apple.com/forums/thread/770862): *"these feature flags only impact Safari and not WebKit generally. For WKWebView, the feature will work when its enabled by default"* + *"Can you please try on the iOS 26 beta? WebGPU is enabled by default there."* WebGPU llegó a Safari iOS por defecto en **18.2** (según versión, tras la flag de Ajustes → Safari → Avanzado → Funciones experimentales) y a WKWebView recién en **iOS 26**.

**Corolario metodológico:** probar Chrome en un iPhone NO descarta Safari. Son dos señales distintas para WebGPU, en el mismo dispositivo y el mismo día.

### Lo que el volcado MATA de la Fase 3 (asunciones del plan que ya no hay que trabajar)

- **La cuota no es un problema:** 41,2 GB libres. Los 223,8 MB de las dos redes entran de sobra; el aviso de cuota corta nunca va a dispararse en este aparato.
- **`numThreads` no necesita heurística de dispositivo:** iOS reporta `hardwareConcurrency: 4` (el A14 tiene 6 núcleos, pero el navegador ya lo acota). `Math.min(8, 4)` ya es 4 — la preocupación del plan sobre "hasta 8 en un A14" no existe.
- **COOP/COEP funcionan en iOS:** `crossOriginIsolated: sí` y `SharedArrayBuffer: sí` en AMBOS scopes. Es la mejor evidencia hasta ahora de que la Rama B (WASM + red chica) es viable si alguna vez hace falta: el WASM tendría hilos de verdad.
- El service worker funciona perfecto (`activated`, controla la página, sin versión esperando) → la Fase 1 aterrizó bien en el iPhone.

### Lo que sigue ABIERTO

- **¿Safari en iOS 18.7.8 expone `navigator.gpu` por defecto, o hace falta la feature flag?** Las fuentes se contradicen justo en eso, y no se resuelve buscando más: se resuelve con el dispositivo. Pedido a Edugar en una sola vuelta: abrir `/diagnostico` en **Safari** y, si da `no`, activar Ajustes → Safari → Avanzado → Funciones experimentales → WebGPU y repetir.
- **`persistente: no` con `modo de display: browser`.** En iOS, `persist()` normalmente exige que el sitio esté agregado a la pantalla de inicio. Si el motor llega a correr ahí, 115,8 MB de pesos pueden ser desalojados entre sesiones → conviene instalar la PWA antes de la prueba real (y eso además ejercita el camino de actualización que se construyó en la Fase 1).
- **El issue de ORT JSEP (#26827) es sobre Safari 26.** Si Safari 18.7.8 tuviera WebGPU, la prueba correría sobre un build que el issue no cubre — buena noticia para un primer intento, pero un éxito ahí NO es evidencia de que el camino de iOS 26 esté limpio.
- **La Fase 3 sigue SIN decidir**, y ahora tiene una tercera posibilidad que el plan no enumeraba: que funcione en Safari y esté roto sólo en Chrome iOS → no hace falta ningún fallback, sólo guiar bien. La conversión de b10 es el trabajo más incierto de todo el plan; gastarlo antes de esa lectura sería el error caro.

### Entregado ya, porque NO era especulativo (commit siguiente)

El cartel del gate decía "abre esta página en Chrome o Edge", que en un iPhone es **el consejo contrario al correcto**. `diagnostics/webGpuAdvice.ts` (puro, 7 tests) lo parte por plataforma Y por navegador: en iOS manda a Safari y aclara que no es limitación del hardware, nombrando la versión real; si YA estás en Safari por debajo de iOS 26, manda a la feature flag; en iOS 26+ no culpa al navegador (ahí cualquiera sirve, así que el fallo sería información nueva); fuera de Apple, el texto de siempre. Se lee el UA en el punto de PRESENTACIÓN (`NoWebGpu` en `main.tsx`), nunca dentro de `detectWebGpu()`: el gate sigue siendo un gate. Verificado en Chrome con el UA real del iPhone 12 emulado: el consejo que saldría es el correcto, con "18.7.8" y "WKWebView" en el texto. `CLAUDE.md` actualizado en el mismo commit (su línea "Sin WebGPU → mensaje 'usa Chrome/Edge'" acababa de dejar de ser cierta).

### DEPLOY de Fase 4 + cartel device-aware — HECHO Y VERIFICADO (2026-07-26, Version `a98d9cbd-f60a-4618-bd6d-955453a25d2e`)

Los 3 commits locales (`58a0d14` dos pasadas · `c23a4b4` fix del preempt · `a1fd3b3` cartel device-aware) fueron juntos, con OK explícito de Edgar vía AskUserQuestion — el build sale de `main`, así que no eran separables sin ensuciar el historial. BUILD_ID desplegado: `a1fd3b3 · 2026-07-26 06:06 UTC`.

Verificado en el bundle real servido por producción (`index-CgzUg8b-.js`): el consejo nuevo está (`WKWebView` presente) y las etiquetas de las dos pasadas también (`{sweep:"Repasando",refine:"Afinando errores"}`).

**Dos falsas alarmas descartadas en la verificación, anotadas para no repetirlas:** (1) un `grep -c "Afinando errores"` sobre un `curl` en pipe dio 0, pero el mismo string aparece al descargar el archivo completo — no confiar en dos `curl` separados dentro de un mismo comando para comparar contenido. (2) los greps contra `apps/web/dist/` daban 0 porque el shell de Bash **conserva el `cd`** del deploy (`apps/worker`) entre llamadas: usar rutas absolutas o re-`cd` explícito.

### El diagnóstico decía qué pasa, pero no qué hacer (2026-07-26)

Segundo volcado del iPhone 12: build `a1fd3b3` (el deploy llegó bien) pero **otra vez desde Chrome iOS**. La causa observada, no supuesta: a `/diagnostico` se llega por su URL directa —es lo que uno pega en un chat— y el consejo corregido vivía SÓLO en el cartel del gate (`NoWebGpu`), que aparece al abrir la app en `/`. Entrando derecho al diagnóstico, ese consejo nunca se ve: la pantalla dice "este dispositivo no puede correr el motor" y deja al lector sin siguiente paso. Pasó dos veces con el mismo teléfono.

Fix: `DiagnosticoView` pinta `webGpuAdvice(data.userAgent)` bajo el veredicto cuando el veredicto es negativo. Reusa el `UserAgentSummary` que el recolector ya trae — cero recolección nueva. Verificado en el navegador con el UA exacto del iPhone 12 de Edgar: el consejo que se pinta es "En iPhone y iPad, abre esta página en Safari" + la explicación de WKWebView con la versión real.

**Lección de diseño para pantallas de diagnóstico:** el consejo tiene que vivir donde se lee el problema, no en la pantalla de la que uno viene. Una pantalla a la que se llega por URL directa no hereda el contexto de ninguna otra.

## SAFARI EN iOS 18.7.8 SÍ TIENE WEBGPU — y el motor crashea jugando (2026-07-28)

Edgar probó en Safari: **funciona**. El iPhone 12 no está descartado; el hardware puede. Pero **crashea jugando y el teléfono se recalienta**.

### Las tres respuestas que acotan el diagnóstico (AskUserQuestion)

- **Fuerza baja (50 visitas/jugada)** — el preset MÁS BAJO. Esto es lo que descarta la explicación fácil: 50 inferencias por jugada no son un presupuesto excesivo, así que el calor y el crash no son "el costo honesto de un motor client-side".
- **Muere tras VARIAS jugadas** — crecimiento con el uso, no un pico inicial.
- **"No se carga, debo recargarla manualmente; a veces se recarga sola; otras da error"** — la recarga espontánea es iOS matando el proceso.

Los tres juntos son la firma de una **fuga de memoria**, no de un dispositivo lento.

### Lo que se DESCARTÓ leyendo código (no adivinando)

- **No es una sesión ONNX por jugada.** `LocalEngine.init()` corre una vez (vía `ensureReady`→`reconcile`, idempotente); los 115,8 MB van a la GPU una sola vez por partida. Era el peor caso posible y no es.
- **No es una fuga de tensores nuestra.** Sin `preferredOutputLocation`, ORT devuelve los outputs en CPU: son TypedArrays de JS que libera el GC. Verificado en los tipos del paquete instalado (`onnxruntime-common`, `tensor.d.ts`: *"If the data is on CPU, remove its internal reference… If the data is on GPU, release the data on GPU"*). Llamar `dispose()` sería higiene, no la causa raíz.

Queda como principal sospechoso el bug conocido de ORT en modo JSEP sobre Safari (**microsoft/onnxruntime#26827**, memoria creciendo hasta matar el proceso; reportado para 1.20–1.23.2, el repo está en **1.27.0**). Pero eso NO se confirma leyendo: hay que medirlo.

### La medición que nunca existió

**Todo número de rendimiento de este proyecto venía del M1 de fase 0.** Cada afirmación sobre el teléfono en esta conversación (incluida una tabla de tiempos por jugada) extrapolaba con un factor 5× **inventado**. Nadie midió una sola inferencia en ese iPhone.

`diagnostics/engineProbe.ts` + `engineVerdict.ts`: botón "Probar el motor" en `/diagnostico` que corre **6 tandas idénticas de 20 visitas** con el motor REAL (mismo Worker, misma sesión, mismo MCTS — el camino que falla, no una aproximación) y mide cada una. Tandas iguales, así la única variable que queda es el estado del dispositivo:

- **estables** → no hay fuga; es lento y punto, y la respuesta es presupuesto o red más chica.
- **alargándose** (≥1,5× entre la primera y la segunda mitad) → algo crece, y bajar visitas sólo retrasaría el crash.
- **muere a mitad** → cuántas tandas aguantó ES el dato.

**Y persiste cada tanda en localStorage antes de avisar a la UI.** Sin eso, el escenario que se investiga —el proceso muere y se lleva el DOM— sería el único que no dejaría rastro. Al reabrir la pantalla, una corrida con `finished: false` se muestra como "la prueba anterior se cortó sola" con las tandas que alcanzó. El crash pasa de borrar la evidencia a ser parte de ella.

**Verificado con el motor real en Chrome/M1:** arranque 2.636 ms, 6 tandas, **2,9 visitas/s de promedio, sin desaceleración (1,02×)** → veredicto "velocidad estable". Ese es además el primer número de visitas/s del proyecto medido a través del pipeline completo (MCTS incluido), no sólo de inferencia suelta.

**Gates:** typecheck limpio · 809 tests (120 + 645 + 44) · build OK. 16 tests nuevos sobre el veredicto y la persistencia — la separación "fuga vs lento" decide un desvío caro (convertir b10), así que va fijada con tests y no a criterio de quien mire los números.

**Pendiente:** que Edgar corra la prueba en Safari del iPhone 12 y pegue el resultado. Recién ahí se decide si la Fase 3 es ajuste (Rama A) o red más chica (Rama B).

## SAFARI 26.5.2 SOBRE iOS 18.7 — el umbral no era el que yo creía (2026-08-03)

Volcado de Safari en el iPhone 12: **WebGPU funciona** (adapter ok + device ok en los dos scopes, b18 ya en caché, 144,6 MB de uso). Pero el UA trae el dato que corrige el modelo mental:

```
navegador: Safari 26.5.2     iOS: 18.7
```

**La versión de Safari y la del sistema son independientes.** Safari 26.5.2 corre sobre iOS 18.7, y ahí WebGPU está por defecto. Lo que manda:
- Para **Safari** → la versión de **Safari** (26+).
- Para **Chrome/Edge/Firefox en iOS** → la versión del **sistema**, porque WKWebView lo trae el sistema (26+).

`webGpuAdvice.ts` tenía UN umbral (`iOS >= 26`) para las dos cosas, así que a alguien con Safari 26 sobre iOS 18 —exactamente este teléfono— le habría dicho "actualiza a iOS 26", mandándolo a hacer algo que no cambia nada. Ahora son dos constantes separadas (`IOS_WEBGPU_ALL_BROWSERS` y `SAFARI_WEBGPU_DEFAULT`), `summarizeUserAgent` expone `browserVersion` para poder comparar, y el UA real del iPhone 12 quedó como caso de test.

### Otro hueco encontrado: la evidencia del crash se veía pero no se copiaba

La corrida interrumpida se mostraba en pantalla ("La prueba anterior se cortó sola") pero **no entraba en el volcado**. Quien reporta pega el volcado —que es el propósito entero de la pantalla— así que el dato más importante se quedaba en el teléfono. Corregido: al montar, si hay una corrida con `finished: false`, sus tandas se publican en el volcado con su marca de tiempo.

### Datos nuevos del dispositivo (Safari, no Chrome)

- `maxBufferSize` / `maxStorageBufferBindingSize`: **1,07 GB** (contra 4,29 GB en el M1). No es limitante para un modelo de 115,8 MB, pero es el techo real si alguna vez se evalúa una red más grande.
- `features`: **sin** `subgroups` ni las `texture-compression-bc`; **sí** `shader-f16`, `float16-renderable`, `float32-renderable`. Menos features que Metal-3 de escritorio, ninguna que el motor use hoy.
- `adapter.info` viene enmascarado (`vendor=apple · arch=apple · device=apple · desc=apple`): Safari no revela el modelo de GPU.
- `hardwareConcurrency: 4` y `crossOriginIsolated: sí` en los dos scopes, igual que en Chrome iOS.
- `persistente: no` con `modo de display: browser` — sigue pendiente instalar la PWA a la pantalla de inicio antes de una prueba larga.

**LO QUE SIGUE FALTANDO: la prueba del motor.** El volcado llegó sin la sección `[prueba del motor]`, así que o no se apretó el botón o murió antes de la primera tanda (que ahora sí quedaría registrado, tras el fix del volcado).

### El UA de Safari MIENTE sobre la versión de iOS — y el "18.7" prueba lo contrario de lo que parece

Edgar preguntó por qué el diagnóstico decía iOS 18.7 si su iPhone está más actualizado. Tenía razón, y la respuesta invierte una conclusión previa de este mismo ledger.

**Desde iOS 26, Safari dejó de publicar la versión del sistema y la fija en `18_7` para siempre** (anti-fingerprinting; [firefox-ios#29263](https://github.com/mozilla-mobile/firefox-ios/issues/29263), [Broadcom sobre Safari 26](https://knowledge.broadcom.com/external/article/411222/risk-authentication-data-collection-impa.html)). O sea: **ver exactamente "18.7" junto a un Safari 26+ es evidencia de que el sistema es iOS 26 o SUPERIOR**, no de que sea viejo. Es el mismo truco que Safari de escritorio hace hace años con "Mac OS X 10_15_7" (Catalina, 2019) — y ese valor estaba en TODOS los volcados de Chrome/M1 de esta sesión, delante de los ojos, sin que lo notara.

**Consecuencia sobre lo ya escrito:** la afirmación de que el iPhone 12 "tiene iOS 18.7.8, no 26" se apoyaba en el UA. Para el volcado de **Chrome iOS** (que dijo `18_7_8`, tres componentes) sigue siendo probablemente cierta —ese no es el valor congelado y Chrome no tenía WebGPU, lo que encaja con iOS < 26—. Para el de **Safari** (`18_7` exacto + `Version/26.5.2`) es falsa: ese aparato corre iOS 26+. Lo más plausible es que Edgar haya actualizado entre el 26 de julio y el 3 de agosto. **Verificación cruzada pendiente y trivial: si Chrome iOS ahora funciona, confirma iOS 26.**

**Arreglado:** `summarizeUserAgent` expone `iosVersionFrozen`, que se reconoce por la COMBINACIÓN (valor "18.7" exacto + Safari ≥26) y no por el número suelto — un iPhone que de verdad corre iOS 18.7 lleva un Safari 18.x y no cae ahí. El volcado ahora escribe "iOS: 26 o superior (Safari congela el UA en 18.7; la versión real no se publica)" y el consejo nunca repite el número falso. 4 tests nuevos fijan la lectura, incluido el UA real del iPhone 12 y el contraejemplo del iOS 18.7 auténtico.

**Lección de método:** un dato que el dispositivo REPORTA no es un dato que el dispositivo TENGA. El diagnóstico vale por lo que mide (adapter, device, cuota, tandas), no por lo que le declaran — y donde no puede distinguir, tiene que decirlo en vez de presentar la declaración como hecho.

## MEDICIÓN REAL DEL IPHONE 12 — el crash está confirmado y NO es lentitud (2026-08-03)

Primera medición del motor en el dispositivo, con Safari sobre iOS 26 (el UA congelado ya se lee bien). **La corrida murió y el mecanismo de persistencia la capturó** — el volcado llegó con la sección que el crash habría borrado:

```
corrida anterior INTERRUMPIDA (2026-08-03T01:52:40.815Z) — el proceso murió sin terminar
arranque del motor: 5472 ms
tanda 1: 20 visitas en 18306 ms (1.1 visitas/s)
```

El volcado se copió a las 01:52:46, seis segundos después del último registro: **el proceso murió durante la tanda 2**, o sea entre la inferencia 21 y la 40.

### Los números, contra el M1

| | M1 (Chrome) | iPhone 12 (Safari 26) | Relación |
|---|---|---|---|
| Arranque del motor | 2.636 ms | 5.472 ms | 2,1× |
| Tanda de 20 visitas | 6.168 ms | 18.306 ms | 3,0× |
| Velocidad | 3,2 visitas/s | **1,1 visitas/s** | 2,9× |
| Tandas completadas | 6 de 6 | **1 de 6** | — |

**El factor real es 2,9×, no el 5× que yo venía extrapolando** — y la extrapolación estaba en el orden correcto pero pesimista. Más importante: **a 1,1 visitas/s el motor SERÍA usable**. Con el preset bajo (50 visitas) una jugada tomaría ~45 s, lento pero jugable para Go casual.

### El veredicto que separa los dos trabajos

**No es un problema de velocidad. Es que muere.** Veinte inferencias seguidas y el proceso no sobrevive a las siguientes veinte.

**Pero CUIDADO con el paso siguiente: lo confirmado es que muere, no POR QUÉ.** Un solo dato más una muerte encajan con dos mecanismos distintos, y llevan a arreglos distintos:

- **Acumulación (fuga):** algo crece por inferencia hasta cruzar el límite.
- **Techo (working set):** nada crece; el conjunto de trabajo simplemente no entra bajo el límite por pestaña de Safari, y la primera tanda lo roza mientras la segunda lo cruza.

Con una fuga, achicar el modelo sólo corre el crash más adelante; con un techo, achicarlo ES el arreglo. Justo la decisión más cara del plan (convertir b10) depende de cuál sea, así que no se decide con este dato.

**La medición que los separa es barata:** repetir con tandas de 5 visitas en vez de 20. Si muere alrededor de la misma cuenta ACUMULADA de inferencias (~30-40) sin importar cómo se agrupen, es acumulación. Si sobrevive muchas tandas chicas y sólo muere con las de 20, es un pico por tanda — un techo.

**Por qué en una partida real aguanta más que en la prueba:** la prueba corre las tandas SEGUIDAS, sin pausa. En una partida hay pausas mientras el humano piensa, y eso le da al sistema tiempo de recuperar. Coherente con acumulación, no con un techo fijo.

### Lo que esto vale como método

La herramienta hizo las tres cosas para las que fue construida, en su primera corrida real:
1. **Midió** en vez de extrapolar (el 5× era invención mía).
2. **Distinguió** lento de con-fuga — que era el punto entero, porque mandan a trabajos muy desiguales en costo.
3. **Sobrevivió al crash**: sin persistir cada tanda antes de dibujarla, este volcado habría llegado vacío y estaríamos igual que hace una semana.

### El experimento que separa acumulación de techo (2026-08-03)

**Dato del dispositivo que faltaba: es un iPhone 12 Pro MAX — 6 GB de RAM**, no los 4 GB del 12 base (mismo A14, así que la velocidad no cambia). El diagnóstico no puede detectarlo solo: Safari enmascara `adapter.info` con "apple" en los cuatro campos. Que muera con 6 GB deja bastante incómoda la hipótesis del techo simple, pero no la descarta — Safari impone su propio límite por pestaña, independiente de la RAM total.

La prueba pasa a tener **reparto configurable** (`PROBE_PRESETS`), y esa es toda la razón de su existencia:

- **Normal**: 6 tandas × 20 visitas = 120 inferencias.
- **Fina**: 12 tandas × 5 visitas = 60 inferencias.

Los totales son comparables a propósito (fijado con test, ≤2× de diferencia): si un reparto midiera mucho menos trabajo, "sobrevivió" no significaría nada. Y cada tanda del volcado ahora lleva el **acumulado** de inferencias, que es la variable a comparar entre corridas — sin eso habría que sumar a mano.

**Cómo se lee el resultado:** si muere cerca del mismo acumulado (~30-40) con los dos repartos → algo crece. Si aguanta las 12 tandas finas y sólo muere con las de 20 → es el pico de una tanda, no acumulación.

Corregido de paso: el mensaje de la corrida interrumpida afirmaba "algo crece con el uso" —justo lo que NO está determinado— y citaba un total de tandas fijo que ya no aplica. Ahora informa el acumulado real, el total pedido (que se persiste en `StoredProbe.totalRounds`) y propone repetir con el otro reparto, sin adelantar el veredicto.

### La corrida FINA murió antes de completar 5 inferencias — y eso no encaja limpio con ninguna hipótesis

Segunda medición, reparto fino (12×5):

```
corrida anterior INTERRUMPIDA (2026-08-03T02:01:54.237Z) — el proceso murió sin terminar
arranque del motor: 6862 ms
```

Ni una tanda de **5** completada. Contra la corrida anterior, que sobrevivió una tanda de **20**.

**Eso rompe las dos hipótesis en su forma limpia.** Con acumulación pura, tandas de 5 deberían haber llegado a ~6-8 tandas antes del mismo acumulado; con techo puro, las tandas chicas deberían sobrevivir indefinidamente. Ninguna de las dos predice "murió antes que la vez anterior con tandas cuatro veces más chicas".

Lo que sí queda: **el margen tras cargar el modelo es mínimo y VARIABLE entre corridas**. El arranque también empeoró — 6.862 ms contra 5.472 ms, un 25% más lento pidiendo lo mismo. El dispositivo no vuelve a su estado inicial entre corridas (memoria del proceso anterior sin liberar, GPU ocupada, o throttling térmico acumulado), así que cada intento arranca en peores condiciones que el anterior.

**Hipótesis que esto favorece y que antes estaba descartada:** el problema está dominado por el **pie de memoria del modelo** (115,8 MB fp32 → JS heap + heap WASM + GPU), no por lo que pasa después. Si el margen post-arranque es de entre 1 y 40 inferencias según cómo esté el aparato, entonces achicar el modelo SÍ sería el arreglo — o sea, la Rama B vuelve a la mesa por un camino distinto del que la había traído.

### Lo que Edgar pidió, y por qué es lo correcto

> "necesito que el test haga prueba sobre humansl y kata debil"

Tiene razón y apunta al hueco de producto: la prueba medía `b18` a 20 visitas, que **no es lo que él juega**. Ahora hay dos ejes:

- **Red**: KataGo (`b18`) / Human SL (`humanv0`) — las dos del producto. Si la red elegida falta, la prueba **la descarga** (mandar a "jugá una partida primero" para poder medir por qué las partidas mueren es un círculo, y este es justo el dispositivo donde no cierra).
- **Reparto**: Fina (12×5) · Normal (6×20) · **Jugada real (3×50)** — 50 visitas es EXACTAMENTE una jugada del preset "Fuerza baja", fijado con un test contra `KATA_STRENGTH_PRESETS[0].visits` para que no puedan divergir. Tres tandas son tres jugadas de la IA: si eso no sobrevive, no hay partida posible y no hace falta ninguna otra medición.

**Lo que cambiar de red NO mide:** el efecto del tamaño. `humanv0` pesa 108,0 MB contra 115,8 MB — misma arquitectura, mismo orden. Sirve para saber si el fallo es del pipeline (mueren las dos) o de una red concreta. Para medir el efecto del TAMAÑO haría falta una red chica, y b10 sigue sin convertir.

### Tercera corrida: murió EN EL ARRANQUE. El patrón es degradación monótona (2026-08-03)

Con Human SL (descargada por la propia prueba — `uso` pasó de 144,6 a 252,6 MB, y `humanv0: en caché` lo confirma):

```
corrida anterior INTERRUMPIDA (2026-08-03T02:10:28.436Z) — el proceso murió sin terminar
(sin datos)
```

**"(sin datos)" = ni `initMs`.** Murió durante `ensureReady`, cargando el modelo en la GPU, sin llegar a una sola inferencia.

### El patrón, con las tres corridas juntas

| # | Red | Reparto | Arranque | Aguantó |
|---|---|---|---|---|
| 1 | b18 | 6×20 | 5.472 ms | 1 tanda (20 inferencias), murió en la 2ª |
| 2 | b18 | 12×5 | 6.862 ms | ni una tanda de 5 |
| 3 | humanv0 | 3×50 | **nunca terminó** | ni el arranque |

**Degradación monótona: cada corrida aguanta menos que la anterior.** El arranque se encareció un 25% entre la 1 y la 2, y en la 3 directamente no completó. **El dispositivo no vuelve a su estado inicial entre corridas**, ni siquiera con el proceso muerto y la página recargada de por medio.

### Qué queda establecido, y qué NO

**Establecido:** el fallo no es "cuántas inferencias aguanta" — es que el estado se degrada y no se recupera. Un umbral fijo de inferencias no existe: la corrida 1 hizo 20 y la 3 no hizo ninguna, con el mismo dispositivo y el mismo binario.

**NO establecido:** qué exactamente no se libera. Candidatos que quedan vivos: memoria GPU que WebKit no devuelve al morir el proceso, el pie base del proceso (shell + 26,8 MB de WASM de ORT + modelo) demasiado cerca del límite por pestaña de Safari desde el arranque, o el doble buffer de carga (`appFactory.ts` materializa el ONNX completo en un ArrayBuffer que ORT después copia a su heap WASM — pico de 2× sobre 108-116 MB antes de tocar la GPU).

**Y esto sí decide algo:** morir CARGANDO el modelo, antes de inferir, es evidencia directa de que el problema está dominado por el **pie de memoria del modelo**, no por lo que pasa después. La Rama B (red más chica) deja de ser una apuesta y pasa a ser la hipótesis con más respaldo — por un camino distinto del original, que la justificaba por velocidad.

**Suficiente medición.** Cinco diagnósticos pedidos a Edgar; el instrumento ya dio lo que podía dar con este binario. Seguir midiendo sin cambiar nada sería una cinta de correr.

### CORRECCIÓN: no hay degradación monótona, y el motor ACELERA (corrida 4, 2026-08-03)

Cuarta corrida, b18 con reparto normal (6×20):

```
arranque del motor: 7036 ms
tanda 1: 20 visitas en 22221 ms (0.9 v/s) · acumulado 20
tanda 2: 20 visitas en 15355 ms (1.3 v/s) · acumulado 40
tanda 3: 20 visitas en 12870 ms (1.6 v/s) · acumulado 60
tanda 4: 20 visitas en 17373 ms (1.2 v/s) · acumulado 80
desaceleración última mitad / primera mitad: 0.80×
```

**Dos correcciones a lo escrito arriba, las dos importantes:**

1. **El motor NO se frena: se acelera.** 0,80× significa que la segunda mitad va MÁS RÁPIDO que la primera — la tanda 1 es la más lenta de todas (22,2 s) y después baja a 12,9. Es el patrón normal de un motor calentando caches y shaders compilados. **La hipótesis de "algo se degrada progresivamente" queda descartada por medición.**
2. **La "degradación monótona" era un artefacto de tres puntos.** Esta corrida completó **80 inferencias**, la mejor de las cuatro, y vino justo DESPUÉS de la peor (la que murió en el arranque). El orden decreciente 20 → <5 → 0 era casualidad.

**El patrón real: supervivencia ERRÁTICA entre 0 y 80 inferencias**, con el mismo binario y el mismo dispositivo. Eso no es una fuga con tendencia ni un techo fijo: es un proceso que vive cerca del límite y muere cuando el sistema decide, según presión externa que no controlamos (otras apps, estado térmico, humor del allocator).

Velocidad estable en ~1,2 visitas/s cuando corre.

### El arreglo barato NO existe: verificado en el código de ORT instalado

La sospecha era el doble buffer de `appFactory.ts` (`readArrayBuffer` materializa el ONNX completo en un `ArrayBuffer` de JS y ORT lo copia a su heap WASM: ~232 MB vivos a la vez). La pregunta era si ORT 1.27 admite una carga sin copia. **No, para este tamaño.** En `ort.min.mjs`:

```js
if (r < 1073741824) return new Uint8Array(await t.arrayBuffer());
```

El camino de streaming (leer por chunks a un `ArrayBuffer` preasignado) sólo se activa para archivos de **1 GB o más**. Con 115,8 MB caemos siempre en `arrayBuffer()`. Y el `else` final hace lo mismo con un `Blob`. Así que **da igual pasar OPFS→ArrayBuffer, una URL, o un Blob: el pico de 2× es inherente a la API con un modelo de este tamaño.**

**Consecuencia:** el único camino que reduce ese pico es **un modelo más chico**. b10c128 bajaría el pico de ~232 MB a ~40 MB y además correría bastante más rápido que 1,2 v/s. Es el trabajo más incierto del plan (falta convertirla), pero ya no es una apuesta por velocidad: es la única palanca que queda sobre el pico de carga.

## EL BUG DEL fp16, LOCALIZADO (2026-08-03)

Edgar propuso servir fp16 en móvil y fp32 en escritorio. La arquitectura (modelo por dispositivo) es la correcta; el vehículo tenía un asterisco: **los fp16 ya convertidos están rotos** (`CLAUDE.md`, corrección del 2026-07-10 — policy NaN, el motor juega la esquina 1-1). Esta sesión averiguó POR QUÉ, que era lo que faltaba para saber si es reparable.

### Lo que se descartó, en orden

1. **No es overflow al convertir los pesos.** Los 476 initializers fp16 del ONNX no tienen ni un `inf` ni un `NaN` (inspeccionados con onnx/numpy).
2. **No es la conversión fp16 propia del motor.** `f32ToF16`/`f16ToF32` (`packages/engine/src/f16.ts`) coinciden **bit a bit** con `Float16Array` nativo en 15 casos, incluidos los bordes duros: 65505→65504, 1e5→Infinity, subnormales (1e-5, 6.1e-5), negativos. Cero diferencias.
3. **No es el modelo per se, ni ORT.** Con un input SINTÉTICO (canal 0 en 1, el resto en cero), el fp16 corre limpio en WASM/Node y elige **exactamente la misma jugada** que el fp32: policy sin NaN, rango [-8.367, 3.709] contra [-8.365, 3.704], mejor vertex (14,15) en ambos. Diferencia de 0,005 — ruido de precisión.

### Lo que SÍ es: depende del INPUT

Con los features V7 **reales** (fixture `empty-19`, encoder del motor), el mismo modelo fp16 da:

```
fp32:  policy NaN=0    rango [-5.436, 4.647]   value NaN=0
fp16:  policy NaN=325  (de 361)                value NaN=1
```

O sea: el desbordamiento ocurre en las **activaciones intermedias** durante la inferencia, no en los pesos, y sólo cuando la entrada tiene señal de verdad. Un input casi vacío no lo dispara; los 22 canales poblados del encoder V7, sí.

### Por qué es plausible que sea reparable

El conversor (`~/dev/vendor/katago-onnx`, `_convert_to_fp16_native`) hace una conversión **ciega y total**:

```python
arr_fp16 = arr.astype(np.float16)   # todos los pesos, sin exclusiones ni saturación
```

y su propio docstring admite que reemplaza a la herramienta estándar: *"This is an alternative to onnxconverter_common that produces cleaner graphs."* Justamente `onnxconverter_common.float16.convert_float_to_float16` aporta las tres cosas que faltan: `op_block_list` (dejar en fp32 los operadores que desbordan), saturación de valores fuera de rango, e inserción de los `Cast` en las fronteras. Y `auto_mixed_precision` va más lejos: prueba capa por capa cuáles toleran fp16 y deja el resto en fp32, automáticamente.

**Camino concreto:** reconvertir con precisión mixta en vez de fp16 total. Resultado esperado: ~60-70 MB (algo más que los 56 del fp16 puro, la mitad de los 110 del fp32) **con la fuerza completa de b18**, que es mejor que b10c128 en calidad de juego.

### Cambio conservado de esta investigación

`packages/engine/tests/nn.reference.test.ts` acepta `TENGEN_NN_MODEL` para apuntar el gate de referencia a OTRA variante del mismo modelo sin duplicar el harness. Sin variable, mide exactamente lo de siempre (el fp32 del producto). Es lo que permitió correr los 10 fixtures contra el fp16 y confirmar que fallan los 10 — y será lo que valide la reconversión.

## EL fp16 ESTÁ ARREGLADO — precisión mixta, 10/10 en el gate de referencia (2026-08-03)

Edgar propuso servir fp16 en móvil y fp32 en escritorio, y aportó desde otra conversación el detalle de `keep_io_types=True`. Con eso más el diagnóstico anterior, la reconversión funcionó.

**`packages/engine/models/b18c384nbt-kata1.mixed16.onnx` — 110,0 MB → 55 MB, y `TENGEN_NN_MODEL=... npm run -w @tengen/engine test:nn` da 10/10** contra los vectores `kata-raw-nn` de KataGo desktop. Misma red, misma fuerza, la mitad del peso.

### Las tres decisiones, y cómo se llegó a ellas

Ninguna salió de leer documentación: salieron de que el error se movía.

1. **`keep_io_types=True`** (aporte de Edgar vía Gemini). Entradas y salidas siguen en fp32. Beneficio extra que no estaba en la propuesta: `OnnxEvaluator` deja de necesitar `f32ToF16` por inferencia.
2. **Vaciar `graph.value_info`.** Primer error: *"Type (tensor(float16)) of output arg (.../gpool/Cast) does not match expected type (tensor(float))"*. El `value_info` declara los tipos de los tensores INTERMEDIOS, escritos cuando el grafo era fp32; la conversión no los reescribe todos y ORT se niega a crear la sesión. Vaciarlo (1.528 entradas) deja que ORT infiera los reales.
3. **`node_block_list` con TODO el subgrafo `gpool`** (229 nodos). Acá estuvo la lección: bloquear operadores de a uno movía el error al siguiente nodo del MISMO bloque — `Cast` → `Div` → `Concat`, todos bajo `.../convpool/gpool/`. El global pooling de KataGo mezcla reducciones, divisiones por constantes y concatenaciones, y convertirlo a medias siempre deja una frontera mal tipada. Dejarlo entero en fp32 cuesta 229 nodos de un modelo de 55 MB y es lo que hace que cargue.

**Conservado en `packages/engine/scripts/convert-mixed16.py`**, con las tres decisiones documentadas y el comando del gate en el propio docstring. Herramienta local, no del producto. Requiere `onnx` + `onnxconverter-common` en un venv (el entorno pixi de katago-onnx no trae pip).

### Estado de cada red

| red | fp32 | mixed16 | gate |
|---|---|---|---|
| b18 kata | 110 MB | **55 MB** | **10/10 fixtures** ✅ |
| humanv0 | 103 MB | **52 MB** | convertido, **SIN validar** ⚠️ |

`humanv0` se convirtió con el mismo script (mismos 229 nodos gpool — misma arquitectura), pero **su validación queda pendiente**: los fixtures `kata-raw-nn` son de la red KATA, así que el gate no aplica tal cual. Necesita su propia comparación fp32 vs mixed16 sobre el mismo input con `meta_input[192]`, que es lo que faltó armar. **No dar por buena esa red hasta medirla.**

### Lo que esto cambia del plan móvil

El pico de carga (inherente a ORT, que sólo streamea archivos ≥1 GB) baja de **~232 MB a ~110 MB** con el mismo modelo y la misma fuerza de juego. **b10c128 deja de ser necesaria** salvo que la mitad no alcance: no hay que convertir una red nueva ni degradar cómo juega la IA. Lo que queda por construir es exactamente lo que Edgar propuso — el perfil por dispositivo — más subir los mixed16 a R2 y añadirlos al manifest.

Pendiente antes de servirlos: validar humanv0, medir velocidad (el fp16 podría ser más rápido en la GPU del A14, que declara `shader-f16`), y el gate manual en WebGPU real — el gate de referencia corre en WASM/Node.

---

## Human SL validado y los mixtos servidos por dispositivo (2026-08-03)

Cierra la entrada anterior: humanv0 quedó **validado** y las dos redes se sirven por perfil de
dispositivo. Commits `129e959` (implementación) y `aec31a9` (arreglo del alcance de la limpieza).

### Corrección de la tabla anterior

Los tamaños de la entrada previa estaban redondeados hacia abajo. Los valores medidos con
`stat -f%z` —que son los que van al manifest, porque `ensureModel` rechaza ante UN byte de
diferencia— son:

| red | fp32 | mixed16 | ratio | validación |
|---|---|---|---|---|
| b18 kata | 115.800.125 | **58.093.573** | 50,2 % | **10/10 fixtures `kata-raw-nn`** ✅ (re-verificado, no heredado) |
| humanv0 | 108.040.143 | **54.194.233** | 50,2 % | **4/4 casos contra su propio fp32** ✅ |

### Cómo se validó Human SL, y por qué el criterio del plan medía la magnitud equivocada

`scripts/validate-humanv0-mixed.ts` compara la red contra su propia versión fp32 con el mismo input,
incluido el `meta_input[192]` — la ruta que b18 ni siquiera tiene y donde el fp16 ciego daba NaN.
Cuatro casos: tablero vacío y medio juego, 19×19 y 9×9, rangos 5k/5d/9d (el termómetro de rango
cambia el contenido de `meta_input`, así que un overflow podría depender de él).

El plan pedía "diferencia de logit del orden de 1e-2 o menor". Aplicado literalmente, un caso
FALLABA: `endgame @ 5k` daba 1,26e-2. Bajar el umbral para que pasara habría sido hacer trampa; la
salida correcta fue notar que **el logit crudo es la magnitud equivocada para esta red**.

Human SL no toma el argmax: `sampleHumanMove` MUESTREA con una temperatura que depende del rango
(0,85 en 20k → 0,30 en 9d). Una temperatura < 1 **divide** el logit, o sea que amplifica cualquier
diferencia en el exponente — un umbral sobre logits crudos es laxo y estricto a la vez según el
rango. La métrica que traduce a comportamiento es la **distancia de variación total**,
TV = ½·Σ|p−q|, que es exactamente la cota superior de la probabilidad de que las dos versiones
elijan jugadas distintas.

Con esa métrica, el caso "que fallaba" da TV = 1,08e-3: **eligen distinto el 0,11 % de las veces.**
El logit exageraba en un orden de magnitud lo que significaba en la práctica. Los 4 casos: cero NaN,
misma jugada, top-5 idéntico y en el mismo orden, TV máxima 1,08e-3, diferencia de probabilidad
post-softmax máxima 6,4e-4 (el gate de b18 tolera 0,06 contra otra implementación entera).

Dato secundario que confirma el mecanismo: el caso de **9d** (T=0,30) da la TV más baja de todas,
2,0e-5. Una temperatura baja concentra la masa en la mejor jugada, así que aplasta las diferencias
numéricas — la conversión es *más* segura justo en los rangos fuertes.

### El riesgo real de esta fase no era la conversión, era la divergencia

La variante hace falta en dos scopes que no comparten memoria: el hilo principal descarga
(`ModelGate` → `ensureModel`) y el worker lee de OPFS por `opfsName` (`appFactory`). Si resuelven
distinto, **el worker busca un archivo que nadie descargó** y el motor no arranca — sólo en los
dispositivos donde el criterio dé distinto, o sea invisible en desarrollo y seguro en producción.

Se cierra por construcción, no por convención: `currentModelVariant()` es el único punto que lee el
global, los dos lados la llaman **sin argumentos** (no hay input que se pueda pasar mal), y depende
sólo de `navigator.userAgent`.

**La trampa concreta que se evitó:** el plan proponía usar `summarizeUserAgent` con
`iPadOsSuspected`, que sale de `maxTouchPoints`. `WorkerNavigator` **no expone `maxTouchPoints`** →
en el worker daría `undefined ?? 0` → `false`. En un iPad: hilo principal mixto, worker fp32,
divergencia. Y `tsc` no lo agarra porque apps/web tipa `navigator` con la lib DOM. Costo aceptado:
un iPad disfrazado de Mac cae en fp32, que es lo que ya hace hoy.

### El eje de variante de la sonda, sin tocar `packages/engine`

El plan descartó pasar la variante por el `init` del worker porque cambiaría el contrato `Engine`.
Verificado: es cierto, cascadearía por `types.ts`, `protocol.ts`, `engine.ts` y `handler.ts`. Pero
hay una tercera vía que el plan no consideró — `apps/web/src/engine.worker.ts` es de la app y ya
posee su propio `addEventListener`, así que puede atender un mensaje propio
(`engine/variantMessage.ts`) y retornar antes de delegar en `createWorkerHandler`. El motor nunca lo
ve.

Dos detalles de los que depende que funcione: el mensaje viaja en la **closure** de la factory
(`() => createWorkerManagedEngine({ variant })`) porque `EngineManager` reconstruye el worker ante un
crash — con un `postMessage` suelto, el worker reconstruido volvería a la variante del dispositivo y
la corrida cambiaría de sujeto justo en el tramo donde el aparato empieza a fallar. Y la resolución
ahí es **estricta** (`requireManifestEntry`), al revés que en producción (`resolveManifestEntry`, con
fallback a fp32): un fallback silencioso rotularía "mixto" una medición del fp32, y es la medición
que decide si hace falta convertir b10c128.

### El bug que introdujo la limpieza, y dónde vive ahora

Primera versión: `pruneOtherModelVariants` corría dentro de `ensureModel`. Pero la prueba del motor
también llama a `ensureModel`, con una variante ELEGIDA — así que medir el fp32 en el iPhone
**borraba el mixto activo**. La app quedaba sin su modelo, y en un aparato a 252,6 MB de uso la sonda
podía ni entrar, dejándolo sin ninguna de las dos. Un diagnóstico que rompe lo que viene a
diagnosticar.

Ahora la limpieza es explícita y la llama **sólo `ModelGate`**: es política de producción, no parte
de "garantizá que este archivo esté". Corre **antes** de descargar, que es lo único que libera
espacio a tiempo — el trade-off aparente ("si la descarga falla te quedaste sin la variante vieja")
se disuelve porque `ModelGate` exige la variante activa y un fallo bloquea igual; conservar el
archivo viejo no da un camino de vuelta, sólo ocupa los MB que hacían falta. Un test fija el límite.

### Verificado

`npm run typecheck` · **852 tests** (eran 818) · `npm run build -w @tengen/web` · `test:nn` **10/10
con el fp32 por defecto** (el binario del escritorio no se toca) y **10/10 con el mixto de b18**.

### Lo que falta, y no lo puede hacer un LLM

1. **Subir los dos mixtos a R2** (los `wrangler r2 object put` están en el handoff) y verificar el
   `content-length` exacto contra 58093573 / 54194233. Los fp32 se quedan: los sirve el escritorio.
2. **Gate manual en el iPhone**, que es el único camino que ninguna prueba automática cubre —
   `test:nn` corre en WASM/Node y el fallo es de WebGPU en iOS. La pregunta a responder: **¿completa
   las 6 tandas (120 inferencias) donde el fp32 moría en ~80?** Si también muere, la mitad no
   alcanzó y ese dato reabre b10c128 con evidencia. `/diagnostico` ahora tiene el selector de
   variante para correr el A/B en el mismo aparato.

No se tocó `numThreads` (es un paliativo de otra variable — pie base, no pico de carga — y mezclarlo
impediría atribuir la mejora) ni el escritorio (mismo modelo, mismo binario, mismo comportamiento).

### Desplegado (2026-08-03, Version `51f600e1-1a53-4f7b-ae23-c3861a64cdfd`)

**Trampa de `wrangler r2 object put` que costó una subida entera:** wrangler 4.x escribe al bucket de
**simulación local** (`.wrangler/state/`) salvo que se pase `--remote`. La salida lo dice —
`Resource location: local` — pero termina en `Upload complete.`, así que **una subida fallida se lee
como exitosa**. Confirmado con evidencia: los dos mixtos daban 404 en `tengen.kntor.io/models/`
mientras el fp32 de control daba 200. Además hace falta `account_id`, que sólo existe en
`apps/worker/wrangler.jsonc` → **el comando se corre desde `apps/worker/`, no desde la raíz**. La
forma correcta:

```bash
cd apps/worker && npx wrangler r2 object put tengen-models/<archivo>.onnx \
  --file ../../packages/engine/models/<archivo>.onnx --remote
```

Verificado en producción: **4/4 con `content-length` exacto** — los dos mixtos (58093573 / 54194233)
y los dos fp32 intactos (115800125 / 108040143), que es la no-regresión del escritorio.

**Segundo falso negativo, ya conocido en este proyecto: comparar hashes de bundle no sirve acá.** El
`BUILD_ID` lleva la fecha del build, así que **el hash cambia en cada corrida aunque el código sea
idéntico** — y encima el primer `curl` cae en `cf-cache-status: HIT` con el HTML viejo. Los dos
efectos juntos hacen que un deploy correcto se vea como uno roto. La verificación que sí discrimina
es **por contenido, con `Cache-Control: no-cache`**: pedir el bundle y buscar los literales de la
feature. Cadena confirmada `HTML → index-BSUCAMQM.js → engine.worker-B1qTk9Og.js`, y ambos contienen
`mixed16`, los dos `opfsName` versionados, los bytes exactos y `tengen:web:variant`. Que el bundle
principal Y el worker del motor coincidan es la comprobación que importa: si sólo uno tuviera la
lógica nueva, sería exactamente la divergencia hilo-principal/worker que el diseño evita.

**Queda SOLO el gate manual en el iPhone.**

### Primera corrida en el iPhone con el mixto: el criterio NO se cumplió (2026-08-03)

Volcado de Edgar, iPhone 12 Pro Max, **Chrome iOS 150.0.7871.113 sobre iOS 26.5.2**, build `ea024ff`.

**Lo que quedó confirmado funcionando:**

- **WebGPU en Chrome iOS**, adapter y device OK **en los dos scopes** (`vendor=apple`, `shader-f16`
  presente, `maxBufferSize` 1,1 GB, `crossOriginIsolated: sí`). Confirma la predicción de CLAUDE.md:
  WKWebView expone WebGPU desde iOS 26. El bloqueo móvil que la memoria arrastraba desde julio está
  levantado.
- **El perfil por dispositivo funciona:** `variante de este dispositivo: mixed16`, y las dos redes
  figuran con su fila `mixed16 (activa)` / `fp32 (inactiva)`.
- **Cero divergencia hilo-principal/worker:** el motor ARRANCÓ (5.063 ms). Si los dos scopes hubieran
  resuelto distinto, `appFactory` habría lanzado "no está en OPFS" y no habría habido ninguna tanda.

**El resultado, que es negativo:** murió tras **3 tandas / 60 inferencias**. El criterio del plan era
completar 6 tandas / 120. **No se cumplió.**

| | fp32 (Chrome iOS, corrida previa) | mixto (esta corrida) |
|---|---|---|
| arranque | 3.563 ms | **5.063 ms** |
| visitas/s | 1,5 | 1,5 → 1,8 → **1,9** |
| aguantó | ~80 inferencias | **60 inferencias** |

**Advertencia sobre esta comparación, que hay que leer antes de sacar conclusiones:**

1. **No está PROBADO que la corrida fuera del mixto.** El volcado de ese build no reportaba la
   variante medida (defecto corregido en el commit siguiente). Es muy probable que sí —el selector
   arranca en la variante del dispositivo, que es `mixed16`—, pero es inferencia, no dato.
2. **Una sola corrida por lado, y la varianza documentada es enorme:** las corridas de fp32 dieron
   "murió en el arranque" *y* "80 inferencias". Con esa dispersión, 60-contra-80 **no sostiene** que
   el mixto sea peor.

**Lo que sí se puede concluir, y es lo importante:** reducir el modelo a la mitad **no movió el
techo de forma apreciable**. De ahí se sigue algo que contradice el supuesto del plan — **los pesos
no son el consumo dominante.**

Tres observaciones lo refuerzan:

- **Sobrevivió al arranque y murió después.** Si el pico de carga (~232 MB → ~116 MB) fuera la causa
  dominante, el efecto de partirlo al medio se vería justamente ahí. Arrancó bien y murió durante
  inferencia sostenida.
- **Arrancó MÁS LENTO con un archivo de la mitad** (5.063 vs 3.563 ms). Contraintuitivo, y sugiere
  que el grafo mixto le cuesta más a ORT: `keep_io_types=True` más el `gpool` en fp32 dejan muchas
  fronteras `Cast` fp32↔fp16. Más nodos de conversión pueden significar más buffers intermedios en
  la GPU — o sea, achicamos el ARCHIVO y quizá le agregamos trabajo al RUNTIME.
- **Acelera en vez de degradarse** (1,5 → 1,9 v/s). Dentro de la ventana medida no hay fuga
  monótona: muere de golpe. Es firma de TECHO más que de acumulación, aunque con 3 puntos es débil.

Todo esto encaja con el sospechoso que el propio `engineProbe.ts` ya citaba: el bug de onnxruntime en
modo JSEP sobre WebKit (microsoft/onnxruntime#26827, memoria creciendo hasta matar el proceso), que
es del RUNTIME y no del tamaño del modelo.

**Dos variables de confusión que se eliminan gratis y no se eliminaron:**

- **La PWA no estaba instalada** (`modo de display: browser`, `persistente: no`). El plan lo pedía
  explícitamente. Una pestaña tiene un presupuesto de memoria más ajustado que una app instalada, así
  que puede ser la variable dominante — y controlarla no cuesta nada.
- **Los 223,8 MB de fp32 siguen en OPFS** (uso total: 364,9 MB). Es el comportamiento ESPERADO: la
  limpieza la dispara sólo `ModelGate`, o sea entrar a Jugar/Analizar, y la sesión fue directo a
  `/diagnostico`. Es disco y no RAM, pero conviene descartarlo.

**Próximo experimento, que ya está implementado y es más barato que convertir otra red:** el preset
**"Fina"** (5 visitas × 12 tandas = 60 acumulado) contra **"Normal"** (20 × 6). Es el experimento
para el que se diseñaron los presets: si con tandas chicas pasa de 60, el mecanismo es **techo por
tanda** y el arreglo es bajar las visitas por llamada, no achicar la red; si muere cerca de 60 igual,
es **acumulación**.

**Por eso NO se reabre b10c128 todavía**, pese a que el criterio del plan lo habilitaría: si el
mecanismo es techo por tanda o una fuga del runtime, una red más chica volvería a correr el crash
unas inferencias más allá sin resolverlo — que es exactamente lo que acaba de pasar al partir el
modelo al medio. Convertir otra red antes de saber el mecanismo es repetir el experimento que ya
salió negativo.

### CRITERIO CUMPLIDO — 6/6 tandas, 120 inferencias (2026-08-03)

Volcado de Edgar, mismo iPhone 12 Pro Max, **Safari 26.5.2**, build `f01b092+local`, y esta vez con
**`variante medida: mixed16` explícito** en el volcado (ya no es inferencia).

```
arranque del motor: 5096 ms
tanda 1: 20 en 13859 ms (1.4 v/s) · acum 20      tanda 4: 20 en 11447 ms (1.7 v/s) · acum 80
tanda 2: 20 en 10560 ms (1.9 v/s) · acum 40      tanda 5: 20 en 11444 ms (1.7 v/s) · acum 100
tanda 3: 20 en 10789 ms (1.9 v/s) · acum 60      tanda 6: 20 en 11413 ms (1.8 v/s) · acum 120
desaceleración última mitad / primera mitad: 0.97×
```

Contra la corrida de referencia del mismo navegador:

| Safari 26.5.2 | fp32 (antes) | mixto + PWA (ahora) |
|---|---|---|
| arranque | 7.036 ms | **5.096 ms** |
| visitas/s | 1,2 | 1,4 → 1,8 |
| desaceleración | 0,80× | **0,97×** (plana) |
| aguantó | ~80 inferencias | **120 — completó** |

**La atribución es ambigua y hay que decirlo: cambiaron DOS variables a la vez** — la variante
(fp32 → mixto) y el modo (`browser` → `standalone`, o sea PWA instalada). El resultado del producto
no está en duda; lo que no se puede afirmar todavía es cuál de las dos lo produjo. La corrida de
control que lo resuelve es **fp32 en standalone**, y ahora es un clic en el selector de variante
—que además ya no borra el modelo activo—, así que sale barata.

**Un dato que sí es atribuible al modelo:** el arranque bajó de 7.036 a 5.096 ms. Arrancar ES cargar
el modelo, y el modo de display no cambia ese trabajo. Además, los arranques de las dos corridas con
mixto **convergen** (5.096 ms Safari, 5.063 ms Chrome iOS) mientras que con fp32 estaban muy
separados (7.036 vs 3.563). Lectura razonable: con fp32 el arranque estaba dominado por presión de
memoria —que es variable— y con el mixto pasa a estar dominado por compilar el grafo, que es estable.
Esto también matiza la sospecha de la entrada anterior sobre las fronteras `Cast`: el arranque más
lento observado en Chrome iOS no se sostiene como regla.

**La firma cambió de forma, y es la que se quería:** 0,80× (aceleraba) → **0,97×** (plana) sobre la
serie COMPLETA de 6 tandas, sin morir. No hay degradación monótona.

**Nota para leer estos volcados, que confundió al interpretarlo:** el bloque `[modelos en OPFS]`
decía "falta" en las cuatro filas con `uso: 28,8 MB`, pese a que la prueba corrió bien. No es
contradicción — `collectDiagnostics()` se ejecuta al MONTAR la pantalla y la prueba se dispara
después con el botón, así que ese bloque es el estado de ANTES. Además, una PWA instalada en iOS
tiene su propio contenedor de almacenamiento, separado del Safari normal: por eso el OPFS aparecía
vacío y la prueba tuvo que descargar los 58 MB de nuevo.

**`persistente: no` incluso instalada.** iOS no concedió almacenamiento persistente. Con 41,2 GB de
cuota libre el riesgo real de desalojo es bajo, pero el sistema conserva el derecho de borrar los
pesos entre sesiones.

**b10c128 sigue sin hacer falta**, y ahora por la razón buena: el modelo que juega igual que el de
escritorio completa la prueba en el dispositivo.
