# Fase 4 — apps/worker base: deploy sin cuentas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desplegar tengen (Modo Jugar + Modo Analizar, tal como existen hoy) públicamente en `tengen.kntor.io`, gratis, sin cuentas — un Cloudflare Worker que sirve la SPA (`apps/web`) como static assets y las redes ONNX desde R2.

**Architecture:** `apps/worker/` nuevo (Hono) con dos responsabilidades: (1) servir `apps/web/dist/` vía el binding nativo de Workers Static Assets, (2) proxyar `GET /models/:filename` a un bucket R2 con headers de caché inmutable. `apps/web` gana un fix crítico (Task 3) para que onnxruntime-web cargue correctamente fuera del dev server de Vite.

**Tech Stack:** Cloudflare Workers (Hono 4), Wrangler, `@cloudflare/vitest-pool-workers` (tests con bindings reales vía Miniflare), Vite (build de `apps/web`, sin cambios de librería).

## Global Constraints

- `winrate`/`scoreLead` del motor SIEMPRE en perspectiva de Negro — no aplica a esta fase (no se toca lógica de motor/análisis).
- `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true` — todo código nuevo debe tipar contra esto.
- Modelos ONNX NUNCA en git (`*.onnx` ya gitignored) — el bucket R2 y la copia local en `packages/engine/models/` son las únicas fuentes.
- `dist/` y `.wrangler/` ya gitignored globalmente (`.gitignore` raíz) — nada de esta fase necesita tocar `.gitignore`.
- Chrome-first: WebGPU es el único execution provider que usa la app (`apps/web/src/appFactory.ts`, `ep: 'webgpu'` hardcodeado) — el fix de Task 3 se acota a esa vía, no a todos los EPs de onnxruntime-web.
- Dominio: `tengen.kntor.io` (Edgar ya tiene `kntor.io` en Cloudflare, nameservers confirmados con `dig`).
- Bucket R2: `tengen-models`. Binding R2 en el Worker: `MODELS`. Binding de assets: `ASSETS`.

---

## Hallazgo crítico de esta sesión (gobierna la Task 3 — no re-derivar)

**Verificado empíricamente en un navegador real** (Chrome vía CDP, `vite build` + `vite preview`, NO el dev server): sin fix, el motor NO carga fuera de `vite dev`. Reproducido y confirmado:

1. `vite build` genera `apps/web/dist/` sin ningún archivo `ort-dist/` — el middleware `serve-ort-dist` de `vite.config.ts` es un hook `configureServer` que **solo corre en `vite dev`**, nunca en `vite build`/`vite preview`/producción real.
2. `packages/engine/src/nn/session.ts` (`configureOrt`) fija `ort.env.wasm.wasmPaths = opts?.wasmPaths ?? '/ort-dist/'`; `apps/web/src/appFactory.ts` llama `OnnxEvaluator.create(buf, { boardSize, ep: 'webgpu' })` **sin pasar `wasmPaths`** — así que en cualquier build de producción, `wasmPaths` queda en el default `/ort-dist/`, una ruta que no existe fuera del dev server.
3. **Confirmado en el navegador** (jugando una partida real contra `vite preview`, con el `.onnx` real servido desde una carpeta local): la app llega hasta iniciar la partida y falla con exactamente este error, visible en el panel de la UI: `No se pudo inicializar el motor (no available backend found. ERR: [webgpu] TypeError: Failed to fetch dynamically imported module: http://localhost:4173/ort-dist/ort-wasm-simd-threaded.jsep.mjs)`.
4. El archivo que pide en runtime es específicamente el par `ort-wasm-simd-threaded.jsep.{mjs,wasm}` (variante JSEP — la que usa la vía WebGPU) de `onnxruntime-web` — confirmado por el mensaje de error exacto, con `ep:'webgpu'` como único EP configurado en toda la app.

**Sin este fix, el deploy de esta fase estaría roto de punta a punta** (ni Modo Jugar ni Modo Analizar podrían inicializar el motor) — es la pieza de mayor riesgo del plan, y por eso Task 3 exige verificación en navegador real, no solo `tsc`/build limpio.

