# Plan: Fase 1 — Entrega de modelos (OPFS cache + descarga con progreso)

> Detalle de ejecución de la **Fase 1** del roadmap v1 (`docs/superpowers/plans/2026-07-10-tengen-v1-roadmap.md`). Se ejecuta con **subagent-driven-development** sobre `main` (Edgar lo autorizó). Este archivo es la fuente autoritativa de `task-brief`: cada `## Task N` es un brief autocontenido con los valores exactos a usar **verbatim**.

## Context

Fase 0 dejó `apps/web` corriendo el motor en un Web Worker con una factory de evaluador **trivial**: `OnnxEvaluator.create('/models/<archivo>.onnx', …)` baja el ONNX (108–115 MB fp32) por HTTP **en cada carga**, sin caché ni progreso. Primera carga = minutos y cada recarga vuelve a bajar >100 MB.

Fase 1 entrega la **capa de entrega de modelos**: descarga con **barra de progreso**, **caché en OPFS** (`navigator.storage.getDirectory()`), y en cargas siguientes lectura desde OPFS **sin red**. Es 100% net-new (hoy no existe código OPFS en el repo). En dev la fuente es el middleware `serve-models` (`/models/…`, ya sirve `Content-Length`); en prod será R2 (Fase 4) — la fuente se abstrae en un manifest para que Fase 4 solo cambie la URL base.

**Recon web-katrain (MIT, `~/dev/vendor/web-katrain`):** NO usa OPFS (usa IndexedDB + Service Worker), pero `src/utils/downloadProgress.ts` (fetch streaming + `Content-Length` + `getReader()`) es portable. Se porta la matemática de progreso (`getContentLength`, `getProgressPercent`, verbatim, con atribución MIT); se **reemplaza** su patrón de "acumular chunks en un Blob" (buffea 115 MB en RAM) por escritura incremental a OPFS **dentro del mismo loop** (RAM plana). Retry/escritura-atómica NO existen en web-katrain → net-new.

## Decisiones (ya tomadas — no re-litigar)

1. **Arquitectura A1 — el hilo principal cachea en OPFS; el worker LEE de OPFS por nombre.** OPFS es storage por-origen COMPARTIDO entre la página y sus workers, así que el worker lee lo que el hilo principal cacheó. Ventaja decisiva: **cero cambios** al contrato verificado `Engine`/worker/protocolo. El progreso vive en el hilo principal (donde está la UI). Descartadas: A2 (pasar el ArrayBuffer al worker → transferencia de 115 MB + cambio de init) y B (caché dentro del worker → extender `Engine.init` con `onProgress` + protocolo).
2. **restart-on-fail, no byte-range resume.** Un fallo de red descarta el parcial y el usuario reintenta desde 0. El resume por HTTP Range se difiere a Fase 4 (R2 lo soporta; el `serve-models` de dev no).
3. **Realidad de tamaño fp32:** se cachean 115 MB (b18 kata) + 108 MB (humanv0). OPFS aguanta ese tamaño en Chrome de sobra.

## Requisito de primera clase: COMPLETITUD de caché (anti-corrupción silenciosa)

Un ONNX truncado leído como "cacheado" es basura silenciosa — la misma clase de falla que el fp16 NaN, y el smoke happy-path (descargar→recargar) NO la detecta (el parcial solo ocurre en una descarga interrumpida). Por eso la integridad es requisito explícito:

- **Marcador de completado, no existencia de archivo.** El marcador (`localStorage`, key `tengen:model:<opfsName>` = bytes esperados) se setea **solo tras** que el commit del archivo (`close()`) Y la validación de bytes hayan pasado. `isComplete()` significa "marcador presente Y tamaño coincide", nunca "el archivo existe". No se depende de `FileSystemFileHandle.move()`.
- **Validación de byte-size** contra el manifest (kata `115800125`, humanv0 `108040143`) tras escribir Y al leer de caché; mismatch → rechazar y re-descargar. El worker también size-checkea al leer (guarda barata → error claro si no cuadra).
- **Test de la ruta de FALLO** (Node, no browser): mock store + mock fetch cuyo stream revienta a mitad → aseverar que `ensureModel` NO deja entrada aceptada (no llama `markComplete`, aborta el sink) y que la siguiente llamada re-descarga. Esa es la cobertura que el smoke de browser estructuralmente no puede dar.

