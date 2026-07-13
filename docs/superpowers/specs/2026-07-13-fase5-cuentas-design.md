# Fase 5 — Cuentas + partidas en la nube (login Google + D1 + backup a Drive)

**Fecha:** 2026-07-13 · **Estado:** aprobado por Edgar · **Fase:** [Fase 5 del roadmap](../plans/2026-07-10-tengen-v1-roadmap.md) · **Spec de producto:** [`2026-07-08-tengen-design.md`](2026-07-08-tengen-design.md)

## Contexto y objetivo

Hoy `apps/worker` es un Hono mínimo que sirve la SPA + los ONNX desde R2 (`apps/worker/src/index.ts`) — sin auth, sin D1, sin ningún concepto de "usuario". El guardado de partidas es 100% local (`apps/web/src/game/persistence.ts`, `localStorage`, formato `{opponent, sgf, cursorPath}`), y Modo Analizar no persiste nada en absoluto (solo import/export manual de SGF).

Fase 5 agrega cuentas: login con Google, y la posibilidad de guardar partidas (Jugar y Analizar) en la nube en vez de (además de) solo en el navegador local — con una pantalla para listar y reabrir esas partidas desde cualquier dispositivo.

**Decisión de arquitectura de storage tomada en el brainstorm (ver §Decisiones), NO trivial — un lector rápido del roadmap original esperaría "solo D1"**: el storage es **híbrido D1 + Google Drive del usuario**, no solo D1. Ver razonamiento completo en §Decisiones.

## Alcance

**Dentro de esta fase:**
- Login con Google (único proveedor) vía `better-auth`, opcional — Jugar y Analizar siguen funcionando sin cuenta exactamente como hoy (offline-first, ya decidido en el roadmap).
- D1 como fuente de verdad de las partidas guardadas (tabla `games`), actualizada en tiempo real.
- Backup automático de cada partida terminada a una carpeta propia de tengen en el Google Drive del usuario (scope `drive.file`).
- Pantalla nueva **"Mis partidas"**: lista las partidas guardadas del usuario, reabre una en el modo correcto (Jugar o Analizar).
- Aplica a **ambos modos**: Jugar y Analizar.
- API JSON en `apps/worker` para guardar/listar/reabrir, con rate limiting por usuario en las rutas de escritura.

**Explícitamente fuera de esta fase** (decisiones tomadas en el brainstorm, no re-litigar en el plan):
- **Turnstile** — no hay formulario de registro propio (login 100% OAuth de Google, que ya maneja su propio anti-bot); el endpoint de guardado se protege con rate limiting, no con un challenge interactivo. Si en el futuro aparece un formulario público real (compartir partida, etc.), Turnstile se evalúa ahí, en su propio ciclo.
- **Cloudflare Zero Trust / Access** como mecanismo de login — evaluado y descartado, ver §Decisiones.
- Cualquier otro proveedor de login que no sea Google.
- Edición/eliminación de partidas guardadas desde "Mis partidas" (solo listar + reabrir en esta fase).
- Compartir partidas entre usuarios o públicamente.

## Decisiones tomadas en el brainstorm (con su razonamiento)

1. **Login opcional, no gate.** Jugar/Analizar sin cuenta siguen funcionando igual que hoy — coherente con "offline-first" ya escrito en el roadmap. Loguearse solo habilita guardar/listar/reabrir en la nube.

2. **Storage híbrido D1 + Google Drive, no solo D1.** Edgar propuso usar el Google Drive de cada usuario como storage, aprovechando el mismo login. Verificado (no asumido) que `drive.file` es un [scope NO sensible de Google](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) — no dispara el proceso pesado de verificación OAuth que sí exigen los scopes sensibles/restringidos. Pero `better-auth` necesita una DB propia para usuarios/sesiones de todos modos (D1), así que "Drive en vez de D1" era una falsa dicotomía: la pregunta real era dónde viven las *partidas*, no el login. Resuelto como **híbrido**: D1 = fuente de verdad (rápida, queryable, con listado/filtro SQL real); Drive = backup adicional que el usuario puede ver/exportar él mismo desde su propio Drive, vía la carpeta oculta que crea la app (`drive.file`: solo archivos creados por tengen, nunca acceso al resto del Drive del usuario).