---

## Hallazgo crítico #2 (descubierto EN EJECUCIÓN, durante Task 1 — ya resuelto, aplicado antes de Task 1)

**Verificado empíricamente, dos veces por separado** (un workflow de diagnóstico de 3 agentes + reproducción directa del controlador, ambos con reversión limpia — `git status` sin diff): un build limpio de `apps/web` (`npm run build -w @tengen/web`, ANTES de cualquier cambio de esta fase) produce `apps/web/dist/assets/ort-wasm-simd-threaded.jsep-<hash>.wasm` de **26.8 MB**, que excede el límite duro de **25 MiB por archivo** de Cloudflare Workers Static Assets — bloquea `wrangler dev`/`wrangler deploy` con `Asset too large`. Este bug NO estaba contemplado en el plan original (surgió al ejecutar el Step 9 de Task 1, primera vez que algo en el flujo ejerce el binding de assets real de Cloudflare — la verificación en navegador de la sesión de brainstorm usó `vite preview`, que nunca valida tamaños de archivo).

**Causa raíz:** `import * as ort from 'onnxruntime-web'` (en `packages/engine/src/nn/session.ts`/`evaluator.ts`) resuelve por defecto a la variante `ort.bundle.min.mjs`, que trae un `new URL("ort-wasm-simd-threaded.jsep.wasm", import.meta.url)` interno usado solo como fallback si nadie fijó `locateFile`. Vite/Rollup bundlea ese patrón como asset con hash **siempre que aparece sintácticamente en el grafo de módulos, sin análisis de alcanzabilidad de rama** (confirmado contra la documentación de Vite). En tengen esa rama nunca corre — `configureOrt()` fija `wasmPaths='/ort-dist/'` (string) antes de crear cualquier sesión, lo que arma un `locateFile` que cubre la carga real — así que el archivo de 26.8 MB en `dist/assets/` es una **copia muerta, nunca fetcheada**, y es un artefacto DISTINTO de los archivos reales que el motor pide en runtime (`/ort-dist/ort-wasm-simd-threaded.jsep.{mjs,wasm}`, servidos en dev por el middleware existente y en prod por el plugin `copy-ort-dist-prod` de la Task 3 de abajo).

**Fix aplicado (commit previo a Task 1, ver ledger):** una línea en `apps/web/vite.config.ts`, dentro de `defineConfig({...})`:
```ts
resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
```
Export condition **oficial del propio paquete** onnxruntime-web (confirmada en su `package.json`, no es un hack de terceros) — resuelve `onnxruntime-web` a `ort.min.mjs` en vez de `ort.bundle.min.mjs`; esa variante no trae el `new URL()` problemático pero respeta `ort.env.wasm.*`/`wasmPaths` de forma idéntica. **No requiere ningún cambio en `packages/engine`.**

**Verificado (controlador, antes de retomar Task 1):** build limpio → el `.wasm` de 26.8 MB desaparece por completo de `dist/assets/` (los chunks JS además bajan de tamaño); `find apps/web/dist/assets -name '*.wasm' -size +1M` → vacío; `npx -w @tengen/web tsc --noEmit` → 0 errores; smoke de `vite dev` (el cambio afecta dev además de build) → `index.html` 200, `/ort-dist/ort-wasm-simd-threaded.jsep.mjs` vía el middleware existente → 200.

**Relación con Task 3 (abajo):** son fixes ORTOGONALES sobre el mismo archivo, ninguno reemplaza al otro — `resolve.conditions` evita que Vite genere la copia muerta con hash que rompía el límite de tamaño; el plugin `copy-ort-dist-prod` de Task 3 sigue siendo necesario para que los archivos REALES que pide `/ort-dist/` en runtime existan en `dist/` en producción (`vite build` no corre el middleware de dev). El Step 1 de Task 3 ya incluye esta línea en su bloque de código (ambos fixes conviven en el mismo `defineConfig`) — si al ejecutar Task 3 el implementador encuentra `resolve.conditions` ya presente en el archivo, es esperado, no una desviación suya.

