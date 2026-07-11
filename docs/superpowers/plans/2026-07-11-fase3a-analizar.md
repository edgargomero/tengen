# Plan: Fase 3a — Modo Analizar (núcleo)

## Context

Fase 2 (Modo Jugar) está completa y pusheada a `origin/main` (motor 88/88, web 151/151, `tsc` 0, `vite build` 0; gate manual de Edgar en curso). Fase 3a construye el **Modo Analizar**: cargar un SGF → analizar bajo demanda cada posición (heatmap de policy/visitas, panel de winrate/score, PV) → gráfico de winrate a través de toda la partida → **review progresivo** (analiza la partida en background, prioriza para el usuario los saltos grandes de winrate/score) → `guessMove` reformulado como "adivina la mejor jugada según el propio motor" (sin datos de partidas profesionales).

**Alcance decidido con Edgar** (brainstorm de esta sesión, no re-litigar): esto es **Fase 3a**, el núcleo — la mitad "cabecera" de un split en dos entregas. Comentarios por posición y una biblioteca local de partidas navegables quedan para **Fase 3b** (fase separada, con su propio brainstorm después). Tsumego/lecciones (fuente: comunidad de Go de LATAM)/partidas profesionales quedan fuera, para una fase de **Estudio** aparte, sin planear todavía.

**Estrategia elegida (de 3 alternativas presentadas, "híbrido acotado" — Edgar confirmó):**
1. **Arreglar la deuda de cancelación (M-1) y canal de error (M-2) en el paquete compartido `packages/engine`**, no solo mitigarla en `apps/web`. Es más barato de lo que parecía: el motor MCTS ya acepta un predicado de cancelación por-llamada (`shouldAbort`); `LocalEngine` simplemente no lo usa así hoy (lee un flag compartido de instancia). El cambio es aditivo (parámetro opcional nuevo en `Engine.analyze`) — Fase 2 no se toca.
2. **Portar `gameReport.ts` de web-katrain (el algoritmo real de "review progresivo") con adaptación fiel y atribución MIT**, coherente con cómo se adaptó todo el motor (decisión "no re-litigar" de CLAUDE.md: adaptar, no reimplementar) — **pero con el alcance acotado a la línea principal de la partida** (sin variaciones). Este recorte tiene un efecto colateral bueno: **no hace falta portar `branchNavigation.ts`** (la pieza de web-katrain que resuelve "cuál es la rama activa" en un árbol con variaciones) — `tree.mainLine()` de tengen ya da esa secuencia directamente.
3. **Cachear el análisis por nodo en un `Map<nodeId, Analysis>` externo**, no extendiendo `GameNode` — cero riesgo sobre `gameTree.ts` (usado y testeado en toda la app desde Fase 2), sin ninguna pérdida de funcionalidad frente a extender el nodo.

## Hallazgos de exploración que gobiernan el diseño

**Motor (`packages/engine`) — contrato y deuda M-1/M-2:**