## Contratos e interfaces AUTORITATIVAS (esta sección gobierna Task 2 y Task 3)

> **Riesgo #1 del feature: drift de interfaz entre Task 2 (define la interfaz + mock) y Task 3 (OPFS real).** Estas firmas son la spec exacta contra la que se mide Task 3. Copiar **verbatim**.

**Descomposición sink-based (resuelta):** el loop `getReader()` + progreso + validación de bytes + orquestación del marcador viven en `ensureModel` (`modelCache.ts`, Node-testeable). `modelStore.ts` es un **sink delgado** sobre OPFS. Esto es lo que hace que el test de ruta de fallo (Node) sea **significativo** (ejercita la lógica real, no un mock). El marcador se setea con `markComplete`, **separado de `close()`**, llamado por `ensureModel` **solo tras** validar bytes — así "marcador solo tras éxito + validación" vive en la unidad testeada, no en el store OPFS sin test.

```ts
// netManifest.ts
export interface ModelManifestEntry {
  /** Nombre en OPFS, plano y VERSIONADO (bump = nueva entrada de caché). */
  opfsName: string
  /** Fuente de descarga. Dev: '/models/<archivo real>'. Prod (Fase 4): URL de R2. */
  sourceUrl: string
  /** Tamaño total en bytes, para validación de completitud. */
  bytes: number
}
// b10 aún no convertida → ausente (Partial). requireManifestEntry() lanza para redes no disponibles
// (preserva el comportamiento actual de appFactory: throw para b10).
export const netManifest: Partial<Record<NetworkId, ModelManifestEntry>>
export function requireManifestEntry(net: NetworkId): ModelManifestEntry

// progress.ts (portado de web-katrain downloadProgress.ts, MIT — verbatim la matemática)
export type DownloadProgress = { receivedBytes: number; totalBytes: number | null; percent: number | null }
export function getContentLength(headers: Headers): number | null
export function getProgressPercent(receivedBytes: number, totalBytes: number | null): number | null

// modelStore.ts — interfaz + impl OPFS (browser-only)
export interface WritableSink {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>   // commit
  abort(): Promise<void>   // descarta el parcial sin commitear
}
export interface ModelStore {
  /** marcador presente Y tamaño del archivo === bytes. */
  isComplete(name: string, bytes: number): Promise<boolean>
  readArrayBuffer(name: string): Promise<ArrayBuffer>
  openWritable(name: string): Promise<WritableSink>
  /** setea el marcador de completado. Lo llama SOLO ensureModel, tras validar bytes. */
  markComplete(name: string, bytes: number): Promise<void>
}
export function createOpfsModelStore(): ModelStore   // impl real

// modelCache.ts — núcleo testeable (store y fetchFn inyectados)
export async function ensureModel(
  net: NetworkId,
  store: ModelStore,
  fetchFn: (url: string) => Promise<Response>,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void>
```

**Algoritmo de `ensureModel` (autoritativo):**
1. `entry = requireManifestEntry(net)`.
2. `if (await store.isComplete(entry.opfsName, entry.bytes)) return` (ruta caché: 0 red).
3. `res = await fetchFn(entry.sourceUrl)`; si `!res.ok` → throw con status.
4. `total = getContentLength(res.headers)` (puede ser `null`; la validación usa `entry.bytes`, no `total`).
5. `sink = await store.openWritable(entry.opfsName)`.
6. Loop `res.body.getReader()`: por cada chunk → `received += chunk.byteLength`, `await sink.write(chunk)`, `onProgress?.({ receivedBytes: received, totalBytes: total, percent: getProgressPercent(received, total) })`.
   - Si el loop lanza (stream roto): `await sink.abort()`, re-throw. **No** `markComplete`.
