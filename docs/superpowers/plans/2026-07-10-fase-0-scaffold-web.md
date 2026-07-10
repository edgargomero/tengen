# Fase 0 — Scaffold `apps/web` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crear `apps/web` (Preact + Vite + TS) que importe `@tengen/engine` limpio, corra el motor en su PROPIO Web Worker (con factory inyectada), sirva `/models/` y `/ort-dist/` en dev, aplique el gate de WebGPU y exponga un smoke `init`+`genMove` verificable a ojo por Edgar en Chrome/WebGPU.

**Architecture:** `apps/web` es una SPA Preact servida por Vite. Reusa el contrato del motor tal cual: el hilo principal usa `WorkerEngine`; el Worker (archivo propio de la app) construye `new LocalEngine({ evaluatorFactory })` y lo cablea con `createWorkerHandler` (función pura reusada del motor). La única pieza net-new de motor es extraer esa función pura a un módulo sin side-effects para poder importarla desde el barrel sin arrastrar el auto-cableado del browser del motor. La factory de Fase 0 es trivial (`/models/<id>.onnx` → `OnnxEvaluator.create`); OPFS/R2 es Fase 1.

**Tech Stack:** Preact 10, Vite 6, TypeScript 5.9 (strict + `noUncheckedIndexedAccess`), `@tengen/engine` (workspace), onnxruntime-web (transitivo, WebGPU), `@sabaki/shudan` + `@sabaki/sgf` (deps de scaffold, sin usar hasta Fase 2/3).

## Global Constraints

- **Idioma:** documentación, comentarios y mensajes de commit en español; identificadores de código en inglés.
- **Preact + Shudan** (no forkear web-katrain — decisión "no re-litigar" de CLAUDE.md).
- **Chrome-first:** WebGPU REQUERIDO en v1; sin fallback WASM. Sin WebGPU → pantalla "usa Chrome/Edge".
- **`@tengen/engine` es la única fuente del contrato UI↔motor.** `winrate`/`scoreLead` SIEMPRE en perspectiva de Negro (no invertir). Una instancia de `LocalEngine`/Worker sirve un único `boardSize`.
- **TS strict + `noUncheckedIndexedAccess`** (heredado de `tsconfig.base.json`; no relajar).
- **La suite del motor DEBE seguir verde** tras cualquier edición al engine: `npm test -w @tengen/engine` (88 tests) + `npm run test:nn -w @tengen/engine` (10 tests).
- **El middleware `serve-ort-dist` es OBLIGATORIO** y debe fijar `Cross-Origin-Embedder-Policy: require-corp` explícito **por-archivo** (los headers de `server.headers` NO aplican a middlewares propios), o Chrome bloquea el worker de ORT con `ERR_BLOCKED_BY_RESPONSE`.
- **NO implementar OPFS/R2 en Fase 0** (es Fase 1). La factory de la app es trivial: URL `/models/<id>.onnx` → `OnnxEvaluator.create(url, { boardSize, ep: 'webgpu' })`.
- **Modelos nunca en git** (`.gitignore` bloquea `*.onnx`). En dev, `apps/web` sirve `/models/` desde `packages/engine/models/` (donde ya están los `.onnx` convertidos), sin duplicar bytes.
- **Verificación de runtime WebGPU** (`init`+`genMove`) la corre **Edgar** (headless no puede WebGPU). El gate auto-verificable de cada tarea: `tsc --noEmit` con 0 errores, suite del motor verde (Task 1), y `vite build` de `apps/web` con exit 0 (los *warnings* de bundling de onnxruntime-web son aceptables).

---

### Task 1: Motor — extraer `createWorkerHandler` a un módulo sin side-effects y exportar la superficie que consume `apps/web`

**Contexto:** Hoy `createWorkerHandler` (la unidad pura) vive en `packages/engine/src/worker/engine.worker.ts`, que TAMBIÉN tiene al final un bloque de entrada del browser (`if (typeof self !== 'undefined' && document === undefined) { ... new LocalEngine() ... }`). Ese bloque se ejecuta como side-effect al importar el módulo dentro de un Worker. Si `apps/web` importara `createWorkerHandler` desde el barrel, ese side-effect cablearía un segundo handler con la factory por DEFECTO del motor dentro del worker de la app. Solución: mover la función pura a `worker/handler.ts` (sin side-effects) y que `engine.worker.ts` la importe solo para su propia entrada del browser. Es un refactor puro: la red de seguridad es la suite existente (no se escribe test nuevo).