1. `Engine.analyze(pos, {visits}, onUpdate): CancelFn` (`types.ts:98`) — sin canal de error. `Analysis = {winrate, scoreLead, scoreStdev, visits, moves: MoveAnalysis[], ownership?}`; `MoveAnalysis = {vertex, visits, winrate, scoreLead, prior, pv}`. `winrate`/`scoreLead` SIEMPRE perspectiva Negro (`engine.ts:44-49`). `ownership` SIEMPRE `undefined` hoy (`ownershipMode:'none'`, `search/mcts.ts:69`) — sin overlay de territorio disponible, fuera de alcance. **Sin policy por-vértice pública** — el heatmap se construye desde `Analysis.moves` (top-K candidatas).
2. `getAnalysis({topK: 30, ...})` en `engine.ts:186` — el vendor **capea internamente a 50** (`analyzeMcts.ts:2069`). Subir `topK` a 50 es un cambio de una línea sin costo (ningún test fija 30). Más de 50 requeriría tocar código vendorizado pineado — fuera de alcance.
3. **M-1, mecánica exacta:** `LocalEngine` (`engine.ts:94`) tiene un flag ÚNICO de instancia `this.cancelled`, compartido por `genMove`/`analyze`. El Worker (`worker/handler.ts:106-112`) trata `stop` fuera de la cola (necesario, si no deadlockearía contra un `analyze` en vuelo) pero **ignora `req.id`** — solo `engine.stop()` (global) + `resolveActiveAnalyze?.()` (closure única, no `Map`). La cola FIFO (`handler.ts:24-31,49`) es obligatoria por el scratch MCTS global no-reentrante (`vendor/web-katrain/analyzeMcts.ts:68`) — el fix es sobre el FLAG, la serialización se queda. **Hallazgo clave que abarata el fix:** `MctsSearch.run({shouldAbort})` (`analyzeMcts.ts:1747-1755`) YA acepta un predicado de cancelación por-llamada — el fix real es reemplazar `this.cancelled: boolean` por un token por-llamada capturado en la clausura de cada `genMove`/`analyze`, sin tocar `run()`.
4. **M-2, mecánica exacta:** el Worker SÍ tipa y postea el error (`handler.ts:96-100`, `{type:'error',id,message}`, `protocol.ts:23`), pero `WorkerEngine` cliente (`client.ts:104-114`), en su `case 'error'` para un `analyze` (vive en `this.analyzers`, no `this.pending`), SOLO borra el callback local — nunca informa al caller. `LocalEngine.analyze` ya tiene hooks internos `{onDone,onError}` (`engine.ts:162`, Task 13) no expuestos públicamente.
5. `apps/web/src/engine/engineManager.ts` (Fase 2) solo tiene `ensureReady`/`genMove`/`analyzeToScore` (Promise única de fin de partida, timeout 30s como único fallo) — **sin ningún método de análisis streaming de posición arbitraria** (docstring propio, `engineManager.ts:27`, lo confirma).
6. Verificado: el mock `Engine` de `apps/web/tests/engineManager.test.ts` (`analyze` de 3 parámetros) queda estructuralmente válido con un 4º parámetro opcional en la interfaz pública — el cambio es genuinamente aditivo.

**Dominio de partida (`apps/web`) y Shudan:**

7. `GameNode` (`game/gameTree.ts:31-37`) es `readonly {id, move, parent, children}`, sin campo de análisis. `id` es monótono y estable (`nextId`, `gameTree.ts:55`) — clave válida para un `Map` externo. `positionAt`/`boardAt`/`currentTurnAt` (todos en `gameTree.ts`) aceptan cualquier nodo como cursor opcional, no solo el actual. `mainLine()` (`gameTree.ts:124-132`) recorre estrictamente `children[0]` desde la raíz.
8. `importSgf(source): GameTree` (`sgf.ts`) es 100% independiente de `opponent`/IA — reusable sin cambios para "cargar un SGF a analizar".
9. Shudan (`@sabaki/shudan@1.7.1`, `node_modules/@sabaki/shudan/src/Goban.d.ts`) trae TODAS las primitivas visuales nativas, sin overlays custom: `heatMap?: Map<HeatVertex|null>` (`HeatVertex={strength:number, text?:string}`), `ghostStoneMap?: Map<GhostStone|null>` (`GhostStone={sign, type?:'good'|'interesting'|'doubtful'|'bad', faint?:boolean}`), `lines?: LineMarker[]` (`LineMarker={v1,v2,type?:'line'|'arrow'}`). `Map<T>=T[][]` indexado `[y][x]` (mismo footgun de `signMap`, ya documentado en `coords.ts`).
10. `apps/web/src/ui/PlayView.tsx` (patrón a reusar): `<Goban signMap markerMap vertexSize showCoordinates busy onVertexClick>`; `signMap` se deriva de `tree.boardAt(cursor)` en cada render.
11. `apps/web/src/ui/GameTreePanel.tsx` (137 líneas, componente puro, reusable): navegación por clic ya funciona, SIN slot para anotaciones (winrate/score/severidad) junto a cada jugada — necesita una prop nueva opcional.
12. `apps/web/src/main.tsx`: SIN router (confirmado, sin librería de rutas en `package.json`). Un solo estado binario hoy (`session===null ? <NewGameForm> : <PlayView>`). Modo Analizar necesita su propio conmutador, diseñado desde cero, siguiendo el idioma ya usado de `sessionKey`/remonte por `key`.

**web-katrain (`~/dev/vendor/web-katrain`, MIT, pin `7a0a487`) — review progresivo:**