3. **Cloudflare Zero Trust/Access, descartado para el login.** Verificado (no asumido): [gratis hasta 50 usuarios únicos/mes, luego $7/usuario/mes sin facturación parcial](https://www.cloudflare.com/plans/zero-trust-services/). Ese modelo de costo-por-usuario-único-mensual es incompatible con un producto **público y gratuito** que se espera que crezca (CLAUDE.md: "producto gratuito → costo marginal manda") — el costo escalaría directamente con el éxito de tengen. Además Access está pensado para gatear apps de audiencia acotada (equipos/colaboradores), no un login público self-service abierto a cualquiera con cuenta de Google. `better-auth` (self-hosted, sin costo por usuario, corriendo en el propio Worker+D1) es la opción correcta.

4. **Trigger de guardado en D1: automático, en tiempo real.** Cada jugada aplicada en Jugar (humana o IA), o cada edición de variación en Analizar, dispara un guardado — mismo momento que ya dispara `persist()` a `localStorage` hoy, en paralelo (best-effort, no bloqueante).

5. **Trigger de backup a Drive: solo al terminar la partida, no por jugada.** Si Drive se disparara en el mismo momento que D1 (cada jugada), serían 20-40 escrituras a la Drive API por partida — ruido innecesario y riesgo de rate limit de Google. D1 sigue actualizándose en tiempo real (decisión 4); Drive solo se sincroniza una vez, al final.

6. **"Mis partidas" (listar + reabrir) SÍ entra en esta fase**, no se difiere. Sin esto, guardar en la nube no tendría forma de usarse todavía.

7. **Analizar: reabrir + editar variación actualiza in-place**, no crea copia. Mismo comportamiento que Jugar (se guarda solo, sobre la misma partida) — más simple y consistente en toda la app. Cargar un SGF nuevo desde archivo local (nunca antes guardado) sigue creando una fila nueva en su primer guardado, como siempre.

8. **Proyecto de Google Cloud nuevo, dedicado a tengen** (no reusar uno de otro producto kntor) — evita mezclar scopes/cuotas. Edgar lo crea él mismo (requiere su cuenta de Google); ver §Pasos operativos.

## Viabilidad técnica verificada (Context7, no asumida de memoria)

- `better-auth` soporta **D1 nativamente** desde v1.5: `betterAuth({ database: env.DB })`, sin adapter custom — D1 usa `batch()` para atomicidad (D1 no soporta transacciones interactivas).
- Migraciones en Workers (sin CLI interactiva): `getMigrations`/`runMigrations` de `better-auth/db/migration` (compatible con el adapter Kysely integrado, que es el que usa D1).
- El scope `drive.file` se puede pedir **en el mismo login inicial** de Google (`socialProviders.google.scope: [...]`) — no hace falta un segundo flujo de consentimiento por separado.
- `accessType: "offline"` + `prompt: "select_account consent"` garantizan que Google emita un `refresh_token` siempre (necesario para poder llamar la Drive API después de que expire el access token inicial).
- `auth.api.getAccessToken({ providerId: "google", userId })` (server-side, dentro de una ruta de Hono) devuelve el access token de Google **ya refrescado si hace falta** — el Worker puede llamar la Drive API sin manejar el refresh a mano.

## Arquitectura

```
apps/worker (Hono)
├── auth = betterAuth({ database: env.DB, socialProviders: { google: {...} } })
├── app.all('/api/auth/*', ...) → auth.handler (login, callback, sesión, linkSocial)
├── middleware de sesión (better-auth) en las rutas /api/games/*
├── POST   /api/games        → crea partida nueva (primer guardado)
├── PUT    /api/games/:id    → actualiza partida existente (jugadas/ediciones siguientes)
├── GET    /api/games        → lista partidas del usuario autenticado (paginado simple)
├── GET    /api/games/:id    → trae una partida para reabrir
└── (ya existía) /models/*, /ort-dist/*, fallback a ASSETS
```

Sesión: cookies HTTP-only, same-origin — el Worker ya sirve API + SPA desde `tengen.kntor.io`, sin necesidad de CORS cross-domain ni tokens en `localStorage`.

## Modelo de datos (D1)

- Tablas propias de `better-auth`: `user`, `session`, `account` (acá vive el `access_token`/`refresh_token` de Google, gestionados por la librería), `verification`. Se generan/migran con `getMigrations`.
- Tabla nueva `games`:

| columna | tipo | nota |
|---|---|---|
| `id` | TEXT (uuid) | generado al primer guardado |
| `user_id` | TEXT | FK a `user.id` de better-auth |
| `name` | TEXT | autogenerado (oponente + fecha) por ahora, sin UI de renombrar en esta fase |
| `sgf` | TEXT | mismo formato que ya produce `exportSgf(tree)` |
| `board_size` | INTEGER | 9/13/19, para mostrar en "Mis partidas" sin parsear el SGF |
| `mode` | TEXT | `'jugar'` \| `'analizar'` — para filtrar y saber a qué vista reabrir |
| `result` | TEXT (nullable) | mismo valor que `tree.meta.result` (canal RE del SGF), null mientras la partida sigue en curso |
| `drive_file_id` | TEXT (nullable) | id del archivo en Drive una vez hecho el backup; reusado para actualizar en vez de duplicar |
| `created_at` / `updated_at` | INTEGER (epoch ms) | — |

## Flujo de guardado

**Jugar** (`PlayView.tsx`): mismo punto donde hoy se llama `persist()` (tras cada jugada humana o de la IA aplicada al árbol) se agrega un guardado a la nube best-effort:
- Si la partida no tiene `id` de D1 todavía (primera jugada de esta sesión con sesión activa) → `POST /api/games`, guarda el `id` devuelto en el estado del componente.
- Si ya tiene `id` → `PUT /api/games/:id` con el SGF actualizado.
- Sin sesión activa: no se llama nada — comportamiento idéntico a hoy (solo `localStorage`).
- Al terminar la partida (`finishTurn`/resign, mismo lugar donde se setea `tree.meta.result`) → dispara el backup a Drive (sube/actualiza el `.sgf` en la carpeta de la app, guarda `drive_file_id` en la fila de D1 vía un último `PUT`).

**Analizar** (`AnalyzeView.tsx`): mismo patrón, pero el trigger es `handleEditVertexClick` (edición de variación) en vez de una jugada — Analizar no tiene turno de IA. Reabrir una partida desde "Mis partidas" carga su `id` de D1 junto con el árbol, así que las ediciones subsiguientes hacen `PUT` sobre esa misma fila. Un SGF nuevo importado desde archivo local no tiene `id` todavía — su primera edición hace `POST`. El backup a Drive se dispara al salir de la sesión de análisis (botón "Volver" / "Cargar otro SGF") — Analizar no tiene un "fin de partida" natural como Jugar.

**Best-effort en ambos casos**: un fallo de red/API en el guardado a D1 muestra un aviso no bloqueante con reintento (mismo espíritu que el resto de la app: "sin feedback silencioso" es una decisión ya tomada en la ronda de quick-wins anterior) — el `localStorage` sigue siendo la fuente de verdad local y nunca se pierde nada. Un fallo en el backup a Drive es independiente: si D1 tuvo éxito, la partida ya está segura (D1 + local); Drive es un plus, no una dependencia dura.

## UI nueva

- **Estado de sesión** en `ModeMenu` (`main.tsx`): botón "Iniciar sesión con Google" si no hay sesión; avatar/email + "Cerrar sesión" si la hay.
- **Pantalla "Mis partidas"** (ruta nueva `/partidas`, vía `preact-router` como los otros modos): lista `name`, fecha, `board_size`, `result`, `mode` de cada partida del usuario (`GET /api/games`); click reabre — navega a `/jugar` o `/analizar` cargando el SGF + `id` de esa fila. Solo visible/accesible con sesión activa.
- **Indicador sutil de estado de sync** en `PlayView`/`AnalyzeView` (ej. "Guardado en la nube" / "Sin conexión, reintentando…"), no bloqueante, visible solo si hay sesión activa.

## Manejo de errores

- Sin sesión: cero llamadas a `/api/games/*`, comportamiento actual sin cambios.
- D1 falla (red, rate limit, error de servidor): aviso no bloqueante + reintento; `localStorage` sigue siendo la fuente de verdad, la partida nunca se pierde.
- Drive falla: independiente de D1, no bloquea ni revierte el guardado en D1 — la fila en D1 simplemente queda sin `drive_file_id` (o con el viejo, si ya existía de un guardado anterior) hasta el próximo intento exitoso.
- Rate limit excedido en escritura: mensaje claro, no crashea la UI (mismo patrón `.play-error` ya usado en toda la app).

## Testing / verificación

- **`apps/worker`**: Vitest con `@cloudflare/vitest-pool-workers` (ya en uso hoy) — rutas de `/api/games/*` contra un D1 en memoria, mocks del cliente de Google/Drive para no depender de red real en CI.
- **`apps/web`**: lógica de trigger de guardado (cuándo se llama POST vs PUT, manejo de reintento, comportamiento sin sesión) con `fetch` mockeado — mismo patrón ya usado para testear lógica de red/async en este repo.
- **Manual (Chrome real, gate de Edgar)**: login real con Google end-to-end, verificar la fila en D1 y el archivo en la carpeta de tengen en Drive real, reabrir una partida desde "Mis partidas" en ambos modos, editar una reabierta en Analizar y confirmar que actualiza in-place (no duplica), simular offline (Network throttling) y confirmar que el juego sigue funcionando 100% local con aviso+reintento del guardado en la nube.

## Pasos operativos (fuera del código, los hace Edgar)

1. Crear un proyecto nuevo en Google Cloud Console dedicado a tengen.
2. Configurar la pantalla de consentimiento OAuth (tipo "External", ya que es una app pública).
3. Habilitar la Google Drive API en ese proyecto.
4. Crear credenciales OAuth 2.0 (Web application), con el origen/redirect URI de `tengen.kntor.io`.
5. Pasarme el Client ID + Client Secret (vía `wrangler secret put`, nunca committeados) para cablear `better-auth`.

Esto se detalla paso a paso en el plan de implementación, no acá.

## Fuera de alcance (recordatorio, no re-litigar en el plan)

Turnstile, Cloudflare Access/Zero Trust como mecanismo de login, otros proveedores de login además de Google, edición/borrado/renombrado de partidas guardadas, compartir partidas entre usuarios — todas quedan fuera; si en el futuro se necesitan, son su propio ciclo brainstorm→spec.