7. Tras el loop (stream done, antes de commitear): si `received !== entry.bytes` → `await sink.abort()`, throw byte-mismatch. **No** `markComplete`.
8. `await sink.close()` (commit) → `await store.markComplete(entry.opfsName, entry.bytes)`.

**Ruta del worker (`appFactory.ts`):** `entry = requireManifestEntry(net)` → `buf = await store.readArrayBuffer(entry.opfsName)` (OPFS puro) → `if (buf.byteLength !== entry.bytes) throw` → `OnnxEvaluator.create(buf, { boardSize, ep: 'webgpu' })`. **NUNCA** `isComplete` ni `localStorage` en el worker (localStorage no existe en Worker scope). Si el archivo no está en OPFS, `readArrayBuffer` lanza → error claro ("modelo <net> no está en OPFS; el hilo principal debe cachearlo con ensureModel antes de init").

## Global Constraints (para los reviewers — copiar verbatim al despachar la review)

- **Valores exactos del manifest:** b18 → `{ opfsName: 'b18c384nbt-kata1.fp32.v1.onnx', sourceUrl: '/models/b18c384nbt-kata1.fp32.onnx', bytes: 115800125 }`; humanv0 → `{ opfsName: 'b18c384nbt-humanv0.fp32.v1.onnx', sourceUrl: '/models/b18c384nbt-humanv0.fp32.onnx', bytes: 108040143 }`. `b10` NO tiene entrada.
- **Marcador de completitud:** key `localStorage` = `tengen:model:<opfsName>`, valor = bytes esperados. Se setea SOLO tras `close()` + validación de bytes. `isComplete` = marcador presente **Y** tamaño del archivo coincide.
- **Separación de responsabilidades:** el loop de streaming + progreso + validación + orquestación del marcador viven en `ensureModel` (modelCache.ts). `modelStore.ts` es sink delgado. `markComplete` es **separado** de `close()`.
- **Ruta de fallo:** stream roto o byte-mismatch → `sink.abort()`, sin `markComplete`, re-throw. La siguiente llamada re-descarga.
- **Worker:** solo lee OPFS + size-check contra `bytes`. Prohibido `localStorage`/`isComplete` en el worker.
- **Atribución (constraint global de CLAUDE.md):** `progress.ts` es adaptación MIT de web-katrain → cabecera de atribución por-archivo + entrada en `apps/web/THIRD-PARTY-LICENSES` + registro en `docs/research/fase-engine/adaptaciones-upstream.md`. (La copia verbatim de `getContentLength`/`getProgressPercent` es **la estrategia de adaptación documentada**, no duplicación intra-repo.)
- **Contrato intacto:** cero cambios a `Engine`/worker/protocolo del motor (Arquitectura A1). `OnnxEvaluator.create` ya acepta `ArrayBuffer` (`nn/evaluator.ts:94`).
- **tsconfig:** strict + `noUncheckedIndexedAccess` (heredado de `tsconfig.base.json`).

---

## Task 1 — `netManifest.ts` + `progress.ts` (puros, Node-testeables) + infra de test de apps/web

**Archivos nuevos:**
- `apps/web/src/models/netManifest.ts` — según la interfaz autoritativa. `netManifest: Partial<Record<NetworkId, ModelManifestEntry>>` con las 2 entradas exactas (b18, humanv0; valores en Global Constraints). `requireManifestEntry(net)` devuelve la entrada o lanza `Error(`red ${net} aún no disponible en apps/web`)` para redes sin entrada (b10). Importa `NetworkId` de `@tengen/engine` (type import).
- `apps/web/src/models/progress.ts` — **adaptado de `~/dev/vendor/web-katrain/src/utils/downloadProgress.ts` (MIT)**. Exporta `DownloadProgress` (tipo), `getContentLength(headers: Headers): number | null`, `getProgressPercent(receivedBytes, totalBytes): number | null`. La matemática de ambas funciones es **verbatim** del original:
  - `getContentLength`: lee `headers.get('content-length')`; si falta → `null`; parsea base 10; devuelve el número si es finito y `> 0`, si no `null`.
  - `getProgressPercent`: si `!totalBytes` → `null`; si no `Math.min(100, Math.max(0, Math.round((receivedBytes / totalBytes) * 100)))`.
  - **Cabecera de atribución** por-archivo (mira el formato de las cabeceras de `packages/engine/src/vendor/web-katrain/*.ts` y el `THIRD-PARTY-LICENSES` existente de `packages/engine`): origen `Sir-Teo/web-katrain@7a0a487`, archivo `src/utils/downloadProgress.ts`, licencia MIT, nota de qué se portó (solo la matemática de progreso; el loop de streaming se reimplementa en `modelCache.ts` con escritura incremental a OPFS).