13. El roadmap del proyecto nombra 7 archivos para portar (`analysisSmoothing.ts`, `playedMoveQuality.ts`, `positionEval.ts`, `gameAnalysisProgress.ts`, `topMoveMetric.ts`, `branchNavigation.ts`, `analysisQueue.ts`) — **la lista está desactualizada**: el algoritmo real de "priorizar saltos grandes de winrate" vive en `gameReport.ts` (645 líneas, NO listado) + `nodeAnalysis.ts` (31 líneas)/`analysisSummary.ts` (30 líneas)/`analysisCoverage.ts` (47 líneas), tampoco listados. Verificado leyendo esos 4 archivos + su wiring en `GameReportModal.tsx`/`gameStore.ts`.
14. El algoritmo: `pointsLost = signo(jugador) × (scoreLead_padre − scoreLead_hijo)`; bucket de severidad por umbrales `[12,6,3,1.5,0.5,0]` puntos (`DEFAULT_EVAL_THRESHOLDS`, `nodeAnalysis.ts`); clasificación cruzada por rank+prior entre candidatas (`rank===1→aiMove,≤3→good,≤10→inaccuracy,≤20→mistake,resto→blunder`, cruzado con `relativePrior=playedPrior/topPrior` cortes `≥0.5/≥0.1/≥0.02`, toma el peor veredicto); "turning points" = swing≥5 puntos, top-5; orden final por `pointsLost` desc (modo 'loss') o severidad de categoría (modo 'policy'). Prioridad de cola de fondo (`gameStore.ts:1080-1087`): interactive:100 > aiMove:70 > selfplay:55 > fullGame:20 > fastGame:15 > quickGame:10.
15. `positionEval.ts` NO es portable útilmente (glue code impuro sobre el store propio de web-katrain; tengen ya tiene el equivalente vía `Analysis.scoreLead`/`winrate`) — **se excluye del port, documentado como decisión, no como olvido**.
16. `branchNavigation.ts` (189 líneas) — resuelve "cuál es la rama activa" para construir una secuencia lineal navegable en un árbol CON variaciones. **Se excluye del port para 3a** (el alcance de esta fase es solo `tree.mainLine()`; se porta en una fase futura cuando el review deba cubrir variaciones). `playedMoveQuality.ts` y `gameReport.ts` dependen de esa pieza en el original — ambos se adaptan para operar sobre `tree.mainLine()` de tengen directamente, sin necesitar `ActiveBranchMap`/`getActiveChild`.
17. `analysisQueue.ts` (303 líneas) es autocontenido (no importa tipos de web-katrain) — scheduler genérico de jobs por prioridad+grupo+`staleKey`+`preempt`. Se porta verbatim.
18. `topMoveMetric.ts` (57 líneas) importa `TopMoveMetric`/`PolicyHeatmapMetric` de `GameSettings` (tipo propio de web-katrain que tengen no tiene) — se adapta definiendo el tipo como unión literal local (mismo patrón ya usado en `evalV8.ts`/`featuresV7Fast.ts` del motor: "imports resueltos a defs locales").
19. `MoveAnalysis` de tengen no trae `order` (rank) ni `pointsLost` por candidata — ambos son derivables: `order` = índice tras ordenar `moves` por `visits` desc; `pointsLost` de una candidata = `signo(jugador-al-turno) × (rootScoreLead − candidata.scoreLead)` (misma fórmula que la jugada jugada, aplicada por candidata).
20. Proceso de atribución ya establecido, a reusar exacto: cabecera MIT por archivo (ver `apps/web/src/models/progress.ts:1-8` como precedente) + entrada en `apps/web/THIRD-PARTY-LICENSES` + fila en `docs/research/fase-engine/adaptaciones-upstream.md` (tabla "Log de adaptaciones por archivo", pin `7a0a487`). Sin test automatizado anti-AGPL — verificación de proceso.
21. **Riesgo técnico real en la integración de `AnalysisQueue` con `EngineManager.analyze`** (streaming, no Promise única): si el `run(ctx)` de un job no resuelve/rechaza al abortarse (`ctx.signal`), el job queda atascado en `active` para siempre → la cola entera se bloquea (`pump()` nunca vuelve a correr). El wrapper (`reviewScheduler.ts`) DEBE enganchar `ctx.signal` para invocar la `CancelFn` de `analyzePosition`/`analyze` Y resolver/rechazar la promesa del job en ese mismo momento — nunca dejar el job esperando solo a que `visits>=target` llegue si la señal ya se abortó.