**Files:**
- Create: `packages/engine/src/worker/handler.ts`
- Modify: `packages/engine/src/worker/engine.worker.ts` (queda solo la entrada del browser + import de `./handler`)
- Modify: `packages/engine/src/index.ts` (barrel: exportar `createWorkerHandler`, `type PostFn`, `OnnxEvaluator`, `type NNEvaluator`)
- Modify: `packages/engine/package.json` (añadir campo `exports`)
- Modify: `packages/engine/tests/worker.test.ts:4` (import desde `../src/worker/handler`)

**Interfaces:**
- Consumes: `LocalEngine` (`../engine`), `Analysis` (`../types`), `transferablesOf`/`WorkerRequest`/`WorkerResponse` (`./protocol`).
- Produces (para Tasks 3–4, importables como `@tengen/engine`):
  - `createWorkerHandler(engine: LocalEngine, post: PostFn): (req: WorkerRequest) => void`
  - `type PostFn = (msg: WorkerResponse, transfer?: Transferable[]) => void`
  - `OnnxEvaluator` con `static create(source: string | ArrayBuffer, opts: { boardSize: number; ep?: 'webgpu' | 'wasm'; wasmPaths?: string }): Promise<OnnxEvaluator>`
  - `type NNEvaluator` (lo que la firma de `evaluatorFactory` produce)
  - Ya exportados hoy y que también se consumen: `LocalEngine`, `WorkerEngine`, `type Position`, `type NetworkId`, `type BoardSize`, `type Move`, `type WorkerRequest`, `type WorkerResponse`.

- [ ] **Step 1: Crear `handler.ts` con la función pura movida**

Crear `packages/engine/src/worker/handler.ts`. Copiar VERBATIM de `engine.worker.ts` el bloque que va desde `type PostFn` hasta el cierre de `createWorkerHandler` (incluye el helper `errorMessage`), con sus imports. NO copiar el bloque de entrada del browser del final. Contenido exacto:

