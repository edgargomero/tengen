# Plan: Fase 5 — Cuentas + partidas en la nube (login Google + D1 + backup a Drive)

**Nota:** este plan reemplaza el anterior ("4 quick wins de UI/UX", completado, `3c258b0`, desplegado).

## Context

Implementa el spec **aprobado y committeado** `docs/superpowers/specs/2026-07-13-fase5-cuentas-design.md` (`0819a30`). Decisiones de producto firmes (no re-litigar): login Google **opcional** vía better-auth; **D1 = fuente de verdad** (guardado automático en cada jugada/edición); **backup a Drive del usuario** (scope `drive.file`, pedido en el login inicial) **solo al terminar** la partida (Jugar) o al salir (Analizar); pantalla **"Mis partidas"** (`/partidas`) con reapertura en ambos modos; reabrir+editar actualiza **in-place**; **sin Turnstile**; proyecto GCP nuevo dedicado.

Viabilidad ya verificada (Context7 + docs Cloudflare, no memoria): better-auth soporta D1 nativo (`database: env.DB`); mount Hono `app.on(['GET','POST'], '/api/auth/*', c => auth.handler(c.req.raw))`; `auth.api.getSession({headers})`; `auth.api.getAccessToken({body:{providerId:'google', userId}, headers})` devuelve el token de Google auto-refrescado; provider google con `accessType:'offline'` + `prompt:'select_account consent'` + scope extra drive.file; cliente vanilla `createAuthClient` con `useSession.subscribe` (usable en Preact vía useEffect). Rate limiting binding de Workers es **GA** (config `ratelimits` en wrangler.jsonc).

Estado actual: `apps/worker/src/index.ts` (54 líneas: R2 passthrough /models y /ort-dist + fallback ASSETS; `Env {MODELS, ASSETS}`); tests worker con vitest-pool-workers que toman bindings de wrangler.jsonc (`app.request(path, {}, env)` + `declare module 'cloudflare:test' {interface ProvidedEnv extends Env {}}`); apps/web sin capa `/api` (único fetch: descarga de modelos en ModelGate), sin estado global entre rutas (único canal cross-vista: localStorage `tengen:game:v1`, payload `{opponent, sgf, cursorPath}` en `game/persistence.ts`); `PlayApp` (main.tsx) restaura **síncrono** con remount por `key={sessionKey}`; `PlayView.persist()` se llama tras cada jugada aplicada; `AnalyzeView` arranca en `SgfPicker` y no persiste nada.

**Proceso**: edición directa por el controlador (sin Workflow/subagentes — memoria `no-workflow-sin-pedirlo`). Primer paso de la ejecución: copiar este plan a `docs/superpowers/plans/2026-07-13-fase5-cuentas.md` y committearlo (convención del repo). Trabajo en `main` (patrón de la sesión).

## Decisiones de diseño (resueltas, con justificación)