**Atribución (obligatoria, constraint de CLAUDE.md):**
- Crear `apps/web/THIRD-PARTY-LICENSES` (nuevo; mira `packages/engine/THIRD-PARTY-LICENSES` como plantilla — mismo formato, con el texto de la licencia MIT de web-katrain) listando `src/models/progress.ts`.
- Añadir una fila a la tabla "Log de adaptaciones por archivo" de `docs/research/fase-engine/adaptaciones-upstream.md` para `apps/web/src/models/progress.ts` (origen `src/utils/downloadProgress.ts`; cambio de tengen: solo se porta `getContentLength`/`getProgressPercent`; el loop de acumulación-en-Blob NO se porta → reimplementado en `modelCache.ts` con escritura incremental a OPFS; gate: tests Node de `progress.test.ts`).

**Infra de test de apps/web (nueva — hoy no existe):**
- Añadir `vitest` a `devDependencies` de `apps/web/package.json` (misma major que `packages/engine`; hoy vitest 3) y script `"test": "vitest run"`. Verifica que `npm test -w @tengen/web` corre. (El root `npm test` ya hace `--workspaces --if-present`.)
- Config de vitest para apps/web: entorno **node** (estas pruebas son puras). Si hace falta un `vitest.config.ts`, mantenerlo mínimo; no romper el build de Vite existente.

**Tests (Node, `apps/web/tests/` o junto al fuente — sigue el patrón de `packages/engine/tests/`):**
- `progress.test.ts`:
  - `getContentLength`: header presente con número válido → ese número; header ausente → `null`; `'0'` o negativo → `null`; no-numérico → `null`. Construir `new Headers({...})` (global en Node 18+).
  - `getProgressPercent`: `(0, 1000)→0`; `(500, 1000)→50`; `(1000, 1000)→100`; clamp por encima `(1500, 1000)→100`; `total=null → null`; `total=0 → null`.
- `netManifest.test.ts`: `requireManifestEntry('b18')` y `('humanv0')` devuelven las entradas con los `bytes`/`opfsName`/`sourceUrl` exactos; `requireManifestEntry('b10')` lanza.

**Verificación:** `npm test -w @tengen/web` verde; `npx tsc --noEmit` en apps/web 0 errores (script `typecheck` ya existe). Commit.

**Modelo sugerido:** cheap (transcripción/port puro con valores dados).

---

## Task 2 — `modelCache.ts` + interfaz `ModelStore`/`WritableSink` + mock store + tests Node

**Depende de Task 1** (usa `netManifest`/`requireManifestEntry`/`progress`).

**Archivos:**
- `apps/web/src/models/modelStore.ts` — **solo la interfaz** en esta task: `ModelStore`, `WritableSink` (según la interfaz autoritativa). La impl OPFS real (`createOpfsModelStore`) es Task 3; en esta task **no** se implementa OPFS. (Se puede declarar el tipo aquí; Task 3 añade la impl al mismo archivo.)
- `apps/web/src/models/modelCache.ts` — `ensureModel(net, store, fetchFn, onProgress)` implementando **exactamente** el algoritmo autoritativo (pasos 1–8). Usa `requireManifestEntry` (Task 1), `getContentLength`/`getProgressPercent` (Task 1). Lee el stream con `res.body.getReader()` (mismo API que el browser). Maneja `res.body === null` (fetch sin body) como error claro. **No** importa nada de OPFS ni del DOM (debe compilar y correr en Node).