```ts
// Manejador PURO del protocolo del Worker (sin tocar `self`): gestiona la cola serial de operaciones,
// el streaming de `analyze` y el BYPASS de `stop`. Se testea en Node con un canal mock
// (tests/worker.test.ts) y se reusa desde `engine.worker.ts` (entrada del browser del motor) y desde
// `apps/web/src/engine.worker.ts` (entrada del browser de la app, con su propia factory). Movido aquí
// desde `engine.worker.ts` para que importarlo NO arrastre el side-effect de auto-cableado del browser.

import type { Analysis } from '../types'
import { LocalEngine } from '../engine'
import { transferablesOf, type WorkerRequest, type WorkerResponse } from './protocol'

/** Canal de salida (Worker → hilo principal). El browser lo respalda con `self.postMessage`; el test
 *  con un canal mock. El segundo argumento son los Transferables (`transferablesOf`). */
export type PostFn = (msg: WorkerResponse, transfer?: Transferable[]) => void

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Fábrica del manejador de mensajes del Worker. Recibe un `LocalEngine` (la extensión de `analyze`
 * con hooks `onDone`/`onError` vive en la clase concreta, no en la interfaz pública `Engine`) y un
 * `post` para responder. Devuelve `(req) => void` para cablear a `onmessage`.
 *
 * Concurrencia:
 * - `init`/`genMove`/`analyze` se ENCOLAN en serie (`queue = queue.then(...)`) y se esperan a
 *   completar: el scratch del MCTS (`expandScratch` en analyzeMcts.ts) es global y no reentrante.
 * - `stop` se maneja al RECIBIR, FUERA de la cola. Si pasara por la misma cola quedaría encolado
 *   detrás del `analyze` en vuelo —que sólo termina al cancelarse— produciendo un DEADLOCK: `stop`
 *   nunca correría y `analyze` nunca pararía. Sólo hace `engine.stop()` (flip del flag cooperativo) y
 *   resuelve la entrada de cola del `analyze` activo. Esa resolución es imprescindible: la cancelación
 *   NO dispara `onDone`/`onError` (contrato de `final`), así que sin ella la entrada quedaría colgada.
 *
 * Nota (sub-especificado, documentado en el reporte de Task 13): una operación de búsqueda encolada
 * INMEDIATAMENTE tras un `stop` puede reiniciar el flag `cancelled` mientras el IIFE de `analyze`
 * cancelado aún se desenrolla. Al ser JS mono-hilo no hay corrupción del scratch (buffer transitorio,
 * sin `await` en su ventana viva); el residuo es lógico (un `onUpdate` tardío para un id ya detenido,
 * que el cliente ignora porque borró su callback). Cerrarlo requeriría una señal de asentamiento de
 * cancelación que el set fijo de dos hooks omite a propósito → fuera de scope.
 */
export function createWorkerHandler(engine: LocalEngine, post: PostFn): (req: WorkerRequest) => void {
  let queue: Promise<void> = Promise.resolve()
  // Resolutor de la entrada de cola del `analyze` en vuelo (undefined si no hay ninguno). Lo invoca el
  // handler de `stop` para desbloquear la cola al cancelar (ver doc arriba).
  let resolveActiveAnalyze: (() => void) | undefined

  const enqueue = (task: () => Promise<void>): void => {
    // `.catch` defensivo: una tarea nunca debe dejar la cola en estado rechazado (colgaría las
    // siguientes). Cada handler ya captura sus errores y los traduce a un mensaje 'error'.
    queue = queue.then(task).catch(() => {})
  }

  const handleInit = async (req: Extract<WorkerRequest, { type: 'init' }>): Promise<void> => {
    try {
      await engine.init({ network: req.network, boardSize: req.boardSize })
      post({ type: 'ready', id: req.id })
    } catch (e) {
      post({ type: 'error', id: req.id, message: errorMessage(e) })
    }
  }

  const handleGenMove = async (req: Extract<WorkerRequest, { type: 'genMove' }>): Promise<void> => {
    try {
      const move = await engine.genMove(req.pos, { level: req.level })
      post({ type: 'move', id: req.id, move })
    } catch (e) {
      post({ type: 'error', id: req.id, message: errorMessage(e) })
    }
  }

  const handleAnalyze = (req: Extract<WorkerRequest, { type: 'analyze' }>): Promise<void> => {
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolveActiveAnalyze = undefined
        resolve()
      }
      const emit = (analysis: Analysis, final: boolean): void => {
        const msg: WorkerResponse = { type: 'analysis', id: req.id, analysis, final }
        post(msg, transferablesOf(msg))
      }
      // Registrar el resolutor ANTES de lanzar: un `stop` puede llegar en cuanto el primer `await`
      // interno ceda el control.
      resolveActiveAnalyze = finish
      engine.analyze(
        req.pos,
        { visits: req.visits },
        (a) => emit(a, false),
        {
          // Completado natural (target ≥ visits): emite el `final:true` y desbloquea la cola.
          onDone: (a) => {
            emit(a, true)
            finish()
          },
          // Error: lo traduce a mensaje y desbloquea la cola.
          onError: (e) => {
            post({ type: 'error', id: req.id, message: errorMessage(e) })
            finish()
          },
        },
      )
    })
  }

  return (req: WorkerRequest): void => {
    switch (req.type) {
      case 'stop':
        // BYPASS de la cola (ver doc de la fábrica): se maneja de inmediato para no caer en deadlock.
        engine.stop()
        resolveActiveAnalyze?.()
        break
      case 'init':
        enqueue(() => handleInit(req))
        break
      case 'genMove':
        enqueue(() => handleGenMove(req))
        break
      case 'analyze':
        enqueue(() => handleAnalyze(req))
        break
    }
  }
}
```

- [ ] **Step 2: Reducir `engine.worker.ts` a la entrada del browser + import de `./handler`**

Reemplazar TODO el contenido de `packages/engine/src/worker/engine.worker.ts` por:

```ts
// Entrada del browser del MOTOR (standalone / smoke): SÓLO dentro de un dedicated worker real crea un
// `LocalEngine` con la factory por defecto (/models/<id>.onnx del dev server) y cablea `self`. La lógica
// pura del handler vive en `./handler` (reusada por este archivo y por apps/web con su propia factory).
// En Node/vitest `self` es `undefined` (guarda primaria); el chequeo de `document` descarta además un
// entorno tipo jsdom (donde `self` sería la ventana). Así, importar este módulo en la suite NO cablea
// `onmessage`.

import { LocalEngine } from '../engine'
import { createWorkerHandler } from './handler'
import type { WorkerRequest } from './protocol'

if (typeof self !== 'undefined' && typeof (self as { document?: unknown }).document === 'undefined') {
  const scope = self as unknown as {
    postMessage(message: unknown, transfer?: Transferable[]): void
    addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  }
  const engine = new LocalEngine() // factory por defecto (/models/<id>.onnx, servido por el dev server)
  const handle = createWorkerHandler(engine, (msg, transfer) => scope.postMessage(msg, transfer ?? []))
  scope.addEventListener('message', (ev) => handle(ev.data as WorkerRequest))
}
```

- [ ] **Step 3: Actualizar el import del test**

En `packages/engine/tests/worker.test.ts`, línea 4, cambiar:

```ts
import { createWorkerHandler, type PostFn } from '../src/worker/engine.worker'
```

por:

```ts
import { createWorkerHandler, type PostFn } from '../src/worker/handler'
```

- [ ] **Step 4: Exportar la nueva superficie desde el barrel**

Reemplazar `packages/engine/src/index.ts` por:

```ts
export * from './types'
export { LocalEngine } from './engine'
export { WorkerEngine, type WorkerLike } from './worker/client'
export { createWorkerHandler, type PostFn } from './worker/handler'
export { OnnxEvaluator, type NNEvaluator } from './nn/evaluator'
export type { WorkerRequest, WorkerResponse } from './worker/protocol'
```

- [ ] **Step 5: Añadir el campo `exports` a `package.json` del motor**

En `packages/engine/package.json`, añadir la clave `"exports"` (justo después de `"type": "module",`), apuntando al fuente TS (no hay paso de build; Vite/tsc con `moduleResolution: bundler` resuelven `.ts`):

```json
  "exports": {
    ".": "./src/index.ts"
  },
```

- [ ] **Step 6: Typecheck del motor**

Run: `npx -w @tengen/engine tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 7: Suite del motor (unit + nn) verde**

Run: `npm test -w @tengen/engine`
Expected: todos los tests pasan (88).

Run: `npm run test:nn -w @tengen/engine`
Expected: todos los tests pasan (10). (Requiere los fixtures committeados en `tests/fixtures/reference/`; NO requiere WebGPU.)

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/worker/handler.ts packages/engine/src/worker/engine.worker.ts packages/engine/src/index.ts packages/engine/package.json packages/engine/tests/worker.test.ts
git commit -m "refactor(engine): extraer createWorkerHandler a worker/handler.ts sin side-effects + exports para apps/web"
```

---

### Task 2: Scaffold del proyecto `apps/web` (Preact + Vite + TS) con middlewares de Vite