1. **better-auth per-request con factory memoizada** — `createAuth(env)` con `WeakMap<Env, Auth>` en `apps/worker/src/auth.ts`. NO `import {env} from 'cloudflare:workers'`: los tests inyectan env por request (`app.request(path, {}, env)`) y esa inyección es la palanca para testear (p.ej. 429 con `{...env, LIMITER: fake}`). En prod `env` es estable por isolate → memoiza de facto.
2. **Migraciones = SQL committeado**, NO `getMigrations` en runtime: `apps/worker/migrations/0001_better_auth.sql` (generado UNA vez con `npx @better-auth/cli generate`, revisado) + `0002_games.sql` (a mano). Aplicación: `wrangler d1 migrations apply tengen-db` (local / `--remote`). Razones: determinismo (el schema en git, no el que decida un cold start), DDL revisable en el diff, y es el formato que consume el paved road de tests (`readD1Migrations` + `applyD1Migrations` en setupFile — necesario igual porque el isolated storage recrea D1 por test).
3. **Reapertura vía `pendingOpen.ts`** (singleton in-memory take-once, puro y testeable): `PartidasView` hace `GET /api/games/:id` → `setPendingOpen({id, mode, sgf, opponent?})` → `route('/jugar'|'/analizar')`. Jugar: `restoreSession()` chequea `takePendingOpen('jugar')` primero y **espeja de inmediato** a localStorage (`saveGame` con cloudId) — sin eso, un refresh pre-primera-jugada restauraría la partida local vieja; con eso, el refresh post-reapertura funciona gratis por el camino existente. Analizar: el inicializador de estado consume `takePendingOpen('analizar')` y salta el SgfPicker con `gameId` en estado. Rechazados: sessionStorage (serialización+guard extra sin beneficio — `route()` es navegación SPA, no hay unload) y query param+fetch (rompería la restauración síncrona deliberada de PlayApp).
4. **Schema games con columna extra `opponent TEXT nullable`** (RankLevel JSON, solo mode='jugar') — ajuste al spec: el SGF no lleva opponent y sin él no se puede reabrir en Jugar. `isPersistedGame` actual NO rechaza campos extra → agregar `cloudId?: string` a `PersistedGame` sin bumpear STORAGE_KEY (extender guard: `v.cloudId === undefined || typeof v.cloudId === 'string'`).
5. **Cliente de sync split puro/hook** (mismo patrón ModelGate/ensureModel): `cloud/api.ts` (wrappers con fetch inyectado) + `cloud/gameSync.ts` (Node-testeable: sin gameId → POST y guarda el id; con id → PUT; **coalescing última-gana con un solo request en vuelo** — evita POST duplicado en jugada humana + respuesta IA <1s; retry backoff 2s/5s/15s; nunca lanza; estados 'idle'|'saving'|'saved'|'error' vía onStatus) + `cloud/useCloudSync.ts` (hook: suscribe sesión; sin sesión, save/finish son no-ops → cero llamadas, comportamiento idéntico a hoy) + `cloud/SyncBadge.tsx` (indicador: guardando/guardado/error+botón reintentar).
6. **Drive server-side en el Worker**: `drive.ts` puro (recibe accessToken, no conoce better-auth ni Hono): `ensureTengenFolder` (files.list q por nombre+mimeType folder → files.create si falta; con drive.file el list solo ve lo creado por la app) + `uploadSgf` (sin fileId → POST `upload/drive/v3/files?uploadType=multipart` con parents; con fileId → PATCH `uploadType=media`; **PATCH 404 → fallback re-crear**, el usuario pudo borrar el archivo de su Drive). Endpoint `POST /api/games/:id/drive-backup` (requireUser + ratelimit): fila propia o 404 → getAccessToken → ensure+upload → UPDATE drive_file_id. Errores de Google → 502; nunca revierte D1. Tests con `fetchMock` de `cloudflare:test` (disableNetConnect + interceptores de googleapis.com).
7. **Sesiones en tests del worker**: helper `tests/authSeed.ts` — inserta `user`/`session`/`account` directo en D1 y fabrica la cookie `better-auth.session_token=<token>.<hmac>` (HMAC-SHA256 base64url con el secret de test). ⚠️ Formato interno de better-auth: **verificar contra node_modules al implementar**; la fila `account` seedeada lleva `access_token` con expiry futuro para que getAccessToken no llame a Google en tests. Análogo: verificar el nombre exacto del campo de scopes del provider (`scope` vs `scopes`) contra los tipos instalados.

## Tasks

### Task 1 — Worker: D1 + better-auth montado
- `wrangler.jsonc`: `d1_databases: [{binding:'DB', database_name:'tengen-db', database_id:<de wrangler d1 create>, migrations_dir:'migrations'}]`; `ratelimits: [{name:'LIMITER', namespace_id:'1001', simple:{limit:100, period:60}}]`; `vars: {BETTER_AUTH_URL:'https://tengen.kntor.io'}`. **Yo corro `npx wrangler d1 create tengen-db`** (Cloudflare ya autenticado en esta máquina).
- `apps/worker/package.json`: + `better-auth`.
- `migrations/0001_better_auth.sql` (generado + revisado: tablas user/session/account/verification); `src/auth.ts` (createAuth memoizada + middleware `requireUser` que setea `userId` en Variables o devuelve 401).
- `src/index.ts`: extender `Env` (`DB: D1Database; LIMITER: RateLimit; GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/BETTER_AUTH_SECRET/BETTER_AUTH_URL: string`) + mount `/api/auth/*` ANTES del fallback ASSETS.
- `vitest.config.ts` (forma async): `readD1Migrations('./migrations')` → `miniflare.bindings {TEST_MIGRATIONS, BETTER_AUTH_SECRET:'test-secret', GOOGLE_CLIENT_ID/SECRET:'test', BETTER_AUTH_URL:'http://localhost:8787'}` + setupFile `tests/applyMigrations.ts` (`applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`).
- `.dev.vars.example` committeado (documenta que el dev de esta fase es `wrangler dev` :8787 — Vite solo no tiene API); `.dev.vars` real al .gitignore.
- Tests (`tests/auth.test.ts`): tablas better-auth existen post-migración (sqlite_master); `/api/auth/get-session` sin cookie responde better-auth (no cae al fallback ASSETS); los 11 tests existentes siguen verdes.