## Arquitectura / módulos

### `packages/engine` — cancelación por-id + canal de error (Task 1)

`src/engine.ts` — token por-llamada en vez de flag de instancia:
```ts
type CancelToken = { cancelled: boolean }
export class LocalEngine implements Engine {
  private activeToken: CancelToken | undefined   // lo que stop() global puede tocar

  analyze(
    pos: Position, opts: { visits: number }, onUpdate: (a: Analysis) => void,
    onError?: (e: unknown) => void,                    // NUEVO, 4º param público (M-2)
    hooks?: { onDone?: (a: Analysis) => void },         // uso interno del Worker
  ): CancelFn {
    const token: CancelToken = { cancelled: false }
    this.activeToken = token
    const cancel: CancelFn = () => { token.cancelled = true }
    void (async () => {
      try {
        // while (target < opts.visits && !token.cancelled) { shouldAbort: () => token.cancelled, ... }
        if (!token.cancelled && last !== undefined) hooks?.onDone?.(last)
      } catch (e) { onError?.(e) }
    })()
    return cancel
  }
  stop(): void { if (this.activeToken) this.activeToken.cancelled = true }
}
```
`topK: 30 → 50` en la misma línea (`engine.ts:186`).

`src/types.ts` — mismo 4º parámetro opcional en la interfaz pública `Engine.analyze` (aditivo — `WorkerEngine` sigue implementando `Engine` con la firma existente + el nuevo opcional).

`src/worker/protocol.ts` — separar "cancela una operación" de "cancela todo":
```ts
export type WorkerRequest =
  | { type: 'init'; id: number; network: NetworkId; boardSize: BoardSize }
  | { type: 'genMove'; id: number; pos: Position; level: RankLevel }
  | { type: 'analyze'; id: number; pos: Position; visits: number }
  | { type: 'stop'; id: number; targetId: number }   // cancela SOLO targetId
  | { type: 'stopAll'; id: number }                  // comportamiento global de hoy (teardown/crash-recovery)
```

`src/worker/handler.ts` — de closure única a `Map`s por-id + `Set` para lo cancelado antes de arrancar:
```ts
const activeCancels = new Map<number, CancelFn>()
const activeFinishers = new Map<number, () => void>()
const preCancelled = new Set<number>()
// handleAnalyze: si preCancelled.delete(req.id) → skip total. Si no, registra cancel/finish en los Maps.
// case 'stop': cancela activeCancels.get(req.targetId) si existe, si no lo marca en preCancelled; llama su finisher.
// case 'stopAll': engine.stop() + drena todos los finishers + limpia ambos Maps (comportamiento de hoy).
```

`src/worker/client.ts` — `analyzers` guarda `{onUpdate, onError}`; `analyze()` postea `stop{targetId:id}` al cancelar (no `stop{id}` global); `stop()` global postea `stopAll`; el `case 'error'` de un id en `analyzers` INVOCA `onError` en vez de solo borrar.

**Verificación de que Fase 2 no se rompe:** cero cambios requeridos en `apps/web/src/engine/engineManager.ts`, `workerManagedEngine.ts`, `ui/PlayView.tsx` — todos siguen llamando `analyze` con 3 argumentos, válido con el 4º opcional. Actualizar `packages/engine/tests/protocol.test.ts` (la forma del mensaje `stop` cambia a `{targetId}`) + `worker.test.ts` (3 tests existentes deben seguir pasando) + un test NUEVO de concurrencia: cancelar un `analyze` en vuelo sin afectar otro `analyze` distinto encolado detrás (imposible de expresar con el diseño anterior).

### `apps/web` — análisis (nuevo directorio `analysis/`, dominio puro salvo lo indicado)