**Contexto:** `apps/*` ya está en `workspaces` del `package.json` raíz. Este task crea el proyecto y su configuración de Vite (incluidos los middlewares portados del motor), pero aún SIN worker ni smoke (Tasks 3–4). El `main.tsx` de este task es un placeholder mínimo cuyo único fin es probar que el build resuelve el grafo Preact.

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`

**Interfaces:**
- Consumes: `@tengen/engine` (barrel; se importará en Tasks 3–4). onnxruntime-web se resuelve transitivamente desde el motor (hoisteado a `node_modules/` raíz).
- Produces: workspace `@tengen/web` instalado y linkeado; scripts `dev`/`build`/`typecheck`; middlewares `serve-models` (dev, apunta a `packages/engine/models/`) y `serve-ort-dist` (dev, con COEP por-archivo).

- [ ] **Step 1: Crear `apps/web/package.json`**

`@tengen/engine` se referencia con `"*"` (npm workspaces lo linkea al paquete local). Las versiones de deps externas se resuelven en el Step 3 con `npm install` (no hardcodear versiones a ciegas).

```json
{
  "name": "@tengen/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@tengen/engine": "*",
    "preact": "^10.24.0"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Crear `apps/web/tsconfig.json`**

Extiende la base (strict + `noUncheckedIndexedAccess` + `moduleResolution: bundler` + `target ES2022`). Añade `lib` DOM y el runtime JSX automático de Preact. Solo incluye `src` (no `vite.config.ts`, igual que el motor).

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Instalar dependencias y linkear el workspace**

Run (desde la raíz del repo). El primer `npm install` registra/linkea el workspace `@tengen/web` recién creado (sin él, el `-w @tengen/web` hace un no-op silencioso con warning "no workspace folder present"); el segundo añade las deps de scaffold:
```bash
npm install && npm install -w @tengen/web -D @sabaki/shudan @sabaki/sgf
```
Esto linkea `@tengen/engine` y `@tengen/web` en el workspace y añade `@sabaki/shudan` y `@sabaki/sgf` (deps de scaffold para Fase 2/3 — se instalan ahora pero NO se importan en Fase 0) a `apps/web`, resolviendo sus versiones reales en `package.json`.
Expected: `node_modules/@tengen/engine` existe como symlink a `packages/engine`; `node_modules/@tengen/web` existe.

Run: `ls -la node_modules/@tengen/`
Expected: se ven `engine` y `web` (symlinks).

- [ ] **Step 4: Crear `apps/web/vite.config.ts`**

Portado de `packages/engine/vite.config.ts` (archivo propio de tengen, no upstream). Diferencias: JSX de Preact vía esbuild (sin plugin de babel — Fase 0 no necesita fast-refresh); `modelsDir` apunta a `packages/engine/models/` (dos niveles arriba). Los middlewares `serve-models` y `serve-ort-dist` van VERBATIM salvo `modelsDir`.

```ts
// Config de Vite de apps/web. Portado de packages/engine/vite.config.ts (archivo propio de tengen).
// - JSX de Preact vía esbuild (runtime automático); sin @preact/preset-vite (Fase 0 no necesita HMR de
//   componentes; se puede añadir en Fase 2).
// - serve-models (dev): sirve /models/ desde packages/engine/models/ (donde están los .onnx convertidos),
//   sin duplicar bytes ni committear modelos.
// - serve-ort-dist (dev, OBLIGATORIO): onnxruntime-web hace import() dinámico de sus .mjs desde
//   ort.env.wasm.wasmPaths='/ort-dist/'. Vite dev NO sirve archivos de public/ pedidos como import de
//   módulo, así que hace falta este middleware; y el .mjs cargado como script de worker bajo
//   crossOriginIsolated DEBE llegar con COEP: require-corp por-archivo o Chrome lo bloquea.
// COOP/COEP a nivel server habilitan crossOriginIsolated (WASM multihilo); WebGPU no los necesita pero
// no estorban.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'

const rootDir = import.meta.dirname ?? '.'
const modelsDir = path.resolve(rootDir, '../../packages/engine/models')

// onnxruntime-web puede vivir hoisteado en la raíz del monorepo; se resuelve con Node.
const ortDist = path.dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))

const ORT_DIST_CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
}

export default defineConfig({
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
        server.middlewares.use('/models', (req, res, next) => {
          const file = path.resolve(modelsDir, decodeURIComponent(req.url!.replace(/^\//, '')))
          // Protección contra path traversal: el path resuelto debe seguir dentro de models/.
          if (file !== modelsDir && !file.startsWith(modelsDir + path.sep)) return next()
          let st: fs.Stats
          try {
            st = fs.statSync(file)
          } catch {
            return next()
          }
          if (!st.isFile()) return next()
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', String(st.size))
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          fs.createReadStream(file)
            .on('error', (err) => res.destroy(err))
            .pipe(res)
        })
        server.middlewares.use('/ort-dist', (req, res, next) => {
          // Las requests llegan como ".../ort-wasm-simd-threaded.jsep.mjs?import".
          const urlPath = req.url!.split('?')[0]
          const file = path.resolve(ortDist, decodeURIComponent(urlPath.replace(/^\//, '')))
          if (file !== ortDist && !file.startsWith(ortDist + path.sep)) return next()
          let st: fs.Stats
          try {
            st = fs.statSync(file)
          } catch {
            return next()
          }
          if (!st.isFile()) return next()
          const contentType = ORT_DIST_CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
          res.setHeader('Content-Type', contentType)
          res.setHeader('Content-Length', String(st.size))
          // ORT multihilo carga este .mjs como script de un dedicated worker; bajo crossOriginIsolated el
          // worker hereda COEP y su script debe llegar con este header o Chrome lo bloquea. Los headers de
          // `server.headers` no aplican a middlewares propios.
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          fs.createReadStream(file)
            .on('error', (err) => res.destroy(err))
            .pipe(res)
        })
      },
    },
  ],
})
```

- [ ] **Step 5: Crear `apps/web/index.html`**

```html
<!doctype html>
<meta charset="utf-8" />
<title>tengen</title>
<div id="app"></div>
<script type="module" src="/src/main.tsx"></script>
```

- [ ] **Step 6: Crear `apps/web/src/main.tsx` (placeholder mínimo)**

Placeholder para probar que el grafo Preact compila y bundlea. El gate de WebGPU y el smoke llegan en Task 4.

```tsx
import { render } from 'preact'

function App() {
  return (
    <main>
      <h1>tengen</h1>
      <p>scaffold ok — Fase 0</p>
    </main>
  )
}

const root = document.getElementById('app')
if (root) render(<App />, root)
```

- [ ] **Step 7: Typecheck de `apps/web`**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 8: Build de `apps/web`**

Run: `npm run build -w @tengen/web`
Expected: exit 0 (se genera `apps/web/dist/`). Los warnings de Rollup (p.ej. sobre onnxruntime-web, aunque en este task aún no se importa) son aceptables.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html apps/web/src/main.tsx package-lock.json
git commit -m "feat(web): scaffold apps/web (Preact + Vite + TS) con middlewares serve-models/serve-ort-dist"
```

---

### Task 3: Worker propio de `apps/web` + factory de evaluador trivial (Fase 0)

**Contexto:** `apps/web` necesita su PROPIO worker para que Vite lo empaquete con la factory de la app inyectada (el worker del motor hardcodea la factory `/models/` por defecto; ver Task 1). La factory de Fase 0 es trivial: mapea `NetworkId` → `/models/<archivo>.onnx` (servido por `serve-models`) → `OnnxEvaluator.create` con WebGPU. OPFS/R2 es Fase 1.

**Files:**
- Create: `apps/web/src/appFactory.ts`
- Create: `apps/web/src/engine.worker.ts`

**Interfaces:**
- Consumes: `OnnxEvaluator`, `type NNEvaluator`, `type NetworkId`, `type BoardSize`, `createWorkerHandler`, `LocalEngine`, `type WorkerRequest` (todos de `@tengen/engine`, expuestos en Task 1).
- Produces:
  - `appEvaluatorFactory(net: NetworkId, boardSize: BoardSize): Promise<NNEvaluator>`
  - `apps/web/src/engine.worker.ts` como entrada de Worker (consumida por Task 4 vía `new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })`).

- [ ] **Step 1: Crear `apps/web/src/appFactory.ts`**

```ts
// Factory de evaluador de Fase 0: mapea NetworkId → /models/<archivo>.onnx (servido por el middleware
// serve-models del dev server, que apunta a packages/engine/models/) y construye un OnnxEvaluator WebGPU.
// TRIVIAL a propósito: Fase 1 reemplaza esto por caché OPFS + descarga R2 con progreso.
import { OnnxEvaluator } from '@tengen/engine'
import type { BoardSize, NetworkId, NNEvaluator } from '@tengen/engine'

