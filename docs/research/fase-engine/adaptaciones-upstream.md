# Adaptaciones de upstream — log de cambios, re-sync y cómo retomar

**Propósito.** tengen **adapta** código de terceros (sobre todo web-katrain, MIT) en lugar de reimplementarlo. Ese código sigue evolucionando: saldrán releases nuevas de web-katrain, KataGo (formato de red / encoding) y onnxruntime-web. Este documento existe para que **cualquier LLM (o persona) pueda (a) retomar el proyecto sin contexto previo y (b) re-aplicar nuestras adaptaciones a una versión nueva de upstream** de forma mecánica y verificable. **Es de mantenimiento obligatorio**: toda tarea que vendorice o adapte un archivo de terceros debe añadir/actualizar su entrada aquí en el mismo commit (constraint global del plan).

Regla de oro: **mantener el diff contra upstream mínimo y localizado**, y que el gate de correctitud (`kata-raw-nn`, ver `decisiones-adaptacion.md`) sea la red de seguridad tras cualquier re-sync.

---

## Referencias upstream fijadas (pins)

| Dependencia | Versión/commit fijado | Ubicación local | Rol |
|---|---|---|---|
| **web-katrain** (Sir-Teo/web-katrain, MIT) | commit `7a0a487` (2026-07-02) | `~/dev/vendor/web-katrain` | Fuente de adaptación del board+encoding+MCTS |
| **KataGo** (lightvector/KataGo, MIT) | desktop `1.16.5` (brew); red `kata1-b18c384nbt-s9996604416`; `humanv0` de release `v1.15.0` | binario por `brew`; `.bin.gz` en `packages/engine/models/katago-bin/` (gitignored) | Genera vectores de referencia `kata-raw-nn`; define el encoding V7 y el contrato I/O |
| **katago-onnx** (kaya-go/katago-onnx, AGPL — solo herramienta local) | clon en `~/dev/vendor/katago-onnx` (pixi) | idem | Convierte `.bin.gz`→`.onnx` (uso local, no se vendoriza) |
| **onnxruntime-web** | `^1.24.3` (los tensores `float16` = `Uint16Array`) | npm | Runtime de inferencia; **no** subir de versión sin re-medir la fase 0 |

Cuando cualquiera de estos publique una versión nueva, seguir el **runbook de re-sync** (abajo). El watcher de releases upstream (ver `CLAUDE.md` → "Monitoreo de releases upstream") debe avisar de estos repos.

---

## Log de adaptaciones por archivo

Cada archivo vendorizado en `packages/engine/src/vendor/web-katrain/` proviene de `~/dev/vendor/web-katrain/src/engine/katago/<mismo nombre>` en el commit fijado. La columna **Cambios de tengen** es lo que hay que **re-aplicar** sobre una versión nueva de upstream.

| Archivo | Origen (web-katrain@7a0a487) | Cambios de tengen | Task | Notas de re-sync |
|---|---|---|---|---|
| `fastBoard.ts` | `src/engine/katago/fastBoard.ts` | (Task 1) verbatim + cabecera. (Task 3) arreglar imports de tipos a locales; sin tocar lógica. | 1, 3 | Board+escaleras+Benson. Diff mínimo esperado; si upstream cambia firmas de `computeLadderFeaturesV7KataGo`/`computeAreaMapV7KataGo`/`playMove`, actualizar los llamadores en `encoding/featuresV7.ts` y `search/mcts.ts`. |
| `featuresV7Fast.ts` | `src/engine/katago/featuresV7Fast.ts` | (Task 5) vendorizado **solo como oráculo de test** (NHWC intacto); el encoder de producción es el fork NCHW `encoding/featuresV7.ts`. | 5 | Si upstream cambia planos/globals, se detecta porque el test diferencial NCHW↔NHWC y el de `kata-raw-nn` fallan. Re-aplicar el cambio de layout en el fork. |
| `scoreValue.ts` | `src/engine/katago/scoreValue.ts` | (Task 7) romper acoplamiento a `BOARD_AREA`/`BOARD_SIZE` globales → pasar `boardSize`/`sqrtBoardArea` por parámetro; cache de tabla keyed por el parámetro. | 7 | Cambio localizado en la firma de `expectedWhiteScoreValue`/`initScoreValueTables`. |
| `evalV8.ts` | `src/engine/katago/evalV8.ts` | (Task 7) arreglar imports; sin tocar la matemática de `postprocessKataGoV8`. | 7 | Si upstream cambia el orden de `scoreValue[]` o los multiplicadores, actualizar aquí y en el `NNEvaluator`. |
| `searchParams.ts` | `src/engine/katago/searchParams.ts` | (Task 1) verbatim + cabecera. | 1 | Constantes de búsqueda; diff nulo esperado. |
| `analyzeMcts.ts` | `src/engine/katago/analyzeMcts.ts` | (Task 8) **reemplazar la costura neuronal**: `evaluateBatch`→`model.forward()` (TF.js, ~L1447-1466) por un `NNEvaluator` inyectado; **podar** la mezcla de policy-optimism (head-0 pura); quitar `import * as tf` y la detección `tf.getBackend()` (→ flag). Todo lo demás (PUCT/FPU/virtual-loss/backup/getAnalysis) intacto. | 8 | **El cambio de mayor riesgo de re-sync.** Localizado: buscar en el diff de upstream si tocaron `evaluateBatch`/`expandNode`/`selectEdge`. Re-aplicar los 4 cambios listados. Gate: `mcts.test.ts` (mock) + `nn.reference.test.ts`. |

