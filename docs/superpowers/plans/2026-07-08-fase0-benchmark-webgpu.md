# Fase 0: Benchmark WebGPU de redes KataGo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir inferencias/segundo reales de las redes de KataGo (b28, b18, Human SL) en onnxruntime-web/WebGPU en Chrome, dejando montado el monorepo y `npm run bench` como herramienta permanente.

**Architecture:** Monorepo npm workspaces. `packages/engine` nace en esta fase con el harness de benchmark: una página Vite que carga ONNX desde `models/` (descargados por script, nunca en git), crea sesiones onnxruntime-web (EP webgpu, fallback wasm medible), corre inferencias cronometradas con una posición de tablero vacío, y muestra/exporta la tabla de resultados. Los módulos puros (stats, featurización mínima, f16, registry) se desarrollan con TDD; la medición en GPU es manual en Chrome.

**Tech Stack:** TypeScript (ESM, strict), npm workspaces, Vite, Vitest, onnxruntime-web ^1.24.3. Conversión de redes: pixi + kaya-go/katago-onnx (Python, solo herramienta local).

## Global Constraints

- Chrome-first: WebGPU es el EP objetivo; wasm se mide solo como referencia (spec: "Chrome-first, WebGPU requerido en v1").
- Redes neuronales NUNCA en git: `.gitignore` ya bloquea `*.onnx` y `*.bin.gz`; viven en `packages/engine/models/` (gitignored).
- **Kaya (kaya-go/kaya) es AGPL-3.0: prohibido copiar su código.** Sus MODELOS en HuggingFace son MIT (model card) y sí se usan. El conversor kaya-go/katago-onnx (AGPL) se usa solo como herramienta local de desarrollo — no se vendoriza ni se redistribuye.
- Los datos duros (URLs, bytes, contrato I/O) provienen de `docs/research/fase0/*.md`; ante discrepancia en ejecución, actualizar esos docs, no improvisar.
- Contrato I/O (verificado por decodificación protobuf): inputs `bin_input` [batch,22,H,W] y `global_input` [batch,19]; los `.fp16.onnx` de kaya tienen I/O **float16** (la model card de HF dice FP32 y está mal); `.fp32`/`.uint8` tienen I/O float32. El b18 de WeiqiPlayground usa nombres en PLURAL (`bin_inputs`/`global_inputs`).
- Documentación, commits y mensajes en español; identificadores de código en inglés.
- Gate de la spec: si b18 fp16 rinde <2 inf/s en hardware típico, el plan B es b10/b15 como red principal — el resultado se registra en `docs/research/fase0/resultados.md` y se decide ahí.

## File Structure

```
tengen/
├── package.json                          # workspaces: ["packages/*", "apps/*"]
├── tsconfig.base.json
├── packages/engine/
│   ├── package.json                      # @tengen/engine
│   ├── tsconfig.json
│   ├── vite.config.ts                    # root del bench, headers COOP/COEP
│   ├── vitest.config.ts
│   ├── bench.html                        # página del harness
│   ├── models/                           # .onnx descargados (gitignored)
│   ├── scripts/
│   │   ├── download-models.sh            # curl de los ONNX ya publicados
│   │   └── copy-ort-wasm.sh              # node_modules/onnxruntime-web/dist → public/wasm/
│   ├── public/wasm/                      # runtime de ORT (gitignored)
│   ├── src/bench/
│   │   ├── f16.ts                        # float32 → float16 (Uint16Array)
│   │   ├── stats.ts                      # mediana/p10/p90/inf-por-segundo
│   │   ├── emptyBoard.ts                 # featurización mínima de tablero vacío
│   │   ├── registry.ts                   # catálogo tipado de modelos (URL, bytes, dtype, inputs)
│   │   ├── runner.ts                     # sesión ORT + warmup + medición + sanity checks
│   │   └── main.ts                       # UI mínima: botones por modelo, tabla, export JSON
│   └── tests/
│       ├── f16.test.ts
│       ├── stats.test.ts
│       ├── emptyBoard.test.ts
│       └── registry.test.ts
└── docs/research/fase0/resultados.md     # salida final de la fase
```

`runner.ts`/`main.ts` tocan WebGPU y se validan manualmente en Chrome; todo lo demás lleva test unitario.

---

### Task 1: Scaffold del monorepo

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`, `packages/engine/tests/smoke.test.ts`

**Interfaces:**
- Produces: workspace `@tengen/engine` con `npm test` (Vitest) funcionando; `tsconfig.base.json` que los demás paquetes extienden.

- [ ] **Step 1: Crear los package.json y tsconfig**

`package.json` (raíz):
```json
{
  "name": "tengen",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "bench": "npm run bench -w @tengen/engine"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "types": []
  }
}
```

`packages/engine/package.json`:
```json
{
  "name": "@tengen/engine",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "bench": "bash scripts/copy-ort-wasm.sh && vite --open /bench.html"
  },
  "dependencies": {
    "onnxruntime-web": "^1.24.3"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2022", "DOM"] },
  "include": ["src", "tests"]
}
```

`packages/engine/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
})
```

- [ ] **Step 2: Test humo**

`packages/engine/tests/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest'