// Nombres de archivo bajo /models/ (dev: packages/engine/models/). Coinciden con los .onnx convertidos
// ya presentes en disco. b10 aún no convertida.
const MODEL_FILES: Record<NetworkId, string> = {
  b18: 'b18c384nbt-kata1.fp16.onnx',
  humanv0: 'b18c384nbt-humanv0.fp16.onnx',
  b10: '',
}

export async function appEvaluatorFactory(net: NetworkId, boardSize: BoardSize): Promise<NNEvaluator> {
  const file = MODEL_FILES[net]
  if (file === '') throw new Error(`red ${net} aún no disponible en apps/web`)
  return OnnxEvaluator.create(`/models/${file}`, { boardSize, ep: 'webgpu' })
}
```

- [ ] **Step 2: Crear `apps/web/src/engine.worker.ts`**

Este módulo se ejecuta SÓLO como entrada de Worker (Vite lo empaqueta al ver `new Worker(new URL('./engine.worker.ts', import.meta.url))` en Task 4); nunca se importa en el hilo principal, así que NO necesita la guarda `typeof self`. Se castea `self` (como en el motor) porque el `lib` DOM tipa `self` como `Window` (cuyo `postMessage` tiene otra firma).

```ts
// Worker propio de apps/web. Reusa la función pura createWorkerHandler del motor pero INYECTA la factory
// de la app (appEvaluatorFactory) en lugar de la factory por defecto /models/ del motor. Se ejecuta sólo
// como entrada de Worker (Vite lo empaqueta vía new Worker(new URL(...))), nunca en el hilo principal.
import { createWorkerHandler, LocalEngine } from '@tengen/engine'
import type { WorkerRequest } from '@tengen/engine'
import { appEvaluatorFactory } from './appFactory'

