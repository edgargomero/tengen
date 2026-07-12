# Plan: tengen v1 — jugar bien + analizar bien + cuentas (apps/web + apps/worker + deploy)

## Context

**Por qué este trabajo.** El motor de tengen (`packages/engine`) está completo y mergeado a `main` (Tasks 0–13): `WorkerEngine implements Engine` corre KataGo (ONNX + MCTS en TS) en un Web Worker, con el contrato UI↔motor 100% listo y verificado. **Pero tengen no es desplegable hoy**: `apps/` no existe; el motor es una librería headless (sin UI ni servidor). Edgar quiere el **v1 completo del spec**: jugar bien + analizar bien + cuentas Google con guardado en la nube, desplegable en Cloudflare.

**Sobre "por qué no es solo reúso" (aclarado con hechos).** El reúso denso YA ocurrió: board, encoding V7, MCTS y postproceso se adaptaron de web-katrain y están en el motor. Lo que falta es *la aplicación*, que ningún upstream regala entera:
- La UI de web-katrain (`~/dev/vendor/web-katrain`) es una app **React + Zustand + Tailwind** enorme (port de KaTrain): reconocimiento por foto, OGS sync, torneos, PWA, gamepad, ~60 módulos, con **su propio renderer de tablero** y motor **TensorFlow.js**. El 95% está fuera de alcance y forkearla pelearía con la decisión del spec (Preact + Shudan, marcada "no re-litigar" en CLAUDE.md). **No se forkea.**
- Sí se reúsa: **Shudan** (Sabaki) da el tablero + overlays de análisis casi gratis; y la **lógica de análisis de web-katrain (MIT)** se porta como funciones puras (suavizado de winrate, calidad de jugada, priorización de review, navegación de variaciones).

**Enfoque decidido: Preact + Shudan** (no forkear web-katrain). Razones: (1) calidad/mantenibilidad — código enfocado que poseemos vs heredar ~60 módulos ajenos; Shudan tiene soporte nativo de los overlays que necesitamos; (2) Cloudflare/tipo de app — bundle liviano (Preact ~3 KB vs React+TF.js) importa cuando el usuario ya baja 50–60 MB de red y el Worker sirve la SPA como static assets; (3) ya reemplazamos su núcleo TF.js por nuestro motor, así que forkear la UI para recablear el motor es más trabajo y peor resultado.

**Resultado esperado.** Un tengen desplegado en Cloudflare donde se puede: jugar 9/13/19 contra Human SL (20k–9d) o KataGo (por visitas) con fin de partida por estimación del motor; analizar SGF con heatmap de policy, winrate/score por jugada, PV y review progresivo; y —con cuenta Google— guardar/listar/reabrir partidas (SGF export/import siempre, sin cuenta).

**Nota de proceso.** El alcance es multi-subsistema: se ejecuta en fases, cada fase mayor con su propio ciclo brainstorm→spec→plan→**subagent-driven-development** (como se hizo con el motor). Este archivo es el **roadmap** + detalle concreto de las fases fundacionales; las fases de análisis/cuentas/deploy se detallan aquí a nivel de alcance + reúso + decisiones abiertas, y reciben su spec propio al llegar.

## Estado verificado del contrato (base para todo)