**Tests Node (`modelCache.test.ts`) — el corazón de la task.** Construir:
- **Mock `ModelStore`** en memoria: un `Map<string, Uint8Array>` para archivos commiteados + un `Map<string, number>` para marcadores. `openWritable` devuelve un sink que acumula en un buffer temporal; `close()` commitea al Map; `abort()` descarta el buffer temporal (NO commitea); `markComplete(name,bytes)` setea el marcador; `isComplete(name,bytes)` = marcador presente Y `commited.get(name)?.byteLength === bytes`; `readArrayBuffer` del Map. El mock debe exponer contadores/espías (p.ej. `markCompleteCalls`, `abortCalls`) para las aserciones.
- **Mock `fetchFn`**: devuelve un `Response` real (global en Node 18+) construido con un `ReadableStream` que emite chunks. Casos:
  1. **Happy path:** fetch entrega exactamente `bytes` en varios chunks (usar `bytes` pequeños en el test — el manifest real es de 115 MB, así que el test debe **inyectar** un store/fetch con un tamaño de prueba: para eso, testear `ensureModel` con una red del manifest real chocaría con 115 MB. **Solución:** el mock store/fetch controlan el tamaño, pero `ensureModel` valida contra `requireManifestEntry(net).bytes`. Por tanto el test debe usar un `net` cuyo `bytes` sea manejable. Opciones: (a) permitir inyectar el manifest/entry — pero la firma no lo tiene; (b) hacer que el mock fetch entregue exactamente `requireManifestEntry(net).bytes` bytes de relleno en streaming SIN materializar 115 MB de una vez (emitir chunks de ceros hasta llegar al total). (b) es viable y fiel: un `ReadableStream` que emite N chunks de `Uint8Array(chunkSize)` sumando `bytes`, sin guardar todo. Pero el mock store acumularía 115 MB en RAM. **Mejor:** el test usa `net='b18'` pero con un mock store que NO retiene bytes (cuenta longitudes) y un fetch que streamea el total en chunks; el happy path asevera que `markComplete` se llamó con `(opfsName, 115800125)` y `received === bytes`. Para evitar 115 MB en RAM, el mock sink puede solo **contar** bytes en vez de retenerlos, y `readArrayBuffer`/commit guardar solo la longitud. Documenta esta decisión en el test. **Alternativamente y más limpio:** exponer el corazón de `ensureModel` de forma que el `bytes` esperado venga del `entry` (ya viene) y testear con chunks que sumen ese total pero con un `chunkSize` grande y pocos chunks (p.ej. 8 chunks). El punto es no materializar 115 MB — cuenta longitudes.)
     - Asevera: `fetchFn` llamado 1 vez con `sourceUrl` exacto; `markComplete(opfsName, bytes)` llamado 1 vez; segunda llamada a `ensureModel` (con `isComplete` ahora true) → `fetchFn` NO se vuelve a llamar (contador sigue en 1).
  2. **Fallo a mitad:** el `ReadableStream` del fetch hace `controller.error(new Error('boom'))` tras algunos chunks → `ensureModel` **rechaza**; `sink.abort()` fue llamado; `markComplete` **no** se llamó; `isComplete` sigue false; una segunda llamada re-invoca `fetchFn` (re-descarga).
  3. **Byte mismatch:** el fetch entrega `bytes - K` (menos de lo esperado) y luego cierra el stream limpio → `ensureModel` rechaza con error de mismatch; `abort` llamado; `markComplete` no; segunda llamada re-descarga. (Igual con `bytes + K`, de más.)
  4. **Progreso monotónico:** capturar todos los `onProgress`; aseverar `receivedBytes` no-decreciente y estrictamente creciente entre chunks; último `receivedBytes === bytes` en el happy path; `percent` (cuando `totalBytes` no es null) no-decreciente y `≤ 100`.
  5. **`isComplete` true de entrada:** si el store ya reporta `isComplete` → `ensureModel` retorna sin llamar `fetchFn`.