// `self` está tipado como Window (lib DOM); su postMessage tiene otra firma. Cast al contrato real del
// dedicated worker scope (mismo patrón que packages/engine/src/worker/engine.worker.ts).
const scope = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
}

const engine = new LocalEngine({ evaluatorFactory: appEvaluatorFactory })
const handle = createWorkerHandler(engine, (msg, transfer) => scope.postMessage(msg, transfer ?? []))
scope.addEventListener('message', (ev) => handle(ev.data as WorkerRequest))
```

- [ ] **Step 3: Typecheck de `apps/web`**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 4: Build de `apps/web`**

Run: `npm run build -w @tengen/web`
Expected: exit 0. El build resuelve el grafo del worker; el import de `@tengen/engine` (con `OnnxEvaluator` → onnxruntime-web) se bundlea en el chunk del worker. Warnings de Rollup sobre onnxruntime-web son aceptables (sus `.wasm`/`.mjs` se cargan en runtime desde `/ort-dist/`, no se bundlean).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/appFactory.ts apps/web/src/engine.worker.ts
git commit -m "feat(web): worker propio de apps/web + factory de evaluador trivial (Fase 0)"
```

---

### Task 4: Gate de WebGPU + smoke `init`+`genMove` en la UI

**Contexto:** Cierra Fase 0. Al cargar, la app detecta WebGPU; si no hay, muestra "usa Chrome/Edge". Si hay, muestra un botón que crea el Worker real, inicializa `b18` en 9×9 y pide una jugada kata (100 visitas) en el tablero vacío, imprimiendo la jugada. Es el equivalente Preact de `engine-smoke.html`/`smoke-main.ts` del motor, pero usando el worker y la factory de `apps/web`. La verificación de runtime (que efectivamente devuelva una jugada) la corre Edgar en Chrome/WebGPU.

**Files:**
- Create: `apps/web/src/webgpu.ts`
- Modify: `apps/web/src/main.tsx` (reemplaza el placeholder de Task 2)

**Interfaces:**
- Consumes: `WorkerEngine`, `type Position` (de `@tengen/engine`); `apps/web/src/engine.worker.ts` (Task 3); `detectWebGpu` (este task).
- Produces: `detectWebGpu(): Promise<boolean>`; app con gate + smoke.

- [ ] **Step 1: Crear `apps/web/src/webgpu.ts`**

```ts
// Detección de WebGPU (Chrome-first, sin fallback WASM en v1 — ver CLAUDE.md). No basta con que exista
// `navigator.gpu`: puede existir y no entregar adapter (GPU bloqueada, driver, etc.), así que se pide el
// adapter real. La app sólo arranca el motor si esto es true.
interface MinimalGpu {
  requestAdapter(): Promise<unknown | null>
}

export async function detectWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu
  if (!gpu) return false
  try {
    const adapter = await gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Reemplazar `apps/web/src/main.tsx` con gate + smoke**

```tsx
// Entrada de la SPA (Fase 0): gate de WebGPU + smoke manual del Worker. El smoke crea el Worker REAL de
// apps/web (factory propia → /models/<id>.onnx del dev server), inicializa b18 en 9×9 y pide una jugada
// kata en el tablero vacío. Verificación a ojo por Edgar en Chrome/WebGPU (headless no puede WebGPU).
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { WorkerEngine } from '@tengen/engine'
import type { Position } from '@tengen/engine'
import { detectWebGpu } from './webgpu'