- `@tengen/engine` exporta `WorkerEngine`, `LocalEngine`, tipos (`Engine`/`Position`/`Move`/`Vertex`/`Analysis`/`MoveAnalysis`/`RankLevel`/`NetworkId`/`BoardSize`/`HumanRank`+`HUMAN_RANKS`), `WorkerRequest`/`WorkerResponse` (`packages/engine/src/index.ts`).
- Interfaz `Engine` (`types.ts:95-100`): `init({network,boardSize})`, `genMove(pos,{level})`, `analyze(pos,{visits},onUpdate)→CancelFn` (streaming, chunks de 32 visitas), `stop()`. **Una instancia/Worker por `boardSize`.** `winrate`/`scoreLead` SIEMPRE en perspectiva de Negro (no invertir). `ownership` llega `undefined` (ownershipMode:'none').
- Worker real: patrón Vite `new Worker(new URL('./engine.worker.ts', import.meta.url), {type:'module'})` (ref: `packages/engine/src/worker/smoke-main.ts:16-17`). `createWorkerHandler(engine, post)` es la unidad pura reutilizable (`engine.worker.ts:41`); el `engine.worker.ts` del engine hardcodea la factory `/models/` de dev → **apps/web necesita su PROPIO worker** que inyecte su factory.
- Carga de modelos: `LocalEngine` acepta `evaluatorFactory` inyectable (`engine.ts:96-103`); `OnnxEvaluator.create(source: string|ArrayBuffer, {boardSize, ep:'webgpu'})` (`nn/evaluator.ts:94`). **Cero código OPFS/R2 existe hoy** (solo docstrings) — es net-new.
- Vite infra reutilizable (`packages/engine/vite.config.ts`): middleware `serve-ort-dist` (**obligatorio** portar, con su header `COEP: require-corp` explícito por archivo, o Chrome bloquea el worker de ORT), `serve-models` (solo dev). WebGPU NO exige COOP/COEP; sí lo exige ORT-WASM multihilo. `ort.env.wasm.wasmPaths='/ort-dist/'` es default (`session.ts:37`).
- Monorepo: root `package.json` ya declara `workspaces: ["packages/*","apps/*"]`; `tsconfig.base.json` (strict + `noUncheckedIndexedAccess`). vite 6 / vitest 3 / TS 5.9. **Falta:** `@tengen/engine` no tiene campo `exports` (hoy se importa `src/` directo) → añadirlo en Fase 0. `@sabaki/go-board@1.4.3` YA instalado; `@sabaki/shudan` y `@sabaki/sgf` faltan.

## Roadmap por fases

| Fase | Entrega | Estado de diseño |
|---|---|---|
| 0 · Scaffold apps/web | proyecto Preact+Vite+TS, engine importable, worker propio, gate WebGPU | detallado aquí |
| 1 · Entrega de modelos | evaluatorFactory OPFS-cache + descarga R2/URL con progreso | detallado aquí |
| 2 · Jugar bien | flujo de partida completo (Shudan + go-board + WorkerEngine) | detallado aquí |
| 3a · Analizar (núcleo) | SGF + overlays + review progresivo (porta lógica web-katrain) | **COMPLETA** — [plan](2026-07-11-fase3a-analizar.md), ledger `.superpowers/sdd/progress.md` |
| 3b · Analizar (comentarios + biblioteca local) | comentarios de posición, biblioteca local de partidas | sin planear, fase separada |
| 4 · apps/worker base | Worker Hono: static assets + R2 para redes; deploy `tengen.kntor.io` | **COMPLETA y DESPLEGADA (2026-07-11)** — app pública viva en https://tengen.kntor.io (cuenta `kntor-dev`) — [spec](../specs/2026-07-11-fase4-deploy-worker.md), [plan](2026-07-11-fase4-deploy-worker.md), ledger `.superpowers/sdd/progress.md`. Pendiente: gate manual de Edgar en navegador real (WebGPU) |
| 5 · Cuentas + nube | D1 + better-auth (Google) + Turnstile + guardado/listado | alcance + decisiones; spec propio |
| 6 · CI + monitoreo upstream | Renovate + watcher upstream + Playwright (el deploy en sí ya pasó a Fase 4) | alcance |

La deuda del motor se cierra **en el borde de la app**, no como fase aparte: M-4 handicap + Task 13a (`visits<=0`) en Fase 2; M-1 (cancelación por-`id`) + M-2 (canal de error de `analyze`) en Fase 3.

## Fases fundacionales (detalle)