- `engine/engineManager.ts` (EDITA) — nuevo método `analyze(pos, visitsTarget, onUpdate, onError?): CancelFn`, streaming, mismo espíritu "race contra crash" que `genMove` (engancha `live.crash.catch` para reportar crash como `onError` sin bloquear).
- `analysis/analysisStore.ts` — **nativo**. `Map<number, Analysis>` keyed por `GameNode.id`; helpers `get/set/has/clear`. Un Map fresco por sesión de Analizar (se reinicia al cargar un SGF nuevo — los ids del árbol importado empiezan en 0).
- `analysis/vendor/web-katrain/types.ts` — subconjunto TRIMMED de `~/dev/vendor/web-katrain/src/types.ts`: solo lo que las funciones portadas realmente leen (`Player`, `Move{x,y,player}`, `CandidateMove`, la forma de `GameNode`/`AnalysisResult` que necesitan). Cabecera MIT.
- `analysis/vendor/web-katrain/{nodeAnalysis,analysisSummary,analysisCoverage,analysisSmoothing,topMoveMetric}.ts` — portados, cabecera MIT individual. Verificar en la implementación si `analysisCoverage.ts` depende de `branchNavigation.ts`; si es así, adaptar (no portar esa dependencia, resolver con el equivalente de mainLine-only).
- `analysis/vendor/web-katrain/{gameReport,playedMoveQuality}.ts` — portados y ADAPTADOS para operar sobre una secuencia lineal (la que da `tree.mainLine()` de tengen) en vez de resolver "rama activa" vía `branchNavigation.ts`/`ActiveBranchMap` (excluido del port, ver hallazgo 16). Documentar la adaptación en el comentario de cabecera de cada archivo + en la fila de `adaptaciones-upstream.md`.
- `analysis/vendor/web-katrain/analysisQueue.ts` — portado verbatim (autocontenido, sin acoplamiento a tipos de web-katrain).
- `analysis/vendor/web-katrain/gameAnalysisProgress.ts` — portado verbatim.
- `analysis/katrainAdapter.ts` — **nativo, el módulo más delicado**. Puente `GameTree`(tengen)+`analysisStore`(Map)→forma de `GameNode`/`CandidateMove[]` que esperan los archivos portados: pase→`{x:-1,y:-1,player}` (convención confirmada en el propio vendor); `analysis.moves`→`CandidateMove[]` ordenadas por `visits` desc con `order`=índice; `pointsLost` por candidata con la fórmula del hallazgo 19. Camina SIEMPRE `tree.mainLine()` — nunca resuelve variaciones.
- `analysis/reviewScheduler.ts` — **nativo**. Envuelve `AnalysisQueue` (portado): prioridades `{interactive:100, review:20}` (subconjunto de las de upstream que aplica a 3a; se documenta la correspondencia con el resto en un comentario, sin inventar valores). El `job.run(ctx)` ADAPTA `EngineManager.analyze` (callback+`CancelFn`) a `Promise<Analysis>` — **implementa el contrato settle-on-abort del hallazgo 21**: engancha `ctx.signal` para invocar la `CancelFn` Y resolver/rechazar inmediatamente, nunca deja el job esperando solo `visits>=target` tras un abort.
- `analysis/gameReview.ts` — **nativo**, orquestador. Recorre `tree.mainLine()`; por cada nodo sin entrada en `analysisStore`, encola un job `group:'review', priority:20` vía `reviewScheduler`; al resolver, cachea en `analysisStore` y recomputa `computeGameReport` (portado) sobre lo YA analizado — progresivo de verdad, no espera a terminar toda la partida. Expone `getReportTurningPoints`/`sortMoveReportEntries('loss')` (portados).
- `analysis/overlays.ts` — **nativo, puro**. `Analysis`+`playedMoveQuality` (portado) → tipos Shudan: `buildHeatMap(analysis, boardSize): HeatVertex[][]`, `buildGhostStoneMap(...)`, `buildPvLines(topMove, boardSize): LineMarker[]`.
- `analysis/guessAgainstEngine.ts` — **porta** `scoreGuess`/`guessVerdict` de `guessMove.ts` (puros, solo comparan dos vértices) + **reemplaza** el insumo: en vez de extraer la jugada real del kifu como "expected" (lo que hace upstream), llama `EngineManager.analyze(pos, N)` y usa el candidate con más `visits` como "expected". Documentado como adaptación deliberada de insumo, no de algoritmo.
- `analysis/winrateGraphData.ts` — **nativo, puro**. Recorre `mainLine()`, usa `analysisStore`, aplica `analysisSmoothing` (portado) opcionalmente.