### Task 2 — Worker: API /api/games + rate limiting
- `migrations/0002_games.sql`: tabla `games` (id TEXT PK, user_id NOT NULL REFERENCES user(id), name NOT NULL, sgf NOT NULL, board_size NOT NULL, mode CHECK IN ('jugar','analizar'), result NULL, opponent NULL, drive_file_id NULL, created_at, updated_at) + índice `(user_id, updated_at DESC)`.
- `src/games.ts`: data access (insert/update/list —sin columna sgf, ORDER BY updated_at DESC—/get/setDriveFileId, todas scoped a user_id) + sub-app Hono con requireUser y rate limit en escrituras (key=userId, 429 con mensaje claro). Validación: sgf string no vacío ≤256KB, mode/board_size válidos, opponent JSON válido u omitido. `id = crypto.randomUUID()`.
- `src/index.ts`: `app.route('/api/games', gamesApp)`.
- `tests/authSeed.ts` + `tests/games.test.ts`: 401×4 sin cookie; POST crea (fila verificable con env.DB); PUT actualiza in-place; PUT ajeno/inexistente → 404; GET lista solo propias, sin sgf, ordenada; GET /:id completa; 400 payload inválido; 429 inyectando `{...env, LIMITER: {limit: async () => ({success:false})}}`. Si el pool aún no mapea `ratelimits` a miniflare: todos los tests de escritura inyectan fake limiter success:true (el binding real lo valida el gate manual de Task 7).

### Task 3 — Worker: backup a Drive
- `src/drive.ts` (decisión 6) + ruta `POST /:id/drive-backup` en games.ts.
- `tests/drive.test.ts` con fetchMock: folder create/reuse; upload multipart en alta / PATCH en update / fallback re-crear ante PATCH 404; ruta completa (sesión seedeada + account con token vigente) → intercepta Google y verifica drive_file_id actualizado en D1; 401 sin sesión; 404 partida ajena.

### Task 4 — Web: cliente auth + UI de sesión
- `apps/web/package.json`: + `better-auth`.
- `src/cloud/authClient.ts` (`createAuthClient()` — same-origin, sin baseURL) + `src/cloud/useSession.ts` (hook Preact: useState + useEffect con `authClient.useSession.subscribe(cb)` y unsubscribe en cleanup).
- `main.tsx` `ModeMenu`: sin sesión → botón "Iniciar sesión con Google" (`signIn.social({provider:'google', callbackURL:'/'})`); con sesión → email/avatar + "Cerrar sesión" (`signOut()`) + link "Mis partidas" → `/partidas`.
- Sin tests de componente (el repo no testea UI); typecheck + suite verde. Gate manual: login/logout end-to-end en `wrangler dev`.