**Nota de proceso:** no pasó por el ciclo completo de implementer+task-reviewer (una línea, dos verificaciones independientes con evidencia — workflow de 3 agentes + reproducción directa del controlador con reversión limpia — ya superan el nivel de escrutinio de una review por-task normal); Edgar confirmó explícitamente antes de aplicarlo. Un subagente del workflow de diagnóstico reportó un intento de prompt injection durante su investigación (un resultado de herramienta con contenido fabricado + una instrucción falsa de no mencionarlo); lo verificó contra `git diff`/`git show` (árbol limpio) y lo reportó igual — no afectó la conclusión, que descansa en la reproducción empírica directa, no en ningún texto sugerido.

---

## Hallazgo crítico #3 (descubierto EN EJECUCIÓN, durante Task 3 — ya resuelto)

**Verificado empíricamente por el implementador de Task 3 y reproducido de forma independiente por el controlador** (`wrangler deploy --dry-run` real, dos veces): el archivo REAL que Task 3 copia a `dist/ort-dist/` (`ort-wasm-simd-threaded.jsep.wasm`, el binario del runtime WASM de onnxruntime-web — no la copia muerta del Hallazgo #2, sino el archivo que el motor efectivamente necesita) pesa **25.6 MiB**, por encima del límite de **25 MiB por archivo** de Cloudflare Workers Static Assets. A diferencia del Hallazgo #2 (una copia duplicada e inerte que se podía eliminar), este archivo es indispensable — no hay forma de "arreglarlo" con una export condition o un truco de bundling: el binario del runtime de ONNX Runtime pesa lo que pesa.

**Fix aplicado (dentro del alcance de Task 3, mismo commit que el resto de la task):** reusar el patrón que Task 2 ya estableció para los `.onnx` (que pesan 100+ MB) — servir el archivo desde R2 vía una ruta propia del Worker, no vía el binding de static assets (que SÍ tiene el límite de 25 MiB; R2 no):

1. `apps/web/public/.assetsignore` (nuevo, formato gitignore, mecanismo sancionado por Cloudflare — confirmado contra su documentación oficial): `ort-dist/*`. Excluye el directorio del escaneo de static assets de Wrangler/Miniflare SIN dejar de generarlo físicamente en `dist/ort-dist/` (necesario para que la verificación local con `vite preview` de Task 3 Step 3 siga funcionando tal cual está escrita — `vite preview` no sabe nada de Workers ni de `.assetsignore`, sirve `dist/` tal cual).
2. `apps/worker/src/index.ts`: nueva ruta `GET /ort-dist/:filename`, calcada de `GET /models/:filename` (Task 2) pero contra el prefijo de key `ort-dist/` en el mismo bucket `MODELS` — sin bucket nuevo, sin binding nuevo. Fija `Content-Type` por extensión (`.mjs`→`text/javascript`, `.wasm`→`application/wasm`, igual que el middleware de dev) y **`Cross-Origin-Embedder-Policy: require-corp`** explícito (el mismo motivo que ya documenta `vite.config.ts`: el `.mjs` se carga como script de un dedicated worker bajo `crossOriginIsolated` y Chrome lo bloquea sin ese header por-archivo).
3. 4 tests nuevos en `apps/worker/tests/index.test.ts` (mismo archivo que Task 2), mismo patrón — bindings reales de Miniflare, no mocks.

**Verificado:** `npm test -w @tengen/worker` 9/9 (5 de Task 1+2 + 4 nuevos); `tsc --noEmit` de `apps/worker` y `apps/web` limpios; **`wrangler deploy --dry-run` (que antes fallaba con "Asset too large") ahora pasa** — 10 archivos, 64.47 KiB de upload total (el `.wasm` de 25.6 MiB ya no se escanea como static asset); suite completa del monorepo 352/352 sin regresión.

**Impacto en Task 4 (`_headers`):** la regla `/ort-dist/* → Cross-Origin-Embedder-Policy: require-corp` que Task 4 iba a agregar a `apps/web/public/_headers` queda **inerte/redundante** para ese path específico — como `/ort-dist/*` ahora lo sirve el Worker directamente (no el binding de static assets), `_headers` nunca se evalúa para esas requests; el header ya lo pone la ruta del Worker (punto 2 arriba). No hace falta borrar la regla de `_headers` (es inocua, y cubre el caso hipotético de que algún día ese path vuelva a servirse como static asset) — Task 4 debe simplemente saber que no es la pieza que hace el trabajo real.

**Nota de proceso:** implementado directamente por el controlador (no por un subagente implementer) a pedido explícito de Edgar, después de que el diagnóstico (verificado independientemente por el controlador, no solo tomado del reporte del implementador de Task 3) dejara claro que el fix era mecánico y de bajo riesgo — mismo patrón ya probado en Task 2, sin necesidad de otro ciclo completo de implementer+reviewer.

---

### Task 1: Scaffold `apps/worker` — Hono + static assets, verificado con `wrangler dev`

**Files:**
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/wrangler.jsonc`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/worker/tests/index.test.ts`

**Interfaces:**
- Produces: `Env` interface (`{ MODELS: R2Bucket; ASSETS: Fetcher }`) y la exportación default de la app Hono en `src/index.ts` — Task 2 la extiende en el mismo archivo.

- [ ] **Step 1: `apps/worker/package.json`**

```json
{
  "name": "@tengen/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "hono": "^4.6.14"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.6.4",
    "@cloudflare/workers-types": "^4.20250109.0",
    "typescript": "^5.9.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: `apps/worker/wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "tengen-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS"
  },
  "r2_buckets": [
    { "binding": "MODELS", "bucket_name": "tengen-models" }
  ]
}
```

- [ ] **Step 4: `apps/worker/src/index.ts`**

```ts
import { Hono } from 'hono'