> Nota de tamaño para el implementador: NO materialices el modelo real de 115 MB en el test. El mock sink debe **contar** longitudes (no retener bytes) o usar tamaños de chunk grandes con conteo. Lo que se valida es la **lógica** (orquestación, ruta de fallo, marcador), no bytes reales. Si te resulta más limpio, un helper de test que fabrique un `ReadableStream` de N chunks sumando un `total` dado.

**Verificación:** `npm test -w @tengen/web` verde (incluye Task 1); `npx tsc --noEmit` 0. Commit.

**Modelo sugerido:** standard (es la lógica real del feature + diseño de mocks fieles).

---

## Task 3 — `modelStore.ts` impl OPFS real

**Depende de Task 2** (implementa la interfaz `ModelStore`/`WritableSink` ya definida).

**Archivo:** añadir `createOpfsModelStore(): ModelStore` a `apps/web/src/models/modelStore.ts` (junto a la interfaz de Task 2). Browser-only (OPFS + `localStorage`).

**Implementación:**
- `openWritable(name)`: `dir = await navigator.storage.getDirectory()`; `handle = await dir.getFileHandle(name, { create: true })`; `writable = await handle.createWritable()` (trunca por defecto). Devolver un `WritableSink` que envuelve el `FileSystemWritableFileStream`: `write(chunk) → writable.write(chunk)`, `close() → writable.close()` (commit), `abort() → writable.abort()` (descarta el swap, no commitea). Los cambios de un `FileSystemWritableFileStream` no se reflejan hasta `close()` → `abort()` deja el archivo sin el parcial.
- `close()` / `abort()`: robustos (idempotentes; si ya cerrado, no romper).
- `markComplete(name, bytes)`: `localStorage.setItem('tengen:model:' + name, String(bytes))`.
- `isComplete(name, bytes)`: marcador presente (`localStorage.getItem` === `String(bytes)`) **Y** el archivo existe con `file.size === bytes` (`getFileHandle(name)` → `getFile()` → `.size`; si `getFileHandle` lanza `NotFoundError` → `false`). Si el marcador dice un tamaño distinto al del archivo → `false` (fuerza re-descarga).
- `readArrayBuffer(name)`: `getFileHandle(name)` → `getFile()` → `await file.arrayBuffer()`. Si no existe → deja propagar un error claro (el caller/worker lo maneja).

**Sin unit test Node** (OPFS no existe en Node). Verificación por typecheck (`npx tsc --noEmit` 0) y en browser (Task 4). Añade la entrada `apps/web/src/models/modelStore.ts` como **100% de tengen** (no upstream) — no requiere fila en adaptaciones-upstream (solo lo net-new que adapta terceros lo requiere; OPFS es nuestro).

**Verificación:** `npx tsc --noEmit` 0; `npm test -w @tengen/web` sigue verde (Task 3 no añade tests Node pero no debe romper los existentes ni el build). Commit.

**Modelo sugerido:** standard (API de OPFS con matices de commit/abort).

---

## Task 4 — `ModelGate.tsx` + wiring (`appFactory` lee OPFS; `main.tsx` gate + selector de red)

**Depende de Tasks 1–3.**

**Archivo nuevo `apps/web/src/models/ModelGate.tsx`** — componente Preact reutilizable (Fase 2 lo usará antes del tablero). Props: `{ net: NetworkId; children: ... }`. Comportamiento:
- Al montar y al cambiar `net`: `ensureModel(net, createOpfsModelStore(), (url) => fetch(url), onProgress)`. Estados: `idle` → `downloading` (con `percent`/`receivedBytes`/`totalBytes`) → `ready` (renderiza `children`) | `error` (mensaje + botón "Reintentar" que re-dispara `ensureModel`).
- **Barra de progreso con ARIA** (patrón de referencia `~/dev/vendor/web-katrain/src/components/SettingsModal.tsx` ~1899-1925): `role="progressbar"`, `aria-label`, `aria-valuemin={0}` / `aria-valuemax={100}` / `aria-valuenow={percent}` cuando `percent` no es null; cuando `percent` es null (sin `Content-Length`) mostrar estado indeterminado ("descargando…") sin `aria-valuenow`. Estilo mínimo inline (coherente con el `main.tsx` actual, que usa estilos inline; sin Tailwind — apps/web no lo tiene). Mostrar MB descargados/total si hay total.
- Manejar la carrera de `net` cambiando durante una descarga (p.ej. flag de cancelación/última-solicitud-gana) para no renderizar `children` de una red obsoleta. Mantenerlo simple.