### Task 5 — Web: sync + integración PlayView/AnalyzeView
- `src/cloud/api.ts`, `gameSync.ts`, `useCloudSync.ts`, `SyncBadge.tsx` (decisión 5).
- `game/persistence.ts`: `cloudId?` en payload + guard + firmas (`saveGame(storage, opponent, tree, cloudId?)`; `loadGame` lo devuelve).
- `ui/PlayView.tsx`: prop `cloudId?`; en `persist()` (único punto — ya se llama tras CADA jugada aplicada) agregar `cloud.save(snapshot)` y pasar `cloud.gameId` al saveGame local; `cloud.finish()` (save final con result + backupToDrive) en las 2 ramas terminales de `finishTurn` y en `handleResign`. `name` autogenerado en el primer snapshot (p.ej. "9×9 vs 15k — 2026-07-13").
- `ui/AnalyzeView.tsx`: `cloud.save` al final de `handleEditVertexClick`; `backupToDrive()` fire-and-forget envolviendo `onBack`/`onLoadAnother`.
- `main.tsx`: `Session.cloudId` + plumbing restoreSession → PlayView.
- Tests: `tests/gameSync.test.ts` (fetch mockeado: POST primera vez y captura de id; PUT después; coalescing última-gana con save durante vuelo; retry/backoff y retryNow; backupToDrive no-op sin id; nunca lanza) + ampliar `tests/persistence.test.ts` (round-trip con cloudId; payload viejo sin cloudId sigue cargando; cloudId de tipo inválido → null).

### Task 6 — Web: /partidas + reapertura
- `src/cloud/pendingOpen.ts` (take-once por modo) + `src/ui/PartidasView.tsx` (con sesión → listGames y tabla name/fecha/tamaño/resultado/modo, error `.play-error`+reintentar; sin sesión → mensaje + botón login; click → getGame → setPendingOpen → route).
- `main.tsx`: `<PartidasView path="/partidas" onBack={() => route('/')} />`; `restoreSession()` consulta `takePendingOpen('jugar')` primero (importSgf + validateConfig reusando el try/catch existente + espejo saveGame con cloudId).
- `ui/AnalyzeView.tsx`: inicializador consume `takePendingOpen('analizar')` → salta SgfPicker con gameId.
- Tests: `tests/pendingOpen.test.ts` (consume una vez; modo equivocado no consume ni devuelve; vacío → null).

### Task 7 — Verificación e2e + deploy (bloqueada por pasos de Edgar)

## Pasos operativos de Edgar
- **Bloquean el gate manual de Task 1 (no el desarrollo de Tasks 1-6, cuyos tests no usan Google real)**: GCP Console — proyecto nuevo dedicado a tengen → pantalla de consentimiento OAuth "External" **publicada** (con scope drive.file; al ser no-sensible no exige la verificación pesada) → habilitar Google Drive API → OAuth Client "Web application" con orígenes `https://tengen.kntor.io` y `http://localhost:8787`, redirects `.../api/auth/callback/google` en ambos → crear `apps/worker/.dev.vars` con GOOGLE_CLIENT_ID/SECRET reales + BETTER_AUTH_SECRET dev + BETTER_AUTH_URL=http://localhost:8787.
- **Bloquean Task 7**: `wrangler d1 migrations apply tengen-db --remote`; `wrangler secret put GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `BETTER_AUTH_SECRET` (openssl rand -base64 32); deploy.

## Verificación
1. Por task: `npx -w @tengen/worker tsc --noEmit` + `npm test -w @tengen/worker`; `npx -w @tengen/web tsc --noEmit` + `npm test -w @tengen/web` (línea base 387) + `npm run build -w @tengen/web`.
2. Local (cuando exista .dev.vars de Edgar): `wrangler dev` :8787 → login Google real; jugar → filas en D1 local; terminar partida → archivo .sgf en la carpeta "tengen" del Drive real; /partidas lista y reabre en ambos modos; editar reabierta = update in-place (misma fila); offline (Network throttling) → juego 100% local con badge "reintentando" y recuperación al volver la red.
3. Producción (Task 7, tras confirmación explícita de Edgar como siempre): migración remota + secrets + deploy → repetir checklist del spec en tengen.kntor.io; verificar filas con `wrangler d1 execute --remote`; ráfaga de escrituras → 429 sin crash.

## Riesgos señalados
(a) Firma de la cookie de sesión en tests acoplada a internals de better-auth — verificar contra el source instalado al implementar; (b) soporte de `ratelimits` en vitest-pool-workers incierto — fallback de inyección de env ya diseñado; (c) campo `scope` vs `scopes` del provider google — verificar tipos instalados; (d) el flujo de dev de esta fase pasa a `wrangler dev` (Vite solo no tiene API) — documentado en .dev.vars.example.