export interface Env {
  MODELS: R2Bucket
  ASSETS: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

// Task 2 añade GET /models/:filename aquí, ANTES de este catch-all.

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
```

- [ ] **Step 5: `apps/worker/vitest.config.ts`**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
})
```

- [ ] **Step 6: `apps/worker/tests/index.test.ts` — test trivial de que la app responde**

```ts
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import app from '../src/index'

describe('apps/worker — scaffold', () => {
  it('el binding MODELS existe en el entorno de test', () => {
    expect(env.MODELS).toBeDefined()
  })
  it('el binding ASSETS existe en el entorno de test', () => {
    expect(env.ASSETS).toBeDefined()
  })
})

// referencia a `app` para que tsc no marque el import como no usado hasta Task 2
void app
```

- [ ] **Step 7: Instalar dependencias y correr**

```bash
npm install
npm test -w @tengen/worker
```

Expected: 2/2 tests PASS (Miniflare provee bindings reales simulados para `MODELS`/`ASSETS` a partir de `wrangler.jsonc`, sin necesitar el bucket R2 real todavía).

- [ ] **Step 8: Typecheck**

```bash
npx -w @tengen/worker tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 9: Verificar el ruteo real con `wrangler dev` (paso manual, no automatizable con Vitest)**

Primero construir `apps/web` (el binding de assets apunta a su `dist/`):

```bash
npm run build -w @tengen/web
```

Luego, desde `apps/worker/`:

```bash
npx wrangler dev
```

Con el Worker corriendo (puerto que indique wrangler, típicamente 8787):
1. Abrir `http://localhost:8787/` — debe cargar el `index.html` de la SPA (el menú "¿Qué querés hacer?").
2. Pedir `curl -i http://localhost:8787/models/no-existe.onnx` — debe devolver un 404 que venga del catch-all (`ASSETS.fetch`, ya que Task 2 todavía no existe) o una respuesta reconocible del Worker, NO un error de conexión.

**Si el paso 1 falla** (la SPA no carga): revisar que `assets.directory` en `wrangler.jsonc` apunte correctamente a `../web/dist` relativo a `apps/worker/` (no a `apps/web/dist` desde la raíz del repo) y que el build de `apps/web` se haya corrido ANTES de `wrangler dev`.

Parar el proceso de `wrangler dev` (Ctrl+C) antes de continuar.

- [ ] **Step 10: Commit**

```bash
git add apps/worker/package.json apps/worker/tsconfig.json apps/worker/wrangler.jsonc \
        apps/worker/src/index.ts apps/worker/vitest.config.ts apps/worker/tests/index.test.ts \
        package-lock.json
git commit -m "feat(worker): scaffold apps/worker — Hono + static assets binding"
```

---

### Task 2: `GET /models/:filename` — proxy a R2 con caché inmutable

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/tests/index.test.ts` (o crear `apps/worker/tests/models.test.ts` — tu criterio, mantenerlo en un archivo si el de Task 1 sigue siendo pequeño)

**Interfaces:**
- Consumes: `Env` de Task 1 (`{ MODELS: R2Bucket; ASSETS: Fetcher }`).
- Produces: la ruta `GET /models/:filename` montada en la misma app Hono exportada por Task 1 — nada nuevo que otras tasks consuman (última pieza de ruteo del Worker en este plan).

- [ ] **Step 1: Test que falla — `apps/worker/tests/models.test.ts`**

```ts
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import app from '../src/index'

describe('GET /models/:filename', () => {
  beforeEach(async () => {
    await env.MODELS.put('existe.onnx', new TextEncoder().encode('contenido-de-prueba'))
  })

  it('devuelve 200 con el contenido y headers de caché inmutable', async () => {
    const res = await app.request('/models/existe.onnx', {}, env)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toBe('contenido-de-prueba')
  })

  it('devuelve 404 si el archivo no existe en el bucket', async () => {
    const res = await app.request('/models/no-existe.onnx', {}, env)
    expect(res.status).toBe(404)
  })

  it('el Content-Length coincide con el tamaño real del objeto', async () => {
    const res = await app.request('/models/existe.onnx', {}, env)
    expect(res.headers.get('Content-Length')).toBe(String('contenido-de-prueba'.length))
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npm test -w @tengen/worker
```

Expected: FAIL — la ruta `/models/:filename` no existe todavía (las 3 aserciones nuevas fallan; los 2 tests de Task 1 siguen en verde).

- [ ] **Step 3: Implementar la ruta — `apps/worker/src/index.ts`**

```ts
import { Hono } from 'hono'

export interface Env {
  MODELS: R2Bucket
  ASSETS: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

app.get('/models/:filename', async (c) => {
  const filename = c.req.param('filename')
  const object = await c.env.MODELS.get(filename)
  if (!object) return c.notFound()
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
})

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npm test -w @tengen/worker
```

Expected: 5/5 PASS (2 de Task 1 + 3 nuevas).

- [ ] **Step 5: Typecheck**

```bash
npx -w @tengen/worker tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/tests/models.test.ts
git commit -m "feat(worker): GET /models/:filename proxya R2 con Cache-Control immutable"
```

---

### Task 3: Fix crítico — onnxruntime-web fuera del dev server (`apps/web`)

**Contexto:** ver "Hallazgo crítico de esta sesión" arriba — sin este fix, el motor no inicializa fuera de `vite dev`, verificado en navegador real. Este task hace que `apps/web/dist/ort-dist/ort-wasm-simd-threaded.jsep.{mjs,wasm}` exista tras `vite build`, replicando (en build-time, no en request-time) lo que hoy hace el middleware `serve-ort-dist` solo en dev.

**Files:**
- Modify: `apps/web/vite.config.ts`

**Interfaces:**
- No expone ninguna interfaz nueva a otras tasks — es un cambio de build únicamente. `packages/engine`/`apps/web` código fuente: **sin cambios** (el fix es enteramente de empaquetado; `session.ts` sigue usando su default `/ort-dist/` sin tocar).

- [ ] **Step 1: Añadir el plugin de copia a `apps/web/vite.config.ts`**

Editar el array `plugins` (que hoy solo tiene `serve-models`) para añadir un plugin nuevo con un hook `closeBundle` (corre después de que Vite terminó de escribir `dist/`, tanto en `vite build` como en cualquier build de producción — a diferencia de `configureServer`, que NO corre en build):

```ts
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'

const rootDir = import.meta.dirname ?? '.'
const modelsDir = path.resolve(rootDir, '../../packages/engine/models')
const ortDist = path.dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))

// ...(ORT_DIST_CONTENT_TYPES y el resto del archivo existente se mantienen igual)

// Variante que la app pide en runtime bajo ep:'webgpu' (confirmado en navegador real —
// ver "Hallazgo crítico" del plan de Fase 4). Solo esta variante, no las otras 3 de
// onnxruntime-web (asyncify/jspi/plain) — ninguna otra vía de EP está configurada en la app
// (`apps/web/src/appFactory.ts` hardcodea `ep: 'webgpu'`).
const ORT_DIST_PROD_FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']

export default defineConfig({
  // OJO: si esta línea ya está presente en el archivo al llegar a esta task, es esperado — se aplicó
  // como fix previo a Task 1 (ver "Hallazgo crítico #2" arriba). No es una desviación tuya, no la quites.
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [
    {
      name: 'serve-models',
      configureServer(server) {
        // ... (sin cambios, contenido existente)
      },
    },
    {
      // Copia el par jsep de onnxruntime-web a dist/ort-dist/ DESPUÉS del build — replica en
      // build-time lo que serve-ort-dist hace en request-time (dev). Sin esto, `session.ts`
      // (`packages/engine`) pide `/ort-dist/ort-wasm-simd-threaded.jsep.mjs` en producción y esa
      // ruta no existe: el motor no inicializa (ver "Hallazgo crítico" del plan de Fase 4).
      name: 'copy-ort-dist-prod',
      closeBundle() {
        const outDir = path.resolve(rootDir, 'dist/ort-dist')
        fs.mkdirSync(outDir, { recursive: true })
        for (const file of ORT_DIST_PROD_FILES) {
          fs.copyFileSync(path.resolve(ortDist, file), path.resolve(outDir, file))
        }
      },
    },
  ],
})
```

(El resto del archivo — el middleware `serve-models` completo y el `serve-ort-dist` de dev — se mantiene EXACTAMENTE igual, no se toca; solo se agrega el tercer plugin. No confundir `serve-ort-dist`, que sigue existiendo para dev, con `copy-ort-dist-prod`, nuevo y exclusivo de build. `resolve.conditions` y `copy-ort-dist-prod` son fixes ortogonales del mismo "Hallazgo crítico #2"/"Hallazgo crítico" — uno evita una copia muerta con hash que rompía el límite de tamaño de Cloudflare, el otro sirve el archivo real que el runtime pide; ninguno reemplaza al otro.)

- [ ] **Step 2: Build y verificar que los archivos existen**

```bash
npm run build -w @tengen/web
ls -la apps/web/dist/ort-dist/
find apps/web/dist/assets -name '*.wasm' -size +1M
```

Expected: `ort-wasm-simd-threaded.jsep.mjs` y `ort-wasm-simd-threaded.jsep.wasm` presentes en `dist/ort-dist/` (el `.wasm` debe pesar ~26 MB — si pesa unos KB, se copió el archivo equivocado). El `find` sobre `dist/assets/` debe salir VACÍO — es la guarda de regresión del "Hallazgo crítico #2": si algún día una versión nueva de onnxruntime-web descontinúa la export condition `onnxruntime-web-use-extern-wasm`, este comando detecta que la copia muerta con hash volvió, en vez de dejar que reinfle `dist/` en silencio.

- [ ] **Step 3: Verificación en navegador real — reproducir el fix del hallazgo crítico**

Este paso NO es opcional ni "nice to have": es la única forma real de confirmar que el fix funciona, dado que el bug original solo se manifestó en un navegador real, nunca en `tsc`/build. Requiere Chrome (vía `chrome-devtools-mcp` si estás en un entorno headless, o Chrome normal si tenés acceso a un navegador con WebGPU).

```bash
# Servir el build de producción real (sin ningún middleware de dev)
npx -w @tengen/web vite preview --port 4173 &
```

Como `vite preview` tampoco corre el middleware `serve-models` (es dev-only, igual que `serve-ort-dist`), copiar el `.onnx` real a mano SOLO para esta verificación local (no commitear, es un artefacto de prueba):

```bash
mkdir -p apps/web/dist/models
cp packages/engine/models/b18c384nbt-kata1.fp32.onnx apps/web/dist/models/
```

En el navegador: ir a `http://localhost:4173/`, click "Jugar", 9×9, KataGo 200 visitas, "Empezar partida". Antes: fallaba con `Failed to fetch dynamically imported module: .../ort-dist/ort-wasm-simd-threaded.jsep.mjs`. Ahora debe llegar a "Preparando motor…" y luego a una partida jugable ("Tu turno (Negro)" o "IA pensando…", sin el mensaje de error).

Limpiar los artefactos de prueba al terminar (no son parte del repo):

```bash
rm -rf apps/web/dist/models
kill %1  # o el PID que haya quedado corriendo vite preview
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/vite.config.ts
git commit -m "fix(web): copia onnxruntime-web (variante jsep) a dist/ort-dist/ en build — fix crítico de carga en producción"
```

---

### Task 4: Headers COOP/COEP en producción (`_headers`)

**Files:**
- Create: `apps/web/public/_headers`

**Interfaces:**
- Ninguna — archivo estático puro, sin código.

- [ ] **Step 1: Crear `apps/web/public/_headers`**

Vite copia todo `public/` verbatim a `dist/` en cada build (convención estándar, sin configurar nada extra) — así este archivo termina en `apps/web/dist/_headers`, que Cloudflare Workers Static Assets interpreta automáticamente (mismo formato que Cloudflare Pages).

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

/ort-dist/*
  Cross-Origin-Embedder-Policy: require-corp
```

(La segunda regla es redundante con la primera hoy — `/*` ya cubre `/ort-dist/*` — pero se deja explícita porque es la pieza que el comentario de `vite.config.ts` marca como estrictamente necesaria para que Chrome no bloquee el worker de ORT bajo `crossOriginIsolated`; si en el futuro la regla `/*` cambia o se acota, esta línea no debe desaparecer silenciosamente.)

- [ ] **Step 2: Build y verificar que se copió**

```bash
npm run build -w @tengen/web
cat apps/web/dist/_headers
```

Expected: el contenido del Step 1, verbatim.

**Nota de verificación honesta:** `vite preview` NO interpreta `_headers` (es una convención exclusiva de Cloudflare Pages/Workers Static Assets) — no hay forma de verificar el EFECTO real de estos headers hasta el deploy real contra Cloudflare (ver la sección "Deploy" más abajo, paso de verificación final). Este task solo puede verificar que el archivo se genera con el contenido correcto, no que Cloudflare lo aplique como se espera — es una limitación real, no una omisión del plan.

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/_headers
git commit -m "feat(web): _headers COOP/COEP para producción (Cloudflare Workers Static Assets)"
```

---

## Deploy (manual — fuera del ciclo SDD, requiere cuenta Cloudflare real)

**Esta sección NO es un task de SDD.** Crea/modifica recursos reales en la cuenta de Cloudflare de Edgar (`edgar.gomero@gmail.com`, `wrangler whoami` ya confirma sesión activa) — bucket R2, deploy del Worker, dominio custom. Por las reglas de "acciones con cuidado" del propio agente: estos pasos requieren confirmación explícita antes de ejecutarse, no se corren dentro de un ciclo SDD desatendido.

**Decisión pendiente antes de correr esto:** `wrangler whoami` muestra DOS cuentas accesibles (`Cloudflare@ceapsi.cl's Account` y `kntor-dev`) — confirmar con Edgar cuál usar antes del primer comando (`wrangler r2 bucket create` toma la cuenta default salvo que se pase `--account-id` explícito). Todo el resto de esta sección asume que ya se resolvió esto.

1. **Crear el bucket R2:**
   ```bash
   npx wrangler r2 bucket create tengen-models
   ```

2. **Subir los dos modelos fp32 reales:**
   ```bash
   npx wrangler r2 object put tengen-models/b18c384nbt-kata1.fp32.onnx --file packages/engine/models/b18c384nbt-kata1.fp32.onnx
   npx wrangler r2 object put tengen-models/b18c384nbt-humanv0.fp32.onnx --file packages/engine/models/b18c384nbt-humanv0.fp32.onnx
   ```

2b. **Subir el runtime de onnxruntime-web bajo el prefijo `ort-dist/`** (Hallazgo crítico #3 — sin esto, `GET /ort-dist/:filename` de Task 3 devuelve 404 y el motor no inicializa en `tengen.kntor.io` aunque el resto del deploy esté bien; source: `node_modules/onnxruntime-web/dist/`, resuelto vía `require.resolve('onnxruntime-web')`):
   ```bash
   npx wrangler r2 object put tengen-models/ort-dist/ort-wasm-simd-threaded.jsep.mjs --file node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs
   npx wrangler r2 object put tengen-models/ort-dist/ort-wasm-simd-threaded.jsep.wasm --file node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm
   ```

3. **Build + deploy del Worker:**
   ```bash
   npm run build -w @tengen/web
   cd apps/worker && npx wrangler deploy
   ```
   Esto publica a un subdominio `*.workers.dev` por defecto — confirmar la URL que imprime wrangler antes del paso siguiente.

4. **Conectar el dominio custom** (`tengen.kntor.io`, dashboard de Cloudflare o `wrangler.jsonc` → `routes` — cualquiera de las dos vías, `kntor.io` ya está en la misma cuenta así que no hace falta cambiar nameservers).

5. **Gate manual final (Edgar, Chrome/WebGPU real) — mismo tipo de verificación que cerró Fase 2 y Fase 3a, ahora contra el dominio real:**
   - Entrar a `tengen.kntor.io`, confirmar que carga.
   - Network tab: confirmar que el `.onnx` se descarga desde `tengen.kntor.io/models/...` (no localhost) y que los headers `Cache-Control`/COOP/COEP llegan como se espera (esto es lo único que NO se pudo verificar en Task 4 sin un deploy real — verificarlo aquí cierra esa nota pendiente).
   - Partida completa en Modo Jugar (9×9 contra KataGo, alguna cantidad de visitas).
   - Modo Analizar: cargar un SGF real, pedir un análisis, confirmar que el gráfico de winrate y el review progresivo avanzan.
   - Confirmar en la consola del navegador: `self.crossOriginIsolated` → `true`.

---

## Self-Review (hecho por el autor de este plan antes de entregarlo)

**Cobertura de la spec:** arquitectura (Worker+Hono+assets+R2) → Tasks 1-2. Modelos en R2 + nombres/tamaños exactos → Deploy paso 1-2 (Task 2 los referencia en tests, sin subir nada real). Dominio → Deploy paso 4. Headers COOP/COEP → Task 4. El hallazgo crítico de `ort-dist` no estaba en la spec original (se descubrió DURANTE la escritura de este plan, verificado en navegador real) → Task 3, con su propia sección "Hallazgo crítico" para que quede trazable por qué existe.

**Scan de placeholders:** sin TBD/TODO. La única verificación marcada explícitamente como no-automatizable (headers `_headers` reales) está declarada como tal con su razón, no escondida.

**Consistencia de tipos:** `Env { MODELS: R2Bucket; ASSETS: Fetcher }` se define una vez en Task 1 y se reutiliza sin cambios en Task 2 — ninguna otra task declara su propio `Env`.