**Archivos 100% de tengen (no upstream, no re-sync — solo mantenimiento normal):** `types.ts`, `index.ts`, `f16.ts`, `encoding/featuresV7.ts` (fork con lógica propia de layout), `encoding/gameState.ts`, `encoding/metaV1.ts`, `nn/session.ts`, `nn/evaluator.ts`, `search/mcts.ts`, `humansl.ts`, `engine.ts`, `worker/*`.

---

## Runbook de re-sync (cuando salga una release de web-katrain)

1. **Actualizar el pin y ver qué cambió upstream:**
   ```bash
   cd ~/dev/vendor/web-katrain && git fetch && git log --oneline 7a0a487..origin/main -- src/engine/katago/
   git diff 7a0a487..origin/main -- src/engine/katago/fastBoard.ts   # y por cada archivo de la tabla
   ```
2. **Por cada archivo de la tabla de arriba:** si upstream lo tocó, re-copiar la versión nueva a `packages/engine/src/vendor/web-katrain/`, re-poner la cabecera, y **re-aplicar los "Cambios de tengen"** de su fila (son pocos y localizados). Si upstream NO lo tocó, no hay nada que hacer.
3. **Actualizar el pin** en este documento (tabla de pins + cabeceras de los archivos) al nuevo commit.
4. **Correr los gates:**
   ```bash
   npm test -w @tengen/engine          # lógica (board, encoding diferencial, meta, MCTS mock)
   npm run -w @tengen/engine test:nn   # encoder+ONNX vs kata-raw-nn (correctitud real)
   npx -w @tengen/engine tsc --noEmit
   ```
   Si `test:nn` pasa, la adaptación es correcta aunque upstream haya reorganizado el código.
5. **Para releases de KataGo (red nueva o cambio de encoding):** regenerar los fixtures (`scripts/setup-katago.sh` + `gen-reference`) con la red nueva, y correr `test:nn`. Un cambio de `input version` de KataGo rompería el encoding → actualizar `encoding/featuresV7.ts` guiado por `nninputs.cpp` de la versión nueva (ver `fuentes.md §1`).

---

## Cómo retomar el proyecto (para un LLM sin contexto previo)

Leer en este orden:
1. **`CLAUDE.md`** (raíz) — qué es tengen, decisiones ya tomadas, estado actual.
2. **`docs/superpowers/specs/2026-07-08-tengen-design.md`** — la spec del producto.
3. **`docs/superpowers/plans/2026-07-09-fase-engine.md`** — el plan de implementación TDD (14 tasks + Task 0), con código concreto por paso.
4. **`docs/research/fase-engine/fuentes.md`** — datos duros verificados (encoding V7, MCTS, postproceso, contrato `kata-raw-nn`).
5. **`docs/research/fase-engine/decisiones-adaptacion.md`** — costuras de adaptación (NHWC→NCHW, policy head-0, inyección del evaluador, un Worker por tamaño) y oráculos/tolerancias de test.
6. **Este documento** — qué se adaptó de upstream y cómo re-aplicarlo.
7. **`.superpowers/sdd/progress.md`** (git-ignored) — el ledger: qué tasks están completos (con sus commits) y cuál es el siguiente. **Tras cualquier reinicio, confiar en el ledger + `git log` sobre la memoria.** Reanudar en el primer task no marcado como completo.

Estado de ejecución y siguiente paso viven siempre en el ledger. La rama de trabajo es `fase-engine`.