### Fase 0 — Scaffold `apps/web`
- Crear `apps/web/` (Preact + Vite + TS extendiendo `tsconfig.base.json`, JSX de Preact). Recogido por el workspace `apps/*` existente.
- Añadir `@sabaki/shudan`, `@sabaki/sgf` (go-board ya está). Añadir campo `exports` a `packages/engine/package.json` para importar `@tengen/engine` limpio.
- `apps/web/src/engine.worker.ts`: `createWorkerHandler(new LocalEngine({ evaluatorFactory: appFactory }), post)` reusando la función pura del engine (exportarla desde el barrel si hace falta). Instanciar con el patrón `new Worker(new URL(...))`.
- Portar middlewares de Vite (`serve-ort-dist` obligatorio; `serve-models` dev) + headers.
- **Gate WebGPU:** detección al arrancar → si no hay, pantalla "usa Chrome/Edge" (el análisis de SGF sin motor puede seguir usable, pero el gate primero). Ref: `session.ts` config de `ort.env.webgpu`.
- **Verificación:** `apps/web` levanta con `vite`, importa `WorkerEngine`, y un smoke inline hace `init`+`genMove` en tablero vacío contra un modelo servido en `/models/` (dev), imprimiendo la jugada. Reusa el patrón de `engine-smoke.html`.

### Fase 1 — Entrega de modelos (OPFS + R2)
- Implementar `appFactory: (net, boardSize) => Promise<NNEvaluator>`: (1) buscar `ArrayBuffer` de la red en **OPFS** (`navigator.storage.getDirectory()`); (2) si falta, `fetch` de R2/URL con **progreso** (streaming, tamaño total) y persistir en OPFS; (3) `OnnxEvaluator.create(buffer, {boardSize, ep:'webgpu'})`. Llamar `dispose()` al cambiar de red.
- Mapa `NetworkId → archivo/versión` (`/nets/<nombre>-<versión>.onnx`, headers inmutables — ver spec §Redes). En dev, apuntar a `/models/`; en prod, a R2.
- UX: barra de progreso de descarga (50–60 MB), reintento con resume si hay parcial en OPFS, manejo de descarga fallida (spec §Manejo de errores).
- **Verificación:** primera carga descarga y cachea; segunda carga lee de OPFS (sin red); jugar una partida corta contra cada red.

### Fase 2 — Modo Jugar (bien)
- **Tablero:** `@sabaki/shudan` Goban (verificar props exactas al montar: `signMap` para piedras, `markerMap`/`ghostStoneMap`, `vertexEvents`/click). Reglas en el hilo principal con `@sabaki/go-board` (legalidad/captura/display); el motor solo genera la jugada de la IA.
- **Config de partida:** tamaño 9/13/19, komi, handicap, reglas chinas/japonesas, oponente = Human SL (`{kind:'human', rank}`, poblar de `HUMAN_RANKS`) o KataGo (`{kind:'kata', visits}`, presets 50/200/500 — ver `visitPresets.ts` de web-katrain como referencia).
- **Bucle:** jugada del usuario (validada por go-board) → `engine.genMove` → aplicar; **pasar** y **rendirse**; **fin de partida** por dos pases → **estimación del motor** (score/ownership), sin marcado manual de muertas (decisión tomada; el marcado manual queda como mejora futura del propio spec de esta fase si se quiere subir calidad).
- **Árbol de jugadas** con variaciones (modelo `@sabaki/sgf`); navegación. Persistencia en **localStorage** (partida en curso sobrevive sin cuenta). **Export/import SGF** siempre.
- **Deuda del motor aquí:** validar `handicap` al configurar (M-4: `handicap>1` solo 19×19, fallar temprano y claro); clamp `visits>=1` antes de `genMove` (Task 13a).
- **Verificación:** jugar partidas completas 9/13/19 contra ambas redes; pasar/rendirse/fin-de-partida con resultado; export→import SGF idempotente; recargar la página conserva la partida.

