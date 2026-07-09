# Plan de continuación — ejecución de la fase engine

**Fecha del handoff:** 2026-07-09. Este documento permite retomar la ejecución de la fase engine tras limpiar/compactar el contexto (o en una sesión/LLM nuevos). El estado operativo vivo está en el ledger `.superpowers/sdd/progress.md`; este doc es el mapa para reanudar sin historial de conversación.

## Dónde estamos

- **Rama:** `fase-engine` (base `main` @ `53f72f0`). Working tree limpio.
- **HEAD:** `ea4fddd`.
- **Método:** subagent-driven-development (skill superpowers). Un subagente implementador por task, revisión por task, ledger durable.
- **Suite:** verde (26 tests). `npx -w @tengen/engine tsc --noEmit` da errores SOLO en los vendored `evalV8.ts`/`analyzeMcts.ts` (imports/TF.js pendientes; se arreglan en Tasks 7/8) — es esperado, no es regresión.

### Estado por task (detalle en el ledger)

| Task | Estado | Commits |
|---|---|---|
| 1 — tipos públicos + vendoring MIT | ✅ completo (review clean) | `479552b`, `4176677`, `4b69c25` |
| 2 — f16 a src/ + f16ToF32 | ✅ completo (review clean) | `0539ef9`, `03dddea` |
| 3 — board vs @sabaki/go-board | ⏳ **impl hecha, REVIEW PENDIENTE** | `ea4fddd` |
| 0 — setup KataGo + fixtures kata-raw-nn | ⬜ pendiente (solo bloquea Task 10) | — |
| 4–14 | ⬜ pendientes | — |

## PRÓXIMA ACCIÓN (exacta)

**Revisar Task 3** (su implementación está commiteada pero sin revisar). Receta:

```bash
SDD=/Users/kntor/.claude/plugins/cache/claude-plugins-official/superpowers/6.1.1/skills/subagent-driven-development
cd /Users/kntor/dev/tengen
bash "$SDD/scripts/review-package" 03dddea ea4fddd   # imprime la ruta del diff
```
Luego despachar un task-reviewer (modelo `sonnet`) con: el brief `.superpowers/sdd/task-3-brief.md`, el reporte `.superpowers/sdd/task-3-report.md`, la ruta del diff, y las constraints globales del plan (licencias/atribución, adaptabilidad upstream, tsconfig strict + noUncheckedIndexedAccess, no romper bench). Verificar en particular: el test de board no es tautológico (compara vs @sabaki como oráculo), la fila de `fastBoard.ts` en `adaptaciones-upstream.md` quedó precisa, y que NO se tocó lógica del vendored. Si limpio → marcar Task 3 completo en el ledger y seguir con Task 4.

Después: continuar Tasks 4 → 14 en orden (y Task 0 cuando convenga; su entorno ya está listo, ver abajo). Task 0 solo bloquea Task 10.

## Receta del loop (por cada task)

1. `git rev-parse --short HEAD` → anota la BASE (commit previo al task).
2. `bash "$SDD/scripts/task-brief" docs/superpowers/plans/2026-07-09-fase-engine.md N` → ruta del brief.
3. Despachar implementador (Agent, `subagent_type: general-purpose`, modelo según complejidad — ver abajo) con: ruta del brief como fuente de requisitos, contexto de dónde encaja, interfaces/decisiones de tasks previos que el brief no sabe, y la ruta del report `.superpowers/sdd/task-N-report.md`.
4. Al volver DONE: `bash "$SDD/scripts/review-package" BASE HEAD` → ruta del diff; despachar task-reviewer (`sonnet`) con brief + report + diff + constraints globales.
5. Findings Critical/Important → despachar fixer; re-verificar. Minor → anotar en el ledger.
6. Marcar el task completo en el ledger `.superpowers/sdd/progress.md` (una línea: `Task N: complete (commits …, review clean)`).
7. Tras todos los tasks: review final de rama (whole-branch, modelo más capaz) + `superpowers:finishing-a-development-branch`.

**Modelos:** transcripción (código completo en el plan) → `haiku`; integración/juicio (varios archivos, API externa) → `sonnet`; los vendored grandes que se adaptan (Tasks 5, 8) o el review final → el más capaz. Especificar SIEMPRE el modelo al despachar.

## Correcciones y hallazgos de esta sesión de ejecución

- **Bytes de los `.bin.gz` corregidos en el plan (Task 0):** los reales son `b18c384nbt.bin.gz` = **97 898 094** y `humanv0.bin.gz` = **99 066 230** (no 214M/324M, que eran de otro artefacto). Ya corregido en el `setup-katago.sh` del plan. Ambos verificados: gzip válido, contienen `kata1-b18c384nbt-s9996604416-d4316597426` y `b18c384nbt-humanv0`.
- **`postProcessParams` de humanv0 = 20/20/20** (visto en su header: version 15, 22 canales, 19 globals, multiplicadores 20). Esto **confirma** el punto "a verificar" de `decisiones-adaptacion.md §4`: para Tasks 9/10 los defaults de `evalV8` (20/20/20, outputScale 1) sirven también para Human SL. Doblar-confirmar el outputScaleMultiplier al leer el header completo si hay duda.
- **`fastBoard.ts` no necesitaba arreglo de imports** (es autocontenido en upstream; `StoneColor` local). Task 3 lo dejó intacto salvo la cabecera. La fila del log en `adaptaciones-upstream.md` ya lo refleja.
- **Estándar transversal fijado** (a petición de Edgar): todo reanudable por LLM + adaptable a releases. Log/runbook en `docs/research/fase-engine/adaptaciones-upstream.md`; constraint global en el plan; reflejado en `CLAUDE.md` y memoria.

## Entorno (ya preparado)

- **KataGo v1.16.5** instalado (`brew`). `katago version` → v1.16.5.
- **Checkpoints descargados** en `packages/engine/models/katago-bin/` (gitignored): `b18c384nbt.bin.gz`, `humanv0.bin.gz`. Listos para que Task 0 genere los fixtures `kata-raw-nn`.
- **ONNX de fase 0** en `packages/engine/models/` (gitignored): `b18c384nbt-kata1.fp16/.fp32.onnx`, `b18c384nbt-humanv0.fp16.onnx`. Task 10 usa el `.fp32` en Node.
- **web-katrain** en `~/dev/vendor/web-katrain` @ `7a0a487` (fuente de adaptación).
- `@sabaki/go-board` instalado como devDep. API: `Board.fromDimensions(N,N)`, `.makeMove(sign,[x,y])` inmutable, `.get([x,y])`.

## Documentos de referencia (orden de lectura para retomar)

1. `CLAUDE.md` — estado y decisiones.
2. `docs/superpowers/plans/2026-07-09-fase-engine.md` — el plan (14 tasks + Task 0), código por paso.
3. `docs/research/fase-engine/fuentes.md` — datos duros (encoding V7, MCTS, postproceso, contrato kata-raw-nn).
4. `docs/research/fase-engine/decisiones-adaptacion.md` — costuras de adaptación + oráculos/tolerancias.
5. `docs/research/fase-engine/adaptaciones-upstream.md` — log por archivo + runbook de re-sync.
6. **`.superpowers/sdd/progress.md`** — el ledger (estado vivo). Tras compactar/reiniciar, confiar en el ledger + `git log`.
7. Este documento — el handoff de continuación.