**Modificar `apps/web/src/appFactory.ts`** (contexto worker): reemplazar el `MODEL_FILES` + `OnnxEvaluator.create('/models/…')` por la **ruta del worker** de la interfaz autoritativa: `entry = requireManifestEntry(net)` → `buf = await createOpfsModelStore().readArrayBuffer(entry.opfsName)` → `if (buf.byteLength !== entry.bytes) throw Error(...)` → `OnnxEvaluator.create(buf, { boardSize, ep: 'webgpu' })`. **Prohibido** `localStorage`/`isComplete` aquí (worker scope). Error claro si el archivo no está en OPFS.

**Modificar `apps/web/src/main.tsx`**: envolver el smoke en `<ModelGate net={selectedNet}>`; añadir un **selector mínimo de red** (`b18` kata / `humanv0` human) para ejercitar el caché de AMBAS. El smoke, dentro del gate, hace `engine.init({ network: selectedNet, boardSize: 9 })` y luego `genMove`:
  - `b18` → `genMove(empty, { level: { kind: 'kata', visits: 100 } })` → sanity esperado `{x:3,y:5}` (jugada central; ver CLAUDE.md).
  - `humanv0` → `genMove(empty, { level: { kind: 'human', rank: '5k' } })` → sanity esperado central/tengen (p.ej. `{x:4,y:4}`; el move exacto depende del rank y es sanity **manual** de browser, no un assert automático).
  Mantener el `worker.terminate()` en `finally` (no construir disposal elaborado — YAGNI, se difiere a Fase 2).

**Sin unit test Node** para `ModelGate`/wiring (son browser/DOM). Verificación por typecheck + browser (Chrome/WebGPU real).

**Verificación (browser, la corre Claude vía chrome-devtools-mcp o Edgar):**
1. **Primera carga:** seleccionar b18 → barra de progreso avanza y **llega a 100%** → smoke juega (`{3,5}`). Repetir con humanv0 → central.
2. **Segunda carga (recarga):** con DevTools Network en "offline" (o verificando que no hay request del `.onnx`), el modelo carga **desde OPFS sin red** → smoke juega igual.
3. **Integridad:** confirmar (DevTools → Application → OPFS) que el archivo pesa exactamente los bytes del manifest; el marcador (`localStorage` `tengen:model:<opfsName>`) existe.

**Verificación automática:** `npm test -w @tengen/web` verde; `npx tsc --noEmit` 0; `vite build` 0 (apps/web). Commit.

**Modelo sugerido:** standard (Preact + wiring de worker + ARIA).

---

## Verificación global (fin de fase)

- **Node (auto):** `npm test -w @tengen/web` (nuevo) — lógica de caché incl. ruta de fallo + byte-mismatch + progreso; `npx tsc --noEmit` 0 en apps/web; `vite build` 0. Motor `npm test -w @tengen/engine` (88/88) + `test:nn` (10/10) intactos (Fase 1 no toca el motor).
- **Browser (Chrome/WebGPU real):** los 3 checks de Task 4.

## Notas

- **dispose() al cambiar de red:** se difiere a Fase 2 (ciclo de vida del engine persistente). El smoke de Fase 1 ya hace `worker.terminate()` en `finally` — no construir disposal elaborado (YAGNI).
- **Entradas OPFS viejas al bumpear versión:** leak acotado; se anota, no se construye limpieza ahora.
- **Rama:** se trabaja en `main` (Edgar lo autorizó). SDD: implementer → review por-tarea → review final (whole-branch).