### Fase 3 — Modo Analizar (bien) — *alcance; spec propio al llegar*
- Cargar SGF → navegar árbol → análisis **bajo demanda** por posición (`engine.analyze`, ~50 visitas, streaming con `CancelFn`).
- **Overlays sobre Shudan:** heatmap de policy (ghost stones/`heatMap`), panel winrate/score (persp. Negro), PV (líneas), gráfico de winrate a lo largo de la partida.
- **Review progresivo** de partida completa priorizando saltos de winrate (patrón OGS). **Reúso MIT de web-katrain** (portar por archivo, validando cada uno): `analysisSmoothing.ts`, `playedMoveQuality.ts`, `positionEval.ts`, `gameAnalysisProgress.ts`, `topMoveMetric.ts`, `branchNavigation.ts`, `analysisQueue.ts`.
- **Deuda del motor aquí:** M-1 (cancelación por-`id` en el Worker en vez del flag global — necesario cuando hay análisis concurrentes/rápida navegación) y M-2 (canal de error de `analyze`: hoy un fallo da 0 updates sin señal → la UI necesita `onError`/timeout). El review final los ubicó justo en este borde.
- **Decisión abierta (para su spec):** ¿bastan "jugadas clave" a 50 visitas para el review, o profundidad configurable? (pregunta abierta #3 del spec).

### Fase 4 — `apps/worker` base — *alcance; decisiones*
- Un Worker Cloudflare con **Hono** que sirve la SPA (static assets) + binding **R2** para las redes (o dominio público de R2 con caché de CF delante). `wrangler.jsonc`. Deploy inicial a `*.workers.dev`.
- **Decisiones:** subir las redes fp16 (b18 58 MB + humanv0 54 MB) a un bucket R2; versionado `/nets/<nombre>-<versión>.onnx` con caché inmutable. Confirmar headers para WebGPU/ORT en prod (COEP solo si se usa ORT-WASM multihilo; el path WebGPU no lo exige).

> **Nota (2026-07-11):** este párrafo original quedó superado por la spec/plan de Fase 4 (`2026-07-11-fase4-deploy-worker.md`) en dos puntos — se deja como registro histórico, no se reescribe: (a) "redes fp16" está revocado (fp16 produce policy NaN, ver corrección de CLAUDE.md 2026-07-10); la spec nueva sube los `.onnx` **fp32** reales (b18c384nbt 115.8 MB + humanv0 108.0 MB); (b) el dominio propio (`tengen.kntor.io`) se resuelve en ESTA fase, no en Fase 6 — `kntor.io` ya está en la misma cuenta de Cloudflare de Edgar.

### Fase 5 — Cuentas + nube — *alcance; spec propio*
- **D1:** tablas de better-auth + `games(id, user_id, name, sgf TEXT, board_size, result, created_at, updated_at)`.
- **Auth:** better-auth con Google OAuth; **Turnstile** en el registro. API JSON (Hono) para guardar/listar/reabrir; **rate limiting** por usuario/IP (protege D1). Offline-first: guardar en la nube falla con aviso y reintento, el SGF local nunca se pierde.
- **Decisiones abiertas (para su spec):** estrategia de sesión/cookies de better-auth, claves de Turnstile, versión de better-auth/hono, migraciones de D1.

### Fase 6 — CI + monitoreo upstream — *alcance*

> **Nota (2026-07-11):** el deploy (Worker + R2 + dominio custom `tengen.kntor.io`) ya se hizo en Fase 4 — no se esperó a esta fase (decisión de Edgar, ver plan de Fase 4). Lo que queda acá es CI + monitoreo + Playwright; cuando D1 exista (Fase 5) esta fase agrega sus secrets/deploy incremental, no un deploy desde cero.

- ~~Desplegar Worker + R2 + D1 a Cloudflare (workers.dev primero; dominio propio se decide al desplegar)~~ — Worker + R2 + dominio YA desplegados en Fase 4; D1 se agrega cuando exista Fase 5. Secrets (Google OAuth, Turnstile) vía wrangler, a agregar con Fase 5.
- **CI:** Renovate/Dependabot (npm) + watcher de `releases.atom` para lo no-npm (KataGo, web-katrain, katago-onnx, redes) — spec §Monitoreo, requisito permanente de Edgar; incluir el gate `test:nn` tras re-syncs.
- **Playwright** smoke e2e: abrir app, jugar una jugada vs nivel débil, cargar un SGF.

## Reúso clave (rutas concretas)

- **Motor:** `@tengen/engine` — `WorkerEngine`/tipos (`packages/engine/src/index.ts`, `types.ts`), `createWorkerHandler` (`worker/engine.worker.ts:41`), patrón de Worker (`worker/smoke-main.ts:16-17`), `evaluatorFactory` inyectable (`engine.ts:96-108`), `OnnxEvaluator.create(ArrayBuffer,…)` (`nn/evaluator.ts:94`).
- **Vite:** middlewares `serve-ort-dist`/`serve-models` + headers (`packages/engine/vite.config.ts`), `wasmPaths` default (`nn/session.ts:37`).
- **Sabaki:** `@sabaki/shudan` (overlays: ghostStoneMap/markerMap/heatMap/paintMap/lines), `@sabaki/go-board@1.4.3` (reglas, ya instalado), `@sabaki/sgf` (árbol con variaciones).
- **web-katrain (MIT, portar por archivo, no forkear):** lógica de análisis (`analysisSmoothing`, `playedMoveQuality`, `positionEval`, `gameAnalysisProgress`, `topMoveMetric`, `branchNavigation`, `analysisQueue`, `visitPresets`) en `~/dev/vendor/web-katrain/src/utils/`. Atribución MIT por archivo + `THIRD-PARTY-LICENSES` (mismo patrón que el vendoring del motor); registrar en `docs/research/fase-engine/adaptaciones-upstream.md`.

## Verificación (end-to-end)

- **Por fase:** el gate que define su brief + `tsc --noEmit` 0 + tests (Vitest reglas/SGF/UI; el motor ya tiene su suite 88/88 + `test:nn` 10/10 intactos).
- **Jugar:** partidas completas 9/13/19 vs Human SL y KataGo, con fin de partida y export/import SGF, en Chrome con WebGPU.
- **Analizar:** cargar un SGF real, ver heatmap/winrate/PV por posición y correr un review progresivo.
- **Cuentas:** login Google, guardar/listar/reabrir; offline-first (sin sesión sigue jugando/analizando).
- **Deploy:** app viva en `*.workers.dev` sirviendo SPA + redes desde R2; `npm run bench` no-regresión; Playwright smoke verde.
- **Manual (headless no puede WebGPU):** las verificaciones de Chrome/WebGPU las corre Edgar.

## Decisiones abiertas (a resolver en el spec de su fase)

1. ~~Bucket/dominio de R2 y esquema de versionado de redes (Fase 4).~~ **RESUELTO (2026-07-11):** bucket `tengen-models`, versionado por nombre de archivo (`b18c384nbt-kata1.fp32.onnx`, `b18c384nbt-humanv0.fp32.onnx`) — ver spec/plan de Fase 4.
2. ~~Dominio propio del producto (Fase 6, pregunta abierta #4 del spec).~~ **RESUELTO (2026-07-11):** `tengen.kntor.io`, resuelto en Fase 4 (no en Fase 6) — ver spec/plan de Fase 4.
3. ¿Marcado manual de piedras muertas como mejora de "jugar bien"? (hoy: estimación del motor — Fase 2).
4. Profundidad/estrategia del review progresivo (Fase 3, pregunta abierta #3).
5. better-auth: sesión, Turnstile, migraciones D1 (Fase 5).

## Backlog de features — inventario EXHAUSTIVO (clasifica Edgar)

Inventario **completo y sin priorizar** de la app de referencia **web-katrain** (54 componentes + 119 utils + hooks + data, en `~/dev/vendor/web-katrain/src`), más clásicos de **Sabaki-editor** marcados *[validar]*. Deliberadamente NO asigno prioridad ni "dentro/fuera de alcance" — **eso lo clasifica Edgar**. Agrupado solo para leerlo; cada ítem lleva su archivo fuente para poder mirarlo. (MIT → cualquiera que se replique se porta con atribución + `THIRD-PARTY-LICENSES`.)

**Jugar / partida:** nueva partida (`quickNewGame`, `NewGameModal`) · colocación de piedra + fuzzy/tap (`stonePlacementMove`, `fuzzyPlacement`, `tapConfirm`) · lógica de juego (`gameLogic`) · pasar/rendirse (`resign`, `ResignConfirmModal`) · reloj/tiempo (`katrainTimer`, `Timer`) · personalidades de bot (`botPersonas`, `BotPersonaPicker`) · gauntlet vs bots (`gauntlet`) · torneos (`tournament`, `TournamentModal`, `useTournamentWatcher`) · sonido (`sound`) · vibración/háptica (`haptics`).

**Análisis:** cola/cobertura/clave de análisis (`analysisQueue`, `analysisCoverage`, `analysisPositionKey`) · suavizado + resumen (`analysisSmoothing`, `analysisSummary`) · eval por nodo/posición/jugada (`nodeAnalysis`, `positionEval`, `moveInsight`, `bestMoveSummary`, `topMoveMetric`) · calidad de la jugada jugada (`playedMoveQuality`) · review de partida completa + reporte (`gameAnalysisProgress`, `gameReport`, `GameAnalysisModal`, `GameReportModal`) · review rápido (`fastReviewButtonState`) · gráfico winrate/score + teclado/tema (`ScoreWinrateGraph`, `scoreWinrateGraphTheme`, `graphDataAvailability`, `graphKeyboard`) · candidatas + variaciones fijadas (`CandidatePvTiles`, `pinnedVariations`) · panel + command bar + caché (`AnalysisPanel`, `AnalysisCommandBar`, `AnalysisCacheClearConfirmModal`) · diagnóstico/estado del motor (`engineDiagnostics`, `engineStatusSummary`, `engineLabel`, `backendAvailability`) · etiquetas narrativas/de partida (`narrativeTags`, `gameTags`) · análisis embebido en SGF (`katrainSgfAnalysis`, `kayaSgfAnalysis`) · patrones/joseki (`boardPatterns`, `boardPatternLibrary`) · coach de formas (`shapeCoachNote`).

**Conteo / fin de partida:** conteo (`scoring`) · marcado manual de piedras muertas (`manualScore`, `ManualScorePanel`).

**Estudio / entrenamiento:** adivina la jugada (`guessMove`, `GuessMoveModal`) · problemas/tsumego (`problemMode`, `ProblemModal`) · lecciones (`lessons`, `LessonsModal`) · quiz de conteo (`ScoreQuizModal`) · partidas profesionales (`proGames`, `ProGamesModal`, `preloadedGames`) · diagramas/impresión de kifu (`kifuDiagrams`, `KifuPrintModal`, `print`).

**Árbol de jugadas / navegación:** árbol de variaciones + layout/comandos/teclado/marcadores (`MoveTree`, `moveTreeLayout`, `moveTreeCommands`, `moveTreeKeyboard`, `moveTreeNodeMarkers`) · navegación de ramas (`branchNavigation`) · navegación por teclado/swipe/rueda/gamepad (`boardKeyboardNavigation`, `swipeNavigation`, `wheelNavigation`, `gamepadNavigation`).

**SGF / import-export:** parse SGF (`sgf`) · pegar SGF (`pasteSgfInput`, `PasteSgfModal`) · import por drag/texto + validación + resumen (`dragImport`, `libraryTextImport`, `libraryImportValidation`, `importSummary`) · compartir por link (`shareLink`) · exportar imagen del tablero / snapshots (`boardImageExport`, `boardSnapshot`, `reportBoardSnapshot`, `boardQaSnapshot`) · descarga + progreso + nombre de archivo (`downloadProgress`, `filename`, `objectUrl`).

**Biblioteca / persistencia:** biblioteca de partidas + guardar + zip + teclado (`library`, `LibraryPanel`, `SaveToLibraryDialog`, `libraryZip`, `libraryKeyboard`) · autosave + recuperación + cambios sin guardar + estado de guardado (`autoSave`, `AutoSaveRecoveryModal`, `UnsavedChangesModal`, `saveStatusDisplay`) · storage local + preferencias de layout (`storage`, `layoutPreferences`) · info de partida (`gameInfoText`, `gameInfoDisplay`, `GameInfoPanel`) · notas/comentarios + editor + preview (`NotesPanel`, `noteEditorState`, `noteEditorKeys`, `notePreview`).

**Import avanzado (visión) / online:** foto del tablero (`photoBoard`, `photoBoardRecognition`, `PhotoBoardModal`) · cámara (`cameraAvailability`, `CameraCaptureModal`) · video→SGF (`videoToSgf`, `VideoBoardModal`) · subir modelo propio (`modelUpload`) · OGS + sync (`ogs`, `ogsSync`, `OgsSyncModal`).

**Shell / UX / accesibilidad:** paleta de comandos (`commandPalette`, `CommandPaletteModal`) · atajos de teclado + ayuda + config (`shortcuts`, `useKeyboardShortcuts`, `useShortcutLabels`, `ShortcutSettingsPanel`, `KeyboardHelpModal`) · ajustes (`SettingsModal`, `settingsTabs`) · i18n (`locales`, `LanguageSwitcher`, `languageSwitcherNavigation`) · temas UI/tablero (`uiThemes`, `katrainTheme`, `boardThemes`, `useResolvedUiTheme`) · layout responsive/móvil (`responsiveLayout`, `dashboardLayout`, `MobileHome`, `MobileTabBar`, `MenuDrawer`, `Top/Bottom/StatusBar`, `RightPanel`) · gamepad (`gamepadAccess`, `gamepadLabel`, `useGamepadNavigation`) · pantalla completa (`fullscreen`) · PWA (`pwa`, `pwaOpen`, `PwaInstallBanner`) · notificaciones (`timedNotification`, `NotificationToast`) · errores/QA (`errorReporting`, `AppErrorBoundary`) · about/versión (`AboutDialog`, `appInfo`, `versionMetadata`) · portapapeles (`clipboard`) · cerrar con Escape (`useEscapeToClose`).

**Helpers de infra (no son features de usuario, listados por exhaustividad):** `animationFrame`, `resizeObserver`, `mediaQuery`, `visualViewport`, `objectUrl`, `keyboardTarget`, `publicUrl`, `browserWorker`, `boardSize`, `numberDraft`, `lib/gtp`.

**Clásicos de Sabaki-editor a validar contra la app real:** find/buscar posición · autoplay · copiar/pegar región del tablero · toggle de coordenadas · numeración de jugadas · edición de propiedades de nodo SGF · marcado en tablero (triángulo/cuadro/círculo/cruz/etiqueta/flecha/dim) · anotaciones de jugada y de posición (buena/mala/dudosa; ventaja negro/blanco/pareja/incierta).

Nota: el v1 de este plan (Fases 0–6) cubre solo el subconjunto jugar+analizar+cuentas descrito arriba; el resto de este inventario es material para que Edgar clasifique y priorice en iteraciones siguientes, cada ítem por su propio ciclo brainstorm→spec→plan→SDD.

## Cómo se ejecuta

Cada fase mayor: brainstorm (acotar) → spec en `docs/superpowers/specs/` → plan en `docs/superpowers/plans/` → **subagent-driven-development** (implementer → review por-tarea → fix), en una rama por fase. Empezar por Fases 0–2 (fundación + jugar), que ya entregan un tengen jugable y desplegable; Analizar y Cuentas siguen con su propio ciclo.


If you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/kntor/.claude/projects/-Users-kntor-dev-tengen/848b85ed-a2eb-403c-842f-517fd9905e98.jsonl