### `apps/web` — UI (Preact, browser-only)

- `ui/AnalyzeView.tsx` — carga SGF (reusa `importSgf`), tablero Shudan con overlays de `overlays.ts`, panel winrate/score, "Analizar esta posición" (`EngineManager.analyze` bajo demanda, prioridad `interactive` vía `reviewScheduler`) que cancela la llamada anterior antes de lanzar la nueva al navegar (mismo espíritu que `staleRef` de `PlayView.tsx`).
- `ui/GameTreePanel.tsx` (EDITA) — prop opcional `annotationFor?(node): string|undefined` (o similar), retro-compatible con `PlayView` (que no la pasa).
- `ui/WinrateGraphPanel.tsx` — SVG minimal (sin librería nueva) desde `winrateGraphData.ts`, clic navega el cursor.
- `ui/GameReviewPanel.tsx` — progreso (`gameAnalysisProgress`, portado) + lista de saltos grandes, clic navega.
- `ui/GuessMovePanel.tsx` — usa `guessAgainstEngine.ts`.
- `main.tsx` (EDITA) — conmutador `type Mode = 'menu'|'play'|'analyze'` antes del formulario actual; mismo idioma de `sessionKey`/remonte por `key` ya usado por `PlayApp`.
- `apps/web/THIRD-PARTY-LICENSES` (EDITA) — bullets nuevos por cada archivo portado (mismo bloque MIT ya presente).
- `docs/research/fase-engine/adaptaciones-upstream.md` (EDITA) — filas nuevas en la tabla, pin `7a0a487` (sin cambio de pin), incluyendo la fila que documenta la exclusión de `branchNavigation.ts`/`positionEval.ts`.

## Tareas (SDD)

**Node-testable — `packages/engine`:**
1. **Cancelación por-id + canal de error + `topK` 30→50.** Edita `engine.ts`, `types.ts`, `worker/protocol.ts`, `worker/handler.ts`, `worker/client.ts`. Actualiza `protocol.test.ts` (forma de `stop`) + `worker.test.ts` (existentes en verde) + test NUEVO de concurrencia (cancelar un `analyze` sin afectar otro encolado detrás). Motor 88/88 + los nuevos, en verde.

**Node-testable — `apps/web`, motor/dominio:**
2. **`EngineManager.analyze` streaming + `analysis/analysisStore.ts`.** Tests con `Engine` mock: emite updates, cancela vía `CancelFn`, reporta crash como `onError`, no deja handlers colgando si se cancela antes de que `reconcile()` resuelva. Test de `analysisStore` (get/set/has/clear).
3. **Vendorizar tipos trimmed + portar `nodeAnalysis.ts`/`analysisSummary.ts`/`analysisCoverage.ts`/`analysisSmoothing.ts`/`topMoveMetric.ts` (adaptado).** Cabeceras MIT + `THIRD-PARTY-LICENSES` + filas en `adaptaciones-upstream.md`. Verificar y resolver la dependencia de `analysisCoverage.ts` (hallazgo 3 de Arquitectura).
4. **Portar `gameReport.ts` + `playedMoveQuality.ts`, adaptados a `mainLine()` (SIN `branchNavigation.ts`).** El task más delicado — documentar en cabecera + `adaptaciones-upstream.md` la exclusión explícita de `branchNavigation.ts`/`positionEval.ts` y el motivo (main-line-only en 3a).
5. **`analysis/katrainAdapter.ts`.** Tests exhaustivos: nodo sin análisis → seguro en toda la cadena; `CandidateMove[]` ordenadas por visits desc con `order` correcto; `pointsLost` con signo correcto para Negro y Blanco; convención de pase `(-1,-1)`.
6. **Portar `analysisQueue.ts` verbatim + `analysis/reviewScheduler.ts`.** Test del contrato settle-on-abort (hallazgo 21): abortar un job activo NO atasca `pump()`; prioridad `interactive` preempta `review`; sin deadlock.
7. **`analysis/gameReview.ts` + portar `gameAnalysisProgress.ts`.** Tests: progreso incremental, turning points disponibles antes de terminar toda la línea, re-análisis idempotente (nodo ya en `analysisStore` no se re-encola).
8. **`analysis/overlays.ts` + `analysis/guessAgainstEngine.ts` + `analysis/winrateGraphData.ts`.** Utilidades puras de presentación — tests de forma Shudan (`[y][x]`), normalización de `strength`, rank/pointsLost del guess, suavizado.