describe('workspace', () => {
  it('vitest corre', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 3: Instalar y verificar**

Run: `npm install && npm test`
Expected: `✓ tests/smoke.test.ts` — 1 passed.

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.base.json packages/engine
git commit -m "chore: scaffold monorepo npm workspaces con @tengen/engine"
```

---

### Task 2: Conversión float32 → float16 (`f16.ts`)

Los `.fp16.onnx` exigen tensores `float16`, que en ORT 1.24 se representan como `Uint16Array` (verificado en `js/common/lib/tensor.ts` de la rama rel-1.24.1).

**Files:**
- Create: `packages/engine/src/bench/f16.ts`
- Test: `packages/engine/tests/f16.test.ts`

**Interfaces:**
- Produces: `f32ToF16(src: Float32Array): Uint16Array` — conversión IEEE 754 half con redondeo al par, manejo de Inf/NaN/subnormales.

- [ ] **Step 1: Test que falla**

`packages/engine/tests/f16.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { f32ToF16 } from '../src/bench/f16'

describe('f32ToF16', () => {
  it('convierte valores exactos conocidos', () => {
    const out = f32ToF16(new Float32Array([0, 1, -1, 0.5, 2, -0.375]))
    expect(Array.from(out)).toEqual([0x0000, 0x3c00, 0xbc00, 0x3800, 0x4000, 0xb600])
  })
  it('satura a infinito por encima del máximo half (65504)', () => {
    const out = f32ToF16(new Float32Array([1e6, -1e6]))
    expect(out[0]).toBe(0x7c00)
    expect(out[1]).toBe(0xfc00)
  })
  it('propaga NaN', () => {
    const out = f32ToF16(new Float32Array([Number.NaN]))
    expect((out[0]! & 0x7c00) === 0x7c00 && (out[0]! & 0x03ff) !== 0).toBe(true)
  })
  it('redondea al representable más cercano', () => {
    // 1.0009765625 = 1 + 2^-10 es exacto en half; 1.0004 debe redondear a 1.0
    const out = f32ToF16(new Float32Array([1.0004]))
    expect(out[0]).toBe(0x3c00)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -w @tengen/engine`
Expected: FAIL — `Cannot find module '../src/bench/f16'`.

- [ ] **Step 3: Implementación**

`packages/engine/src/bench/f16.ts`:
```ts
/** Convierte float32 a float16 (IEEE 754 half) como Uint16Array — el formato
 *  que onnxruntime-web 1.24 usa para tensores 'float16'. */
export function f32ToF16(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length)
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  for (let i = 0; i < src.length; i++) {
    f32[0] = src[i]!
    const x = u32[0]!
    const sign = (x >>> 16) & 0x8000
    const exp = (x >>> 23) & 0xff
    const mant = x & 0x7fffff
    let half: number
    if (exp === 0xff) {
      half = sign | 0x7c00 | (mant ? 0x0200 : 0) // Inf / NaN
    } else {
      const e = exp - 127 + 15
      if (e >= 0x1f) {
        half = sign | 0x7c00 // overflow → Inf
      } else if (e <= 0) {
        if (e < -10) {
          half = sign // underflow → ±0
        } else {
          // subnormal: mantisa con bit implícito, desplazada, preservando sticky bits
          const shift = 1 - e
          const full = mant | 0x800000
          const m = (full >> shift) | ((full & ((1 << shift) - 1)) ? 1 : 0)
          half = sign | ((m + 0x0fff + ((m >> 13) & 1)) >> 13)
        }
      } else {
        // normal, con redondeo al par en el bit 13
        const rounded = mant + 0x0fff + ((mant >> 13) & 1)
        half = sign | (((e << 10) + (rounded >> 13)) | 0)
      }
    }
    out[i] = half
  }
  return out
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine`
Expected: PASS — 4 tests de f16.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/bench/f16.ts packages/engine/tests/f16.test.ts
git commit -m "feat(engine): conversión float32→float16 para tensores fp16 de ORT"
```

---

### Task 3: Estadísticas de medición (`stats.ts`)

**Files:**
- Create: `packages/engine/src/bench/stats.ts`
- Test: `packages/engine/tests/stats.test.ts`

**Interfaces:**
- Produces: `summarize(timingsMs: number[], batchSize: number): BenchStats` con
  `type BenchStats = { runs: number; batchSize: number; medianMs: number; p10Ms: number; p90Ms: number; infPerSec: number }`.
  `infPerSec` se calcula con la mediana: `batchSize / (medianMs / 1000)`.

- [ ] **Step 1: Test que falla**

`packages/engine/tests/stats.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { summarize } from '../src/bench/stats'

describe('summarize', () => {
  it('calcula mediana, percentiles e inf/s con batch 1', () => {
    const s = summarize([100, 110, 90, 105, 95], 1)
    expect(s.runs).toBe(5)
    expect(s.medianMs).toBe(100)
    // percentiles con interpolación lineal: idx p10 = 0.4 → 90+0.4·5; idx p90 = 3.6 → 105+0.6·5
    expect(s.p10Ms).toBeCloseTo(92, 6)
    expect(s.p90Ms).toBeCloseTo(108, 6)
    expect(s.infPerSec).toBeCloseTo(10, 5)
  })
  it('escala inf/s por el batch', () => {
    const s = summarize([200, 200, 200], 8)
    expect(s.infPerSec).toBeCloseTo(40, 5)
  })
  it('mediana de cantidad par promedia los centrales', () => {
    const s = summarize([10, 20, 30, 40], 1)
    expect(s.medianMs).toBe(25)
  })
  it('rechaza entradas vacías', () => {
    expect(() => summarize([], 1)).toThrow()
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -w @tengen/engine`
Expected: FAIL — `Cannot find module '../src/bench/stats'`.

- [ ] **Step 3: Implementación**

`packages/engine/src/bench/stats.ts`:
```ts
export type BenchStats = {
  runs: number
  batchSize: number
  medianMs: number
  p10Ms: number
  p90Ms: number
  infPerSec: number
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const a = sorted[lo]!
  const b = sorted[hi]!
  return a + (b - a) * (idx - lo)
}

export function summarize(timingsMs: number[], batchSize: number): BenchStats {
  if (timingsMs.length === 0) throw new Error('summarize: sin mediciones')
  const sorted = [...timingsMs].sort((a, b) => a - b)
  const medianMs = percentile(sorted, 0.5)
  return {
    runs: timingsMs.length,
    batchSize,
    medianMs,
    p10Ms: percentile(sorted, 0.1),
    p90Ms: percentile(sorted, 0.9),
    infPerSec: batchSize / (medianMs / 1000),
  }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine`
Expected: PASS — stats + f16 + smoke.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/bench/stats.ts packages/engine/tests/stats.test.ts
git commit -m "feat(engine): estadísticas de benchmark (mediana/p10/p90/inf-s)"
```

---

### Task 4: Featurización mínima de tablero vacío (`emptyBoard.ts`)

Para MEDIR velocidad basta una posición válida. Tablero vacío según el esquema de features verificado (`docs/research/fase0/contrato-io.md`): plano 0 = 1.0 en todo punto del tablero, planos 1-21 = 0; `global[5] = -pla * komi / 20` (pla: Negro=1), resto 0. Layout NCHW C-order: plano `p`, fila `y`, col `x` → índice `p*N*N + y*N + x`.

**Files:**
- Create: `packages/engine/src/bench/emptyBoard.ts`
- Test: `packages/engine/tests/emptyBoard.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `emptyBoardInputs(size: number, komi: number, batch: number): { bin: Float32Array; global: Float32Array }` — `bin.length === batch*22*size*size`, `global.length === batch*19`, todas las posiciones del batch idénticas.

- [ ] **Step 1: Test que falla**

`packages/engine/tests/emptyBoard.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { emptyBoardInputs } from '../src/bench/emptyBoard'

describe('emptyBoardInputs', () => {
  it('dimensiones correctas para 19x19 batch 1', () => {
    const { bin, global } = emptyBoardInputs(19, 7.5, 1)
    expect(bin.length).toBe(22 * 19 * 19)
    expect(global.length).toBe(19)
  })
  it('plano 0 todo unos, planos 1-21 todo ceros', () => {
    const { bin } = emptyBoardInputs(9, 7.5, 1)
    const plane = 9 * 9
    expect(bin.slice(0, plane).every((v) => v === 1)).toBe(true)
    expect(bin.slice(plane).every((v) => v === 0)).toBe(true)
  })
  it('global[5] = -komi/20 (Negro al turno), resto ceros', () => {
    const { global } = emptyBoardInputs(19, 7.5, 1)
    expect(global[5]).toBeCloseTo(-0.375, 6)
    global.forEach((v, i) => {
      if (i !== 5) expect(v).toBe(0)
    })
  })
  it('batch N replica la posición', () => {
    const one = emptyBoardInputs(19, 7.5, 1)
    const eight = emptyBoardInputs(19, 7.5, 8)
    expect(eight.bin.length).toBe(8 * one.bin.length)
    expect(eight.global.length).toBe(8 * 19)
    expect(Array.from(eight.bin.slice(7 * one.bin.length))).toEqual(Array.from(one.bin))
    expect(eight.global[7 * 19 + 5]).toBeCloseTo(-0.375, 6)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -w @tengen/engine`
Expected: FAIL — `Cannot find module '../src/bench/emptyBoard'`.

- [ ] **Step 3: Implementación**

`packages/engine/src/bench/emptyBoard.ts`:
```ts
/** Posición de tablero vacío en el esquema de inputs de los ONNX de KataGo
 *  (bin_input [batch,22,N,N], global_input [batch,19]). Suficiente para
 *  benchmark; la featurización completa llega con el engine real. */
export function emptyBoardInputs(
  size: number,
  komi: number,
  batch: number,
): { bin: Float32Array; global: Float32Array } {
  const planeLen = size * size
  const perPosBin = 22 * planeLen
  const bin = new Float32Array(batch * perPosBin)
  const global = new Float32Array(batch * 19)
  for (let b = 0; b < batch; b++) {
    bin.fill(1, b * perPosBin, b * perPosBin + planeLen) // plano 0: máscara del tablero
    global[b * 19 + 5] = (-1 * komi) / 20 // selfKomi/20, Negro al turno (pla=1)
  }
  return { bin, global }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/bench/emptyBoard.ts packages/engine/tests/emptyBoard.test.ts
git commit -m "feat(engine): featurización mínima de tablero vacío para el bench"
```

---

### Task 5: Catálogo de modelos + script de descarga

URLs y bytes verificados (2026-07-08) en `docs/research/fase0/inventario-onnx.md`.

**Files:**
- Create: `packages/engine/src/bench/registry.ts`, `packages/engine/scripts/download-models.sh`
- Test: `packages/engine/tests/registry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ModelSpec = {
    id: string            // nombre de archivo local en models/
    url: string
    bytes: number         // content-length verificado; 0 = pendiente (conversión propia)
    dtype: 'float32' | 'float16'
    inputNames: { bin: string; global: string; meta?: string } | 'introspect'
    notes: string
  }
  export const MODELS: ModelSpec[]
  ```
- `download-models.sh` descarga a `packages/engine/models/` solo los de `bytes > 0` y valida el tamaño.

- [ ] **Step 1: Test que falla**

`packages/engine/tests/registry.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MODELS } from '../src/bench/registry'

describe('MODELS', () => {
  it('ids únicos y con extensión .onnx', () => {
    const ids = MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.endsWith('.onnx')).toBe(true)
  })
  it('URLs https válidas en los descargables', () => {
    for (const m of MODELS.filter((m) => m.bytes > 0)) {
      expect(m.url.startsWith('https://')).toBe(true)
    }
  })
  it('los .fp16 declaran dtype float16', () => {
    for (const m of MODELS) {
      if (m.id.includes('fp16')) expect(m.dtype).toBe('float16')
    }
  })
  it('incluye el control b28 de kaya y el b18 de WeiqiPlayground', () => {
    expect(MODELS.some((m) => m.id.includes('b28c512nbt') && m.dtype === 'float16')).toBe(true)
    expect(MODELS.some((m) => m.id === 'b18c384-weiqiplayground.fp32.onnx')).toBe(true)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -w @tengen/engine`
Expected: FAIL — `Cannot find module '../src/bench/registry'`.

- [ ] **Step 3: Implementación**

`packages/engine/src/bench/registry.ts`:
```ts
export type ModelSpec = {
  id: string
  url: string
  bytes: number
  dtype: 'float32' | 'float16'
  inputNames: { bin: string; global: string; meta?: string } | 'introspect'
  notes: string
}

const KAYA = 'https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-s12043015936-d5616446734'

/** Catálogo de la fase 0. bytes verificados el 2026-07-08
 *  (docs/research/fase0/inventario-onnx.md). bytes=0 → se genera con
 *  la conversión local (Task 7/8) y no lo toca download-models.sh. */
export const MODELS: ModelSpec[] = [
  {
    id: 'b28c512nbt-kaya.fp16.onnx',
    url: `${KAYA}/kata1-b28c512nbt-s12043015936-d5616446734.fp16.onnx`,
    bytes: 146963282,
    dtype: 'float16',
    inputNames: { bin: 'bin_input', global: 'global_input' },
    notes: 'control: el modelo que kaya usa en producción (MIT); I/O float16',
  },
  {
    id: 'b28c512nbt-kaya.fp32.onnx',
    url: `${KAYA}/kata1-b28c512nbt-s12043015936-d5616446734.fp32.onnx`,
    bytes: 293099607,
    dtype: 'float32',
    inputNames: { bin: 'bin_input', global: 'global_input' },
    notes: 'control fp32 (para GPUs sin shader-f16)',
  },
  {
    id: 'b18c384-weiqiplayground.fp32.onnx',
    url: 'https://huggingface.co/WeiqiPlayground/b18c384/resolve/main/model.onnx',
    bytes: 118065568,
    dtype: 'float32',
    inputNames: { bin: 'bin_inputs', global: 'global_inputs' },
    notes: 'b18 fp32 de terceros; checkpoint sin documentar — solo para velocidad (misma arquitectura)',
  },
  {
    id: 'b18c384nbt-humanv0-misopa.uint8.onnx',
    url: 'https://huggingface.co/Misopa/baduk-human-sl/resolve/main/b18c384nbt-humanv0.uint8.onnx',
    bytes: 28418918,
    dtype: 'float32',
    inputNames: 'introspect',
    notes: 'Human SL uint8 de terceros, sin model card; inputs desconocidos → introspección',
  },
  {
    id: 'b18c384nbt-kata1.fp16.onnx',
    url: '',
    bytes: 0,
    dtype: 'float16',
    inputNames: { bin: 'bin_input', global: 'global_input' },
    notes: 'conversión propia con katago-onnx (Task 7) desde kata1-b18c384nbt-s9996604416',
  },
  {
    id: 'b18c384nbt-humanv0.fp16.onnx',
    url: '',
    bytes: 0,
    dtype: 'float16',
    inputNames: { bin: 'bin_input', global: 'global_input', meta: 'meta_input' },
    notes: 'conversión propia parcheada (Task 8); tercer input meta [1,192]',
  },
]
```

`packages/engine/scripts/download-models.sh`:
```bash
#!/usr/bin/env bash
# Descarga los ONNX publicados a packages/engine/models/ y valida bytes.
# Los de conversión propia (bytes=0 en registry.ts) no se tocan aquí.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models

download() { # id url bytes
  local id="$1" url="$2" bytes="$3"
  if [[ -f "models/$id" && "$(stat -f%z "models/$id")" == "$bytes" ]]; then
    echo "OK  $id (ya descargado)"
    return
  fi
  echo "GET $id"
  curl -fL --retry 3 -o "models/$id.part" "$url"
  local got
  got="$(stat -f%z "models/$id.part")"
  if [[ "$got" != "$bytes" ]]; then
    echo "ERROR: $id esperaba $bytes bytes, llegó $got" >&2
    exit 1
  fi
  mv "models/$id.part" "models/$id"
}

download b28c512nbt-kaya.fp16.onnx \
  "https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-s12043015936-d5616446734/kata1-b28c512nbt-s12043015936-d5616446734.fp16.onnx" 146963282
download b28c512nbt-kaya.fp32.onnx \
  "https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-s12043015936-d5616446734/kata1-b28c512nbt-s12043015936-d5616446734.fp32.onnx" 293099607
download b18c384-weiqiplayground.fp32.onnx \
  "https://huggingface.co/WeiqiPlayground/b18c384/resolve/main/model.onnx" 118065568
download b18c384nbt-humanv0-misopa.uint8.onnx \
  "https://huggingface.co/Misopa/baduk-human-sl/resolve/main/b18c384nbt-humanv0.uint8.onnx" 28418918
echo "Modelos listos en packages/engine/models/"
```

- [ ] **Step 4: Verificar tests y descarga**

Run: `npm test -w @tengen/engine && chmod +x packages/engine/scripts/download-models.sh && packages/engine/scripts/download-models.sh`
Expected: tests PASS; descarga de 4 archivos (~580 MB total) terminando en `Modelos listos`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/bench/registry.ts packages/engine/tests/registry.test.ts packages/engine/scripts/download-models.sh
git commit -m "feat(engine): catálogo de modelos ONNX y script de descarga verificada"
```

---

### Task 6: Harness de benchmark en Chrome (`runner.ts`, `main.ts`, `bench.html`)

**Files:**
- Create: `packages/engine/src/bench/runner.ts`, `packages/engine/src/bench/main.ts`, `packages/engine/bench.html`, `packages/engine/vite.config.ts`, `packages/engine/scripts/copy-ort-wasm.sh`
- Modify: `.gitignore` (añadir `packages/engine/public/wasm/`)

**Interfaces:**
- Consumes: `MODELS` (Task 5), `emptyBoardInputs` (Task 4), `f32ToF16` (Task 2), `summarize` (Task 3).
- Produces: `runBench(model: ModelSpec, opts: { ep: 'webgpu' | 'wasm'; batch: number; warmup: number; runs: number; size: number }): Promise<BenchResult>` con
  `type BenchResult = { model: string; ep: string; batch: number; stats: BenchStats; sanity: string[]; adapter: string }`.
  La UI corre la matriz {modelos descargados} × {webgpu, wasm} × {batch 1, 8} y exporta JSON.

- [ ] **Step 1: Script de runtime WASM de ORT**

`packages/engine/scripts/copy-ort-wasm.sh`:
```bash
#!/usr/bin/env bash
# ORT-web necesita servir sus .wasm/.mjs desde la MISMA versión que el bundle JS.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/wasm
cp node_modules/onnxruntime-web/dist/*.wasm node_modules/onnxruntime-web/dist/*.mjs public/wasm/
echo "runtime ORT copiado a public/wasm/"
```

Y añadir a `.gitignore` (raíz):
```
packages/engine/public/wasm/
```

- [ ] **Step 2: Config de Vite con COOP/COEP**

`packages/engine/vite.config.ts`:
```ts
import { defineConfig } from 'vite'

// COOP/COEP habilitan crossOriginIsolated → WASM multihilo medible.
// WebGPU no los necesita, pero no le estorban.
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})
```

`packages/engine/bench.html`:
```html
<!doctype html>
<meta charset="utf-8" />
<title>tengen · bench fase 0</title>
<style>
  body { font: 14px/1.4 system-ui; margin: 2rem; max-width: 72rem; }
  table { border-collapse: collapse; margin-top: 1rem; }
  td, th { border: 1px solid #ccc; padding: 4px 10px; text-align: right; }
  td:first-child, th:first-child { text-align: left; }
  #log { white-space: pre-wrap; color: #666; margin-top: 1rem; }
</style>
<h1>tengen — benchmark fase 0</h1>
<p id="env"></p>
<button id="run">Correr matriz completa</button>
<button id="export" disabled>Exportar JSON</button>
<table id="results">
  <thead><tr><th>modelo</th><th>EP</th><th>batch</th><th>mediana ms</th><th>p10</th><th>p90</th><th>inf/s</th><th>sanity</th></tr></thead>
  <tbody></tbody>
</table>
<div id="log"></div>
<script type="module" src="/src/bench/main.ts"></script>
```

- [ ] **Step 3: Runner**

`packages/engine/src/bench/runner.ts`:
```ts
import * as ort from 'onnxruntime-web'
import { emptyBoardInputs } from './emptyBoard'
import { f32ToF16 } from './f16'
import type { ModelSpec } from './registry'
import { summarize, type BenchStats } from './stats'

export type BenchResult = {
  model: string
  ep: 'webgpu' | 'wasm'
  batch: number
  stats: BenchStats
  sanity: string[]
  adapter: string
}

let ortConfigured = false
async function configureOrt(): Promise<string> {
  const adapter = 'gpu' in navigator
    ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    : null
  if (!ortConfigured) {
    ort.env.wasm.wasmPaths = '/wasm/'
    ort.env.wasm.simd = true
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.min(8, navigator.hardwareConcurrency || 4)
      : 1
    if (adapter) ort.env.webgpu.adapter = adapter
    ortConfigured = true
  }
  const info = adapter?.info
  return info ? `${info.vendor} ${info.architecture} (f16: ${adapter!.features.has('shader-f16')})` : 'sin WebGPU'
}

function buildFeeds(model: ModelSpec, session: ort.InferenceSession, batch: number, size: number) {
  const { bin, global } = emptyBoardInputs(size, 7.5, batch)
  const names =
    model.inputNames === 'introspect'
      ? {
          bin: session.inputNames.find((n) => n.includes('bin'))!,
          global: session.inputNames.find((n) => n.includes('global'))!,
          meta: session.inputNames.find((n) => n.includes('meta')),
        }
      : model.inputNames
  const feeds: Record<string, ort.Tensor> = {}
  if (model.dtype === 'float16') {
    feeds[names.bin] = new ort.Tensor('float16', f32ToF16(bin), [batch, 22, size, size])
    feeds[names.global] = new ort.Tensor('float16', f32ToF16(global), [batch, 19])
    if (names.meta) feeds[names.meta] = new ort.Tensor('float16', f32ToF16(new Float32Array(batch * 192)), [batch, 192])
  } else {
    feeds[names.bin] = new ort.Tensor('float32', bin, [batch, 22, size, size])
    feeds[names.global] = new ort.Tensor('float32', global, [batch, 19])
    if (names.meta) feeds[names.meta] = new ort.Tensor('float32', new Float32Array(batch * 192), [batch, 192])
  }
  return feeds
}

function sanityCheck(model: ModelSpec, out: ort.InferenceSession.OnnxValueMapType, size: number): string[] {
  const issues: string[] = []
  const outNames = Object.keys(out)
  const policyName = outNames.find((n) => n.includes('policy'))
  const valueName = outNames.find((n) => n.includes('value') && !n.includes('misc'))
  if (!policyName || !valueName) {
    issues.push(`salidas inesperadas: ${outNames.join(',')}`)
    return issues
  }
  const policy = out[policyName]!.data as Float32Array | Uint16Array
  const value = out[valueName]!.data as Float32Array | Uint16Array
  const finite = (v: number) => Number.isFinite(v)
  // fp16 llega como Uint16Array: solo comprobamos que no sea todo ceros
  if (policy instanceof Uint16Array) {
    if (policy.every((v) => v === 0)) issues.push('policy todo ceros (fp16)')
  } else {
    const head0 = policy.slice(0, size * size + 1)
    if (![...head0].every(finite)) issues.push('policy con NaN/Inf')
    const passIdx = size * size
    const argmax = [...head0].reduce((best, v, i) => (v > head0[best]! ? i : best), 0)
    if (argmax === passIdx) issues.push('argmax=PASS en tablero vacío (sospechoso)')
  }
  if (value instanceof Float32Array && ![...value.slice(0, 3)].every(finite)) issues.push('value con NaN/Inf')
  return issues
}

export async function runBench(
  model: ModelSpec,
  opts: { ep: 'webgpu' | 'wasm'; batch: number; warmup: number; runs: number; size: number },
): Promise<BenchResult> {
  const adapter = await configureOrt()
  const session = await ort.InferenceSession.create(`/models/${model.id}`, {
    executionProviders: [opts.ep],
    graphOptimizationLevel: 'all',
  })
  const feeds = buildFeeds(model, session, opts.batch, opts.size)
  let sanity: string[] = []
  for (let i = 0; i < opts.warmup; i++) {
    const out = await session.run(feeds)
    if (i === 0) sanity = sanityCheck(model, out, opts.size)
  }
  const timings: number[] = []
  for (let i = 0; i < opts.runs; i++) {
    const t0 = performance.now()
    await session.run(feeds)
    timings.push(performance.now() - t0)
  }
  await session.release()
  return { model: model.id, ep: opts.ep, batch: opts.batch, stats: summarize(timings, opts.batch), sanity, adapter }
}
```

Nota: los modelos se sirven en dev vía `/models/` — añadir a `vite.config.ts` dentro de `defineConfig({...})`:
```ts
  publicDir: 'public',
  // models/ pesa cientos de MB: se sirve como estático adicional
  plugins: [
    {
      name: 'serve-models',
      configureServer(server) {
        server.middlewares.use('/models', (req, res, next) => {
          const fs = require('node:fs')
          const path = require('node:path')
          const file = path.join(__dirname, 'models', decodeURIComponent(req.url!.replace(/^\//, '')))
          if (!fs.existsSync(file)) return next()
          res.setHeader('Content-Type', 'application/octet-stream')
          fs.createReadStream(file).pipe(res)
        })
      },
    },
  ],
```
(Si `require` molesta en ESM, usar `import fs from 'node:fs'` e `import path from 'node:path'` arriba del config — Vite config corre en Node.)

- [ ] **Step 4: UI mínima**

`packages/engine/src/bench/main.ts`:
```ts
import { MODELS } from './registry'
import { runBench, type BenchResult } from './runner'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T
const log = (msg: string) => (($('#log').textContent ??= ''), ($('#log').textContent += msg + '\n'))
const results: BenchResult[] = []

async function available(): Promise<typeof MODELS> {
  const out: typeof MODELS = []
  for (const m of MODELS) {
    const res = await fetch(`/models/${m.id}`, { method: 'HEAD' }).catch(() => null)
    if (res?.ok) out.push(m)
    else log(`(saltando ${m.id}: no está en models/)`)
  }
  return out
}

function render(r: BenchResult) {
  const row = document.createElement('tr')
  const s = r.stats
  row.innerHTML =
    `<td>${r.model}</td><td>${r.ep}</td><td>${s.batchSize}</td>` +
    `<td>${s.medianMs.toFixed(1)}</td><td>${s.p10Ms.toFixed(1)}</td><td>${s.p90Ms.toFixed(1)}</td>` +
    `<td><b>${s.infPerSec.toFixed(2)}</b></td><td>${r.sanity.join('; ') || 'ok'}</td>`
  $('#results tbody').appendChild(row)
}

$('#env').textContent = `crossOriginIsolated=${self.crossOriginIsolated} · threads=${navigator.hardwareConcurrency} · UA=${navigator.userAgent}`

$('#run').addEventListener('click', async () => {
  ;($('#run') as HTMLButtonElement).disabled = true
  const models = await available()
  for (const model of models) {
    for (const ep of ['webgpu', 'wasm'] as const) {
      if (ep === 'webgpu' && !('gpu' in navigator)) continue
      for (const batch of [1, 8]) {
        log(`corriendo ${model.id} · ${ep} · batch ${batch}…`)
        try {
          const r = await runBench(model, { ep, batch, warmup: 5, runs: 30, size: 19 })
          results.push(r)
          render(r)
        } catch (e) {
          log(`  ERROR: ${(e as Error).message}`)
        }
      }
    }
  }
  ;($('#export') as HTMLButtonElement).disabled = false
  log(`listo: ${results.length} mediciones · adapter: ${results[0]?.adapter ?? '?'}`)
})

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ ua: navigator.userAgent, results }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'fase0-resultados.json'
  a.click()
})
```

- [ ] **Step 5: Verificación tipos + arranque**

Run: `npm test -w @tengen/engine && npx -w @tengen/engine tsc --noEmit && chmod +x packages/engine/scripts/copy-ort-wasm.sh && npm run bench`
Expected: tests PASS, tsc sin errores, Chrome abre `bench.html` mostrando `crossOriginIsolated=true`.

- [ ] **Step 6: Medición manual en Chrome**

En la página: click "Correr matriz completa". Expected: tabla con ~16 filas (4 modelos × 2 EPs × 2 batches), columna inf/s poblada, sanity "ok" en b28/b18 fp32 (en fp16 se acepta el check reducido; en humanv0-misopa cualquier resultado es informativo). Exportar JSON y guardarlo en `docs/research/fase0/` (ver Task 9).

Si WebGPU falla con modelos fp16: verificar en el log que el adapter reporta `f16: true`; si es `false`, es la limitación shader-f16 documentada — registrar y seguir con fp32.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/bench/runner.ts packages/engine/src/bench/main.ts packages/engine/bench.html packages/engine/vite.config.ts packages/engine/scripts/copy-ort-wasm.sh .gitignore
git commit -m "feat(engine): harness de benchmark WebGPU/WASM con matriz de modelos"
```

---

### Task 7: Conversión propia de b18c384nbt (fp16 + fp32)

El b18 de WeiqiPlayground sirve para velocidad pero no tiene fp16 ni checkpoint documentado. Generamos el nuestro con el conversor de kaya (AGPL — **herramienta local, no se vendoriza al repo**). Comandos verificados en `docs/research/fase0/pipeline-conversion.md`.

**Files:**
- Create: ninguno en el repo (artefactos van a `packages/engine/models/`, gitignored)
- Modify: `packages/engine/src/bench/registry.ts` (rellenar `bytes` del modelo convertido)

**Interfaces:**
- Consumes: registry Task 5.
- Produces: `models/b18c384nbt-kata1.fp16.onnx` y `.fp32.onnx` locales; entrada de registry con bytes reales.

- [ ] **Step 1: Instalar pixi y el conversor (fuera del repo)**

```bash
which pixi || brew install pixi
git clone https://github.com/kaya-go/katago-onnx.git ~/dev/vendor/katago-onnx
cd ~/dev/vendor/katago-onnx && pixi install
```
Expected: `pixi install` termina sin errores (Python 3.13 + PyTorch por conda-forge, soporta osx-arm64).

- [ ] **Step 2: Convertir**

```bash
cd ~/dev/vendor/katago-onnx
pixi run katago-onnx convert ./artifacts/ -n kata1-b18c384nbt-s9996604416-d4316597426
```
Expected: descarga el zip (214.501.963 bytes) de media.katagotraining.org y genera en `./artifacts/kata1-b18c384nbt-s9996604416-d4316597426/` los tres archivos `.fp32.onnx`, `.fp16.onnx`, `.uint8.onnx`.

- [ ] **Step 3: Copiar al proyecto y registrar bytes**

```bash
cp ~/dev/vendor/katago-onnx/artifacts/kata1-b18c384nbt-s9996604416-d4316597426/kata1-b18c384nbt-s9996604416-d4316597426.fp16.onnx \
   /Users/kntor/dev/tengen/packages/engine/models/b18c384nbt-kata1.fp16.onnx
cp ~/dev/vendor/katago-onnx/artifacts/kata1-b18c384nbt-s9996604416-d4316597426/kata1-b18c384nbt-s9996604416-d4316597426.fp32.onnx \
   /Users/kntor/dev/tengen/packages/engine/models/b18c384nbt-kata1.fp32.onnx
stat -f%z /Users/kntor/dev/tengen/packages/engine/models/b18c384nbt-kata1.*.onnx
```

En `registry.ts`, actualizar la entrada `b18c384nbt-kata1.fp16.onnx` con los bytes reales y añadir la fp32 equivalente (mismo formato que las entradas kaya, `inputNames: { bin: 'bin_input', global: 'global_input' }`, bytes del `stat`).

- [ ] **Step 4: Re-medir**

Run: `npm run bench` → click "Correr matriz completa".
Expected: aparecen las filas de `b18c384nbt-kata1.fp16/.fp32`; sanity "ok" en fp32. **Este es EL número del gate: inf/s de b18 fp16/fp32 en webgpu.**

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/bench/registry.ts
git commit -m "feat(engine): b18c384nbt convertido a ONNX registrado en el bench"
```

---

### Task 8: Conversión de Human SL (b18-humanv0) con parche meta_input

El conversor falla con redes HumanSL tal cual (su `forward` exige `input_meta`); el parche está documentado y listo en `docs/research/fase0/pipeline-conversion.md` (snippet B, no ejecutado end-to-end — riesgo conocido).

**Files:**
- Create: `packages/engine/scripts/convert-humanv0.py` (el snippet B del research, para reproducibilidad)
- Modify: `packages/engine/src/bench/registry.ts` (bytes del humanv0 convertido)

**Interfaces:**
- Consumes: clone de katago-onnx de Task 7.
- Produces: `models/b18c384nbt-humanv0.fp16.onnx` con inputs `bin_input`, `global_input`, `meta_input` [1,192].

- [ ] **Step 1: Copiar el script del research al repo**

Crear `packages/engine/scripts/convert-humanv0.py` con el contenido EXACTO del "SNIPPET B" de `docs/research/fase0/pipeline-conversion.md` (líneas del heredoc `pixi run python - <<'EOF' ... EOF`, sin el wrapper de shell).

- [ ] **Step 2: Descargar checkpoint y convertir**

```bash
cd ~/dev/vendor/katago-onnx && mkdir -p artifacts
curl -fL --retry 3 -o artifacts/b18c384nbt-humanv0.ckpt \
  https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.ckpt
stat -f%z artifacts/b18c384nbt-humanv0.ckpt   # esperado: 323752318
pixi run python /Users/kntor/dev/tengen/packages/engine/scripts/convert-humanv0.py
```
Expected: genera `artifacts/b18c384nbt-humanv0.fp32.onnx` y `.fp16.onnx`. Si `torch.onnx.export` falla por shapes del policy head de v15, registrar el error en `docs/research/fase0/resultados.md` y seguir sin humanv0 (el gate de la fase no depende de él; se retoma en la fase engine).

- [ ] **Step 3: Copiar, registrar y re-medir**

```bash
cp ~/dev/vendor/katago-onnx/artifacts/b18c384nbt-humanv0.fp16.onnx \
   /Users/kntor/dev/tengen/packages/engine/models/b18c384nbt-humanv0.fp16.onnx
```
Actualizar bytes en `registry.ts`; `npm run bench` de nuevo. Expected: fila humanv0 fp16 con inf/s (velocidad ≈ b18 normal: misma arquitectura + meta encoder).

- [ ] **Step 4: Commit**

```bash
git add packages/engine/scripts/convert-humanv0.py packages/engine/src/bench/registry.ts
git commit -m "feat(engine): conversión Human SL con meta_input y registro en bench"
```

---

### Task 9: Resultados, licencia de pesos y decisión del gate

**Files:**
- Create: `docs/research/fase0/resultados.md` (+ el JSON exportado del bench)
- Modify: `docs/superpowers/specs/2026-07-08-tengen-design.md` (solo si el gate obliga al plan B)

**Interfaces:**
- Consumes: JSON exportado por el harness (Task 6-8).
- Produces: decisión documentada de red principal para la fase engine.

- [ ] **Step 1: Verificar licencia de los pesos de KataGo**

Antes de planear servir redes desde nuestro R2: consultar https://katagotraining.org/ (footer/FAQ de licencia de las redes) y el LICENSE de lightvector/KataGo para confirmar los términos de redistribución de `.bin.gz`/conversiones (las redes kata1 se publican bajo licencia propia del sitio — dejar cita textual y URL en `resultados.md`). Si la redistribución fuera problemática: opción documentada = descargar en el cliente directamente desde HF de kaya (MIT) o desde katagotraining con atribución.

- [ ] **Step 2: Escribir resultados**

`docs/research/fase0/resultados.md` con: fecha, hardware (chip, RAM, Chrome version, adapter reportado), la tabla completa del bench (pegar del JSON), y la sección "Decisión del gate":
- b18 fp16 webgpu ≥ 2 inf/s → **b18 confirmada como red principal** (spec queda como está).
- b18 < 2 inf/s → plan B de la spec: editar la sección "Redes neuronales" de la spec para promover b10/b15 (requiere resolver conversión b10 — vía tf2onnx, documentada como pendiente en `pipeline-conversion.md`).
- Registrar también: inf/s de b28 (¿el control rinde parecido a lo que kaya reporta?), humanv0, y el ratio webgpu/wasm.

- [ ] **Step 3: Commit final de fase**

```bash
git add docs/research/fase0/
git commit -m "docs(fase0): resultados del benchmark WebGPU y decisión de red principal"
```

---

## Self-review (hecho al escribir)

1. **Cobertura de spec (alcance fase 0):** benchmark WebGPU real ✓, `npm run bench` permanente ✓, gate b18/plan B documentado ✓, monorepo base ✓, verificación de licencia de pesos (pendiente de la spec, pregunta abierta 2) ✓. La conversión b10 queda explícitamente diferida al resultado del gate — no es gap, es decisión.
2. **Placeholders:** ninguno — todos los pasos llevan código/comandos completos; los dos riesgos conocidos (humanv0 export, fp16 sanity reducido) tienen ruta de fallo definida.
3. **Consistencia de tipos:** `BenchStats` (Task 3) se consume en `runner.ts` (Task 6) con los mismos campos; `ModelSpec.inputNames` con `'introspect'` está manejado en `buildFeeds`; `f32ToF16` firma idéntica en Task 2 y Task 6.