function Smoke() {
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const append = (line: string): void => setLog((l) => [...l, line])

  async function runSmoke(): Promise<void> {
    setRunning(true)
    setLog([])
    // El bundler (Vite) resuelve engine.worker.ts como módulo de worker con esta forma canónica.
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    const engine = new WorkerEngine(worker)
    try {
      append('init b18 en 9×9…')
      await engine.init({ network: 'b18', boardSize: 9 })
      append('genMove kata (100 visitas) en tablero vacío…')
      const empty: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }
      const move = await engine.genMove(empty, { level: { kind: 'kata', visits: 100 } })
      append('jugada: ' + JSON.stringify(move))
      append('OK ✓')
    } catch (e) {
      append('ERROR: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      worker.terminate()
      setRunning(false)
    }
  }

  return (
    <main style="font: 14px/1.5 system-ui; margin: 2rem; max-width: 48rem;">
      <h1>tengen — smoke Worker (Fase 0)</h1>
      <p>
        Crea el Worker real, inicializa <code>b18</code> en 9×9 y pide una jugada kata (100 visitas) en el
        tablero vacío. Requiere los <code>.onnx</code> en <code>packages/engine/models/</code>.
      </p>
      <button disabled={running} onClick={() => void runSmoke()}>
        {running ? 'corriendo…' : 'Correr smoke'}
      </button>
      <pre style="margin-top: 1rem; padding: 1rem; border: 1px solid #ccc; white-space: pre-wrap; min-height: 4rem;">
        {log.join('\n')}
      </pre>
    </main>
  )
}

function NoWebGpu() {
  return (
    <main style="font: 14px/1.5 system-ui; margin: 2rem; max-width: 48rem;">
      <h1>tengen</h1>
      <p>
        tengen necesita <strong>WebGPU</strong>. Abre esta página en <strong>Chrome o Edge</strong>{' '}
        recientes (WebGPU habilitado).
      </p>
    </main>
  )
}

function App() {
  const [webgpu, setWebgpu] = useState<boolean | null>(null)
  useEffect(() => {
    void detectWebGpu().then(setWebgpu)
  }, [])
  if (webgpu === null) {
    return (
      <main style="font: 14px/1.5 system-ui; margin: 2rem;">
        <p>detectando WebGPU…</p>
      </main>
    )
  }
  return webgpu ? <Smoke /> : <NoWebGpu />
}

const root = document.getElementById('app')
if (root) render(<App />, root)
```

- [ ] **Step 3: Typecheck de `apps/web`**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin salida, exit 0.

- [ ] **Step 4: Build de `apps/web`**

Run: `npm run build -w @tengen/web`
Expected: exit 0. Warnings de Rollup sobre onnxruntime-web aceptables.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/webgpu.ts apps/web/src/main.tsx
git commit -m "feat(web): gate de WebGPU + smoke init/genMove en la UI (cierra Fase 0)"
```

---

## Verificación de Fase 0

**Auto-verificable (gate de esta corrida, sin WebGPU):**
- Task 1: `npx -w @tengen/engine tsc --noEmit` 0 + `npm test -w @tengen/engine` (88) + `npm run test:nn -w @tengen/engine` (10) verdes.
- Tasks 2–4: `npx -w @tengen/web tsc --noEmit` 0 + `npm run build -w @tengen/web` exit 0.

**Gate manual de Edgar (Chrome/WebGPU, headless no puede):**
- `npm run dev -w @tengen/web`, abrir en Chrome/Edge, pulsar "Correr smoke"; esperado: se imprime una `jugada: {"color":"black","vertex":{...}}` y `OK ✓`. Sin WebGPU: se ve la pantalla "usa Chrome/Edge".

## Notas de scope (Fase 0)

- La factory es trivial a propósito (URL → `OnnxEvaluator.create`); OPFS/R2 con progreso es **Fase 1**.
- `@sabaki/shudan` y `@sabaki/sgf` se instalan como deps de scaffold pero NO se importan en Fase 0 (se usan en Fase 2/3). No es código muerto: es preparación del workspace mandada por el roadmap.
- Sin `@preact/preset-vite`: el JSX de Preact va por esbuild; el fast-refresh de componentes se puede añadir en Fase 2 si hace falta.