**Browser-only:**
9. **`ui/AnalyzeView.tsx` + extensión de `GameTreePanel.tsx` + `ModelGate` wiring.** Primer "analizar una posición de punta a punta".
10. **`ui/WinrateGraphPanel.tsx` + `ui/GameReviewPanel.tsx` + `ui/GuessMovePanel.tsx` + CSS.**
11. **`main.tsx` — conmutador Jugar/Analizar.** Wiring final + atribución completa verificada.

## Verificación

- **Node (auto):** `npm test -w @tengen/engine` — 88 + los nuevos de Task 1 en verde. `npm test -w @tengen/web` — 151 + los nuevos (Tasks 2-8) en verde. `npx tsc --noEmit` 0 en ambos workspaces (`noUncheckedIndexedAccess` incluido). `vite build` 0.
- **Browser (Chrome/WebGPU real, lo corre Edgar o Claude vía chrome-devtools-mcp):**
  1. Cargar un SGF real (9×9 o 19×19) → navegar posiciones → "Analizar esta posición" muestra heatmap + winrate/score + PV correctos para el nodo actual (nunca uno viejo, incluso navegando rápido).
  2. Gráfico de winrate de toda la partida (línea principal).
  3. Review progresivo: progreso visible, prioriza saltos grandes ANTES de terminar de analizar toda la partida; un análisis interactivo (navegar/pedir análisis puntual) responde sin esperar a que termine el review de fondo.
  4. `guessMove` contra el motor en varias posiciones.
  5. **Confirmar que Modo Jugar (Fase 2) sigue funcionando sin regresión** (partida completa 9×9, pasar dos veces, export/import SGF) — el cambio del motor (Task 1) es aditivo, pero la verificación manual es la que cierra el ciclo.

## Notas / riesgos

- **`katrainAdapter.ts` es el módulo con más superficie de bugs sutiles** (signo de `pointsLost`, orden de `order`, convención de pase) — mitigado con la batería de tests del Task 5 antes de tocar el port de `gameReport.ts`/`playedMoveQuality.ts` (Task 4 debe cerrar primero).
- **`topK=50` es un techo duro del vendor pineado** (`analyzeMcts.ts:2069`); si en el futuro se necesita más cobertura del heatmap en 19×19 (361 vértices), requiere tocar código vendorizado y re-medir contra `test:nn` — fuera de 3a.
- **`branchNavigation.ts` queda diferido** (no portado): cuando una fase futura quiera review-progresivo consciente de variaciones, hay que portarlo y volver a cablear `gameReport.ts`/`playedMoveQuality.ts` a la resolución de "rama activa" en vez de `mainLine()` fijo. Documentado explícitamente en `adaptaciones-upstream.md` para que quede trazable.
- **Analizar siempre usa la red `b18`** (no Human SL) — heatmap/review/guessMove necesitan la "mejor jugada según el motor" (MCTS fuerte), no la política de imitación humana de Human SL (exclusiva de Modo Jugar).
- **Cambiar de modo (Jugar↔Analizar) no comparte Worker/config** — cada modo monta su propio `EngineManager` (mismo patrón `dispose()` en cleanup que ya usa `PlayView`); consistente con la arquitectura de Fase 2, sin complejidad añadida de compartir una sola instancia entre modos.
- **Licencias:** mismo proceso ya usado (`progress.ts`) para cada archivo portado — cabecera individual + `THIRD-PARTY-LICENSES` + fila en `adaptaciones-upstream.md`, pin `7a0a487`. Sin test automatizado anti-AGPL — verificación de proceso/revisión.
- **Rama y proceso:** SDD sobre `main` (Edgar autorizó, mismo patrón de Fases 0-2). Al ejecutar (fuera de plan mode), commitear este plan en `docs/superpowers/plans/2026-07-11-fase3a-analizar.md`. Gate manual de browser lo corre Edgar (headless no soporta WebGPU).
- **Fuera de alcance (confirmado con Edgar):** comentarios por posición + biblioteca local de partidas → Fase 3b (fase separada). Tsumego/lecciones/partidas-profesionales → fase "Estudio" (sin planear).
