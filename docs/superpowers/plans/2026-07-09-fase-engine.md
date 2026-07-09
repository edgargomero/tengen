# Fase engine: encoding V7 + MCTS + Web Worker (adaptando web-katrain) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el motor client-side de tengen (interfaz `Engine` sobre un Web Worker) reutilizando el encoding V7 y el MCTS ya portados a TypeScript por web-katrain (MIT), reemplazando su runner TensorFlow.js por onnxruntime-web y añadiendo Human SL (`meta_input`), todo verificado contra KataGo de escritorio.

**Architecture:** Se **adapta** web-katrain (no se reimplementa): se vendorizan sus módulos algorítmicos con atribución MIT (`fastBoard.ts` = board + escaleras + Benson; `analyzeMcts.ts` = MCTS PUCT; `evalV8.ts`/`scoreValue.ts` = postproceso), se forkea su encoder a NCHW (`featuresV7.ts`), y se sustituye **solo** su costura neuronal TF.js por un `NNEvaluator` de onnxruntime-web. Lo genuinamente nuevo de tengen es el evaluador ONNX, el `meta_input[192]` de Human SL, la interfaz `Engine`, el protocolo del Web Worker y la caché OPFS. Todo el encoding y el value/score se validan contra vectores `kata-raw-nn` generados con KataGo 1.16.5.

**Tech Stack:** TypeScript (ESM, strict + noUncheckedIndexedAccess), npm workspaces, Vitest (lógica en Node), onnxruntime-web ^1.24.3 (wasm EP en Node para tests de red; WebGPU EP en browser para producción), Vite (dev/bench), `@sabaki/go-board` (oráculo de reglas en tests), KataGo 1.16.5 (`brew`, generación de fixtures). Base verificada: `docs/research/fase-engine/fuentes.md` + `docs/research/fase-engine/decisiones-adaptacion.md`.

## Global Constraints

- **Licencias.** web-katrain (commit `7a0a487`, en `~/dev/vendor/web-katrain`) es **MIT: adaptable CON atribución** — cada archivo vendorizado lleva cabecera de origen + entrada en `packages/engine/THIRD-PARTY-LICENSES`. **Kaya (kaya-go/kaya) es AGPL-3.0: prohibido copiar una sola línea.** `scripts/convert-humanv0.py` es AGPL (uso local, ya marcado).
- **Adaptabilidad upstream + reanudable por LLM (obligatorio).** El proyecto debe quedar escrito para que un LLM pueda retomarlo y re-aplicar nuestras adaptaciones cuando salga una release nueva de web-katrain/KataGo. Concretamente: (a) toda tarea que vendorice o adapte un archivo de terceros **añade/actualiza su fila en `docs/research/fase-engine/adaptaciones-upstream.md`** (origen exacto, commit fijado, cambios de tengen, notas de re-sync) en el mismo commit; (b) cada archivo vendorizado lleva la cabecera con el formato de abajo, apuntando a ese log; (c) los cambios sobre upstream se mantienen **mínimos y localizados** (no reformatear ni reordenar el archivo original); (d) el estado de ejecución vive en el ledger `.superpowers/sdd/progress.md`. Formato de cabecera de todo archivo vendorizado:
  ```ts
  /*
   * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
   * Origen: src/engine/katago/<archivo>. Licencia completa en packages/engine/THIRD-PARTY-LICENSES.
   * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
   */
  ```
- **Modelos nunca en git** (`.gitignore` bloquea `*.onnx`/`*.bin.gz`); viven en `packages/engine/models/` (gitignored). Fixtures de referencia (`tests/fixtures/**`) SÍ se commitean (son JSON pequeños derivados, no pesos).
- **No romper el bench.** `npm run bench` debe seguir funcionando; el nuevo código va en `src/` como hermano de `src/bench/`. **No cambiar la versión de onnxruntime-web** (^1.24.3) sin re-medir la fase 0.
- **tsconfig:** `strict`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`, `target/lib ES2022 + DOM`, `types: []` (sin `@types/node`/`@webgpu/types` globales; tipos GPU inline como en el bench). `npx -w @tengen/engine tsc --noEmit` verde siempre.
- **Perspectivas.** Las utilidades internas del search están en **perspectiva de Blanco** (convención KataGo); `postprocessKataGoV8` convierte a **perspectiva de Negro**; la **API pública `Engine` está en perspectiva de Negro** (winrate, lead > 0 = Negro adelante).
- **Reglas v1** = chinas y japonesas de KataGo (ambas `KO_SIMPLE`, sin encore). Chinas: area scoring, plano 6 = solo `ko_loc`, planos 18/19 (Benson) y onda de komi `global[18]` activos, `whiteHandicapBonus=+N`. Japonesas: territory, `global[9]=1`+`global[10]=1`, planos 18/19 = 0.
- **Policy = head-0 pura, `policyOptimism=0`.** Partir `policy[b,6,H·W+1]` en cabeza 0 + pase (índice `H·W`); descartar cabezas 1–5; podar la ruta de optimism-mix del port.
- **Encoder en NCHW** (`c*H*W + y*W + x`), no NHWC.
- **Board-size-parametrizado; un Worker por tamaño.** El Worker fija `setBoardSize(N)` en `init()` y no lo cambia; la app recrea el Worker al cambiar de tamaño. **Prohibido** dos tamaños intercalados o dos búsquedas concurrentes en un Worker (scratch module-global no reentrante: una búsqueda a la vez, sin `await` entre `playMove` y la lectura de resultados).
- **Idioma:** documentación/commits en español; identificadores en inglés.

## File Structure

```
packages/engine/
├── THIRD-PARTY-LICENSES                 # texto MIT de web-katrain + atribución (nuevo)
├── package.json                         # +devDep @sabaki/go-board; +scripts test:nn, gen-reference
├── src/
│   ├── f16.ts                           # MOVIDO desde src/bench/; +f16ToF32
│   ├── types.ts                         # API pública: Position, Move, Analysis, NetworkId, RankLevel, Engine
│   ├── index.ts                         # barrel público
│   ├── vendor/web-katrain/              # adaptado de web-katrain (MIT, cabeceras)
│   │   ├── fastBoard.ts                 # board + libertades + escaleras + Benson (vendor casi intacto)
│   │   ├── scoreValue.ts                # score-utility (boardSize por parámetro, sin global)
│   │   ├── evalV8.ts                    # postprocessKataGoV8 (vendor intacto)
│   │   ├── searchParams.ts              # constantes de búsqueda
│   │   └── analyzeMcts.ts               # MCTS (costura TF.js reemplazada por evaluador inyectado)
│   ├── encoding/
│   │   ├── featuresV7.ts                # fork NCHW de featuresV7Fast (planos 0–19 + globals)
│   │   └── metaV1.ts                    # sgfmetadata[192] + perfiles de rango (NUESTRO)
│   ├── nn/
│   │   ├── session.ts                   # creación de sesión ORT (extraído del patrón de runner.ts)
│   │   └── evaluator.ts                 # NNEvaluator: ONNX → arrays crudos que consume el MCTS
│   ├── search/
│   │   └── mcts.ts                       # wiring: inyecta NNEvaluator en MctsSearch adaptado
│   ├── humansl.ts                       # perfiles preaz_20k…9d + genMove por rango
│   ├── engine.ts                        # LocalEngine implements Engine
│   └── worker/
│       ├── protocol.ts                  # mensajes tipados main↔worker
│       ├── engine.worker.ts             # entry del Worker
│       └── client.ts                    # WorkerEngine implements Engine
├── scripts/
│   ├── setup-katago.sh                  # brew install katago + descarga de .bin.gz oficiales
│   └── gen-reference.mjs                # GTP kata-raw-nn / kata-raw-human-nn → JSON de fixtures
└── tests/
    ├── f16.test.ts                      # (existente, actualizar import) + round-trip f16ToF32
    ├── board.test.ts                    # fastBoard vs @sabaki/go-board
    ├── ladderArea.test.ts               # escaleras + Benson (posiciones a mano)
    ├── featuresV7.test.ts               # encoder NCHW vs oráculo diferencial NHWC + invariantes
    ├── metaV1.test.ts                   # meta[192]: invariantes + golden
    ├── evalV8.test.ts                   # postproceso (math pura)
    ├── mcts.test.ts                     # MCTS con red mock determinista
    ├── nn.reference.test.ts             # (test:nn, Node+ONNX) encoder→ONNX vs kata-raw-nn
    └── fixtures/
        ├── reference/*.json             # salidas kata-raw-nn (committeadas)
        └── meta/*.json                  # golden de sgfmetadata.py (committeado)
```

Los `.ts` de `src/` se typechequean; solo `tests/**/*.test.ts` corren como suites (vitest). `nn.reference.test.ts` corre bajo un script aparte (`test:nn`) porque carga ONNX.

---

### Task 0: Setup de KataGo y generación de fixtures de referencia (BLOQUEANTE)

Sin vectores de `kata-raw-nn` no hay oráculo para el encoding ni el evaluador (TDD sin oráculo es imposible). `fuentes.md §0` confirma que no hay binario `katago` ni `.bin.gz` en la máquina. Este task no escribe código de producto; produce los JSON committeados que gatean Tier 1.

**Files:**
- Create: `packages/engine/scripts/setup-katago.sh`, `packages/engine/scripts/gen-reference.mjs`, `packages/engine/tests/fixtures/reference/*.json`
- Modify: `packages/engine/package.json` (script `gen-reference`)

**Interfaces:**
- Produces: `tests/fixtures/reference/<caso>.json` con forma
  `{ boardSize: number; komi: number; rules: 'chinese'|'japanese'; moves: Array<[player: 'b'|'w', vertex: string]>; nextPlayer: 'b'|'w'; whiteWin: number; whiteLoss: number; noResult: number; whiteLead: number; whiteScoreSelfplay: number; policy: number[] /*len H·W, NaN=ilegal*/; policyPass: number; whiteOwnership: number[] /*len H·W*/ }`
  (perspectiva **Blanca**, tal cual reporta `kata-raw-nn`).

- [ ] **Step 1: Script de instalación de KataGo + checkpoints**

`packages/engine/scripts/setup-katago.sh`:
```bash
#!/usr/bin/env bash
# Instala KataGo 1.16.5 y descarga los checkpoints oficiales para generar
# vectores de referencia. Los .bin.gz NO se commitean (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v katago >/dev/null || brew install katago
katago version | grep -q '1.16' || echo "AVISO: se esperaba KataGo 1.16.x"
mkdir -p models/katago-bin
dl() { # url dest bytes
  [[ -f "$2" && "$(stat -f%z "$2")" == "$3" ]] && { echo "OK $2"; return; }
  curl -fL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"
}
dl "https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz" \
   "models/katago-bin/b18c384nbt.bin.gz" 97898094
dl "https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz" \
   "models/katago-bin/humanv0.bin.gz" 99066230
echo "KataGo listo. Redes en models/katago-bin/ (gitignored)."
```

- [ ] **Step 2: Config GTP determinista + generador de fixtures**

`packages/engine/scripts/gen-reference.mjs` (Node, sin deps): escribe un `gtp.cfg` temporal con `numSearchThreads=1`, lanza `katago gtp -model models/katago-bin/b18c384nbt.bin.gz`, y para cada caso envía por stdin `boardsize N`, `komi K`, `kata-set-rules chinese|japanese`, la secuencia `play B/W <vertex>`, y `kata-raw-nn 0`; parsea la respuesta (pares clave-valor, `policy`/`policyPass`/`whiteOwnership`) de forma tolerante al orden. Batería mínima de casos: tablero vacío 19/13/9; apertura (4-4, 3-4); una escalera que funciona y una que no; un seki simple; un ko; un endgame casi cerrado. Vuelca cada caso a `tests/fixtures/reference/<caso>.json` con el shape de arriba.

```js
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
// CASES: lista de { name, boardSize, komi, rules, moves:[['b','Q16'],...], nextPlayer }
// runGtp(model, commands): Promise<string[]>  — abre katago gtp, envía comandos, recoge respuestas
// parseRawNn(text): { whiteWin, whiteLoss, noResult, whiteLead, whiteScoreSelfplay, policy:number[], policyPass, whiteOwnership:number[] }
//   ('NAN' → NaN en policy). Ver docs/GTP_Extensions.md.
// Para cada caso: construir comandos, correr, parsear, writeFileSync(fixtures/reference/<name>.json).
// (Implementación completa: ~120 líneas; determinista con numSearchThreads=1 y SYMMETRY=0.)
```

Añadir a `package.json` scripts: `"gen-reference": "node scripts/gen-reference.mjs"`.

- [ ] **Step 3: Ejecutar y commitear fixtures**

Run: `bash packages/engine/scripts/setup-katago.sh && npm run -w @tengen/engine gen-reference`
Expected: se generan ~8 JSON en `tests/fixtures/reference/`. Sanity manual: en el tablero vacío 19×19 komi 7.5, `whiteWin≈0.557` (Negro ≈0.443, coincide con `fuentes.md §0`), y el argmax de `policy` cae en un hoshi (3,3).

- [ ] **Step 4: Commit**

```bash
git add packages/engine/scripts/setup-katago.sh packages/engine/scripts/gen-reference.mjs \
        packages/engine/tests/fixtures/reference packages/engine/package.json
git commit -m "test(engine): generador y fixtures de referencia kata-raw-nn (KataGo 1.16.5)"
```

---

### Task 1: Tipos públicos, atribución y vendoring inicial

Scaffold de la API pública (interfaz `Engine` de la spec) y colocación de los archivos de web-katrain con cabeceras MIT. No adapta lógica todavía — solo deja el terreno tipado y atribuido.

**Files:**
- Create: `packages/engine/src/types.ts`, `packages/engine/src/index.ts`, `packages/engine/THIRD-PARTY-LICENSES`, `packages/engine/src/vendor/web-katrain/{fastBoard,scoreValue,evalV8,searchParams,analyzeMcts}.ts`
- Modify: `packages/engine/package.json` (devDep `@sabaki/go-board`)
- Test: `packages/engine/tests/publicTypes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StoneColor = 'black' | 'white'
  export type BoardSize = 9 | 13 | 19
  export type Rules = 'chinese' | 'japanese'
  export type NetworkId = 'b18' | 'humanv0' | 'b10'
  export type RankLevel = { kind: 'human'; rank: HumanRank } | { kind: 'kata'; visits: number }
  export type HumanRank = '20k'|'19k'|'18k'|'17k'|'16k'|'15k'|'14k'|'13k'|'12k'|'11k'|'10k'|'9k'|'8k'|'7k'|'6k'|'5k'|'4k'|'3k'|'2k'|'1k'|'1d'|'2d'|'3d'|'4d'|'5d'|'6d'|'7d'|'8d'|'9d'
  export type Vertex = { x: number; y: number } | 'pass'
  export type Move = { color: StoneColor; vertex: Vertex }
  export type Position = {
    boardSize: BoardSize
    komi: number
    rules: Rules
    handicap: number            // piedras de handicap colocadas (0 = sin handicap)
    moves: Move[]               // desde el inicio (tras handicap), en orden
  }
  export type MoveAnalysis = {
    vertex: Vertex; visits: number; winrate: number  // persp. Negro
    scoreLead: number; prior: number; pv: Vertex[]
  }
  export type Analysis = {
    winrate: number; scoreLead: number; scoreStdev: number; visits: number  // persp. Negro
    moves: MoveAnalysis[]; ownership?: Float32Array
  }
  export type CancelFn = () => void
  export interface Engine {
    init(config: { network: NetworkId; boardSize: BoardSize }): Promise<void>
    genMove(pos: Position, opts: { level: RankLevel }): Promise<Move>
    analyze(pos: Position, opts: { visits: number }, onUpdate: (a: Analysis) => void): CancelFn
    stop(): void
  }
  ```

- [ ] **Step 1: Test que falla**

`packages/engine/tests/publicTypes.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Engine, Position, RankLevel } from '../src/index'
import { HUMAN_RANKS } from '../src/index'

describe('API pública', () => {
  it('exporta los 29 rangos humanos 20k..9d en orden', () => {
    expect(HUMAN_RANKS.length).toBe(29)
    expect(HUMAN_RANKS[0]).toBe('20k')
    expect(HUMAN_RANKS[28]).toBe('9d')
  })
  it('la interfaz Engine y Position son usables', () => {
    const pos: Position = { boardSize: 19, komi: 7.5, rules: 'chinese', handicap: 0, moves: [] }
    const level: RankLevel = { kind: 'kata', visits: 100 }
    expect(pos.moves.length).toBe(0)
    expect(level.kind).toBe('kata')
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm test -w @tengen/engine`
Expected: FAIL — `Cannot find module '../src/index'`.

- [ ] **Step 3: Implementar tipos + barrel + vendoring**

Crear `src/types.ts` con los tipos de arriba y `export const HUMAN_RANKS = ['20k',…,'9d'] as const` (29 entradas). `src/index.ts` re-exporta todo lo público (`export * from './types'` + más adelante `engine`, `worker/client`).

Copiar los archivos de web-katrain a `src/vendor/web-katrain/`:
```bash
V=~/dev/vendor/web-katrain/src/engine/katago
D=packages/engine/src/vendor/web-katrain
cp $V/fastBoard.ts $V/scoreValue.ts $V/evalV8.ts $V/searchParams.ts $V/analyzeMcts.ts $D/
```
A cada uno anteponer la cabecera:
```ts
/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487.
 * Licencia MIT — ver packages/engine/THIRD-PARTY-LICENSES.
 * Cambios de tengen documentados en docs/research/fase-engine/decisiones-adaptacion.md.
 */
```
Crear `packages/engine/THIRD-PARTY-LICENSES` con el texto de la licencia MIT de web-katrain (copiar su `LICENSE`) y la lista de archivos adaptados. Añadir `@sabaki/go-board` a `devDependencies` de `package.json`.

(En este task los vendored pueden tener errores de import entre sí — se resuelven en los tasks que adaptan cada uno. `tsc` de `src/vendor` puede fallar hasta Task 8; por eso el test solo importa `src/index`, que aún no re-exporta vendored.)

- [ ] **Step 4: Verificar que pasa**

Run: `npm install && npm test -w @tengen/engine`
Expected: PASS — `publicTypes` + suites existentes del bench.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/index.ts packages/engine/src/vendor \
        packages/engine/THIRD-PARTY-LICENSES packages/engine/package.json packages/engine/package-lock.json \
        packages/engine/tests/publicTypes.test.ts
git commit -m "feat(engine): tipos públicos (interfaz Engine) + vendoring MIT de web-katrain"
```

---

### Task 2: f16 compartido con decodificador

El bench solo tiene `f32ToF16`. El evaluador ONNX necesita **decodificar** outputs fp16 (`Uint16Array`) a float. Se mueve `f16.ts` a `src/` para compartirlo y se añade la inversa.

**Files:**
- Move: `packages/engine/src/bench/f16.ts` → `packages/engine/src/f16.ts`
- Modify: `packages/engine/src/bench/runner.ts` (import), `packages/engine/tests/f16.test.ts` (import)
- Test: `packages/engine/tests/f16.test.ts` (+ round-trip)

**Interfaces:**
- Consumes: `f32ToF16(src: Float32Array): Uint16Array` (existente).
- Produces: `f16ToF32(src: Uint16Array): Float32Array` — decodifica IEEE-754 half (Inf/NaN/subnormales incluidos).

- [ ] **Step 1: Test que falla (añadir a f16.test.ts)**

```ts
import { f32ToF16, f16ToF32 } from '../src/f16'

describe('f16ToF32', () => {
  it('decodifica valores exactos', () => {
    const out = f16ToF32(new Uint16Array([0x0000, 0x3c00, 0xbc00, 0x3800, 0x4000, 0xb600]))
    expect(Array.from(out)).toEqual([0, 1, -1, 0.5, 2, -0.375])
  })
  it('round-trip de valores representables en half', () => {
    const vals = new Float32Array([0, 1, -1, 0.5, -0.375, 2, 7.5, -12.5, 0.25])
    const back = f16ToF32(f32ToF16(vals))
    for (let i = 0; i < vals.length; i++) expect(back[i]).toBeCloseTo(vals[i]!, 3)
  })
  it('decodifica ±Inf y NaN', () => {
    const out = f16ToF32(new Uint16Array([0x7c00, 0xfc00, 0x7e00]))
    expect(out[0]).toBe(Infinity); expect(out[1]).toBe(-Infinity); expect(Number.isNaN(out[2]!)).toBe(true)
  })
})
```

- [ ] **Step 2: Mover el archivo y actualizar imports**

```bash
git mv packages/engine/src/bench/f16.ts packages/engine/src/f16.ts
```
En `src/bench/runner.ts`: `import { f32ToF16 } from './f16'` → `from '../f16'`. En `tests/f16.test.ts`: `from '../src/bench/f16'` → `from '../src/f16'`.

Run: `npm test -w @tengen/engine` → Expected: FAIL — `f16ToF32` no existe.

- [ ] **Step 3: Implementar f16ToF32**

Añadir a `src/f16.ts`:
```ts
/** Decodifica float16 (IEEE-754 half, Uint16Array de ORT) a float32. */
export function f16ToF32(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) {
    const h = src[i]!
    const sign = (h & 0x8000) ? -1 : 1
    const exp = (h >> 10) & 0x1f
    const mant = h & 0x3ff
    if (exp === 0) out[i] = sign * Math.pow(2, -14) * (mant / 1024)
    else if (exp === 0x1f) out[i] = mant ? NaN : sign * Infinity
    else out[i] = sign * Math.pow(2, exp - 15) * (1 + mant / 1024)
  }
  return out
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine && npx -w @tengen/engine tsc --noEmit`
Expected: PASS (incluido el bench: `runner.ts` compila con el nuevo import) y tsc verde.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/f16.ts packages/engine/src/bench/runner.ts packages/engine/tests/f16.test.ts
git commit -m "refactor(engine): mover f16 a src/ y añadir f16ToF32 para outputs fp16"
```

---

### Task 3: Board adaptado vs oráculo @sabaki/go-board

Se adapta `fastBoard.ts` (board + `playMove`/`undoMove` + ko + capturas) y se valida contra `@sabaki/go-board` con partidas aleatorias sembradas. Se añade un PRNG determinista para reproducibilidad.

**Files:**
- Modify: `packages/engine/src/vendor/web-katrain/fastBoard.ts` (arreglar imports de `../../types` → tipos locales; verificar que compila aislado)
- Create: `packages/engine/src/testutil/rng.ts`
- Test: `packages/engine/tests/board.test.ts`

**Interfaces:**
- Consumes (de `fastBoard.ts`, ya verificados): `setBoardSize(size)`, `SimPosition = { stones: Uint8Array; koPoint: number }`, `playMove(pos, move, player, captureStack): UndoSnapshot` (lanza en ilegal), `undoMove(pos, move, player, snapshot, captureStack)`, `EMPTY/BLACK/WHITE`, `PASS_MOVE`, `opponentOf`.
- Produces: `mulberry32(seed: number): () => number` (PRNG determinista en `testutil/rng.ts`).

- [ ] **Step 1: Test que falla**

`packages/engine/tests/board.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import Board from '@sabaki/go-board'
import { setBoardSize, playMove, PASS_MOVE, EMPTY, BLACK, WHITE } from '../src/vendor/web-katrain/fastBoard'
import { mulberry32 } from '../src/testutil/rng'

const N = 19
function stonesToSabaki(stones: Uint8Array): Board {
  const signMap: number[][] = []
  for (let y = 0; y < N; y++) {
    const row: number[] = []
    for (let x = 0; x < N; x++) {
      const c = stones[y * N + x]!
      row.push(c === BLACK ? 1 : c === WHITE ? -1 : 0)
    }
    signMap.push(row)
  }
  return Board.fromDimensions(N, N).makeBoard?.(signMap) ?? (Board as any).fromSignMap?.(signMap) ?? new (Board as any)(signMap)
}

describe('fastBoard vs @sabaki/go-board', () => {
  it('coinciden en el estado de piedras tras 200 jugadas aleatorias legales', () => {
    setBoardSize(N)
    const pos = { stones: new Uint8Array(N * N), koPoint: -1 }
    const captureStack: number[] = []
    let sabaki = Board.fromDimensions(N, N)
    const rng = mulberry32(0xC0FFEE)
    let player = BLACK
    for (let i = 0; i < 200; i++) {
      const move = Math.floor(rng() * N * N)
      try {
        playMove(pos, move, player, captureStack)
      } catch {
        continue // ilegal en fastBoard: no avanzamos ni cambiamos jugador
      }
      const x = move % N, y = (move / N) | 0
      sabaki = sabaki.makeMove(player === BLACK ? 1 : -1, [x, y])
      player = player === BLACK ? WHITE : BLACK
    }
    // Comparar mapas de signos
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const c = pos.stones[y * N + x]!
        const sign = c === BLACK ? 1 : c === WHITE ? -1 : 0
        expect(sabaki.get([x, y])).toBe(sign)
      }
  })
  it('PASS_MOVE no coloca piedra y limpia ko', () => {
    setBoardSize(N)
    const pos = { stones: new Uint8Array(N * N), koPoint: 5 }
    playMove(pos, PASS_MOVE, BLACK, [])
    expect(pos.koPoint).toBe(-1)
    expect(pos.stones.every((v) => v === EMPTY)).toBe(true)
  })
})
```

- [ ] **Step 2: PRNG + arreglar imports de fastBoard**

`packages/engine/src/testutil/rng.ts`:
```ts
/** PRNG determinista (mulberry32) para tests reproducibles. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```
En `fastBoard.ts`, sustituir cualquier `import ... from '../../types'` por los tipos mínimos locales que use (`StoneColor` ya se define en el propio archivo; `Player` no se usa aquí). Verificar que compila aislado: `npx -w @tengen/engine tsc --noEmit`.

Run: `npm test -w @tengen/engine` → Expected: FAIL si aún hay imports rotos; iterar hasta que el único fallo sea de aserción o pase.

- [ ] **Step 3: Ajuste mínimo (si aplica)**

Si `@sabaki/go-board` no marca ilegal exactamente igual que `fastBoard` (superko vs ko simple), restringir el test a jugadas que ambos aceptan (el `catch` ya salta las que `fastBoard` rechaza; añadir que si `sabaki.makeMove` lanza, deshacer con `undoMove`). Documentar la diferencia en un comentario del test (KataGo = ko simple).

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine`
Expected: PASS — board coincide con el oráculo en 200 jugadas + PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/vendor/web-katrain/fastBoard.ts packages/engine/src/testutil/rng.ts packages/engine/tests/board.test.ts
git commit -m "feat(engine): board adaptado de web-katrain validado contra @sabaki/go-board"
```

---

### Task 4: Escaleras y área de Benson (posiciones a mano)

`fastBoard.ts` ya trae el solver de escaleras (`computeLadderFeaturesV7KataGo`) y Benson (`computeAreaMapV7KataGo`). Como el engine depende de ellos para los planos 14–19, se **testean** con posiciones construidas a mano (una escalera que funciona y otra que no; grupos pass-alive con dos ojos; un punto de territorio interior).

**Files:**
- Test: `packages/engine/tests/ladderArea.test.ts`

**Interfaces:**
- Consumes (de `fastBoard.ts`): `computeLadderFeaturesV7KataGo({ stones, koPoint, currentPlayer }): { ladderedStones: Uint8Array; ladderWorkingMoves: Uint8Array }`, `computeAreaMapV7KataGo(stones, isMultiStoneSuicideLegal?): Uint8Array` (EMPTY/BLACK/WHITE por punto).

- [ ] **Step 1: Test que falla**

`packages/engine/tests/ladderArea.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { setBoardSize, BLACK, WHITE, EMPTY, computeLadderFeaturesV7KataGo, computeAreaMapV7KataGo } from '../src/vendor/web-katrain/fastBoard'

const N = 19
const idx = (x: number, y: number) => y * N + x
function board(place: (put: (x: number, y: number, c: number) => void) => void): Uint8Array {
  setBoardSize(N)
  const s = new Uint8Array(N * N)
  place((x, y, c) => (s[idx(x, y)] = c))
  return s
}

describe('escaleras', () => {
  it('marca una piedra en atari escalerable (2 libs) capturable hacia la esquina', () => {
    // Piedra blanca en (1,1) con negras en (0,1) y (1,0): 2 libs, escalera hacia el borde.
    const stones = board((p) => { p(1, 1, WHITE); p(0, 1, BLACK); p(1, 0, BLACK) })
    const { ladderedStones } = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: 'black' })
    expect(ladderedStones[idx(1, 1)]).toBe(1)
  })
  it('NO marca una piedra con 3+ libertades', () => {
    const stones = board((p) => { p(9, 9, WHITE) })
    const { ladderedStones } = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: 'black' })
    expect(ladderedStones[idx(9, 9)]).toBe(0)
  })
})

describe('Benson / área', () => {
  it('marca como territorio de Negro un ojo rodeado por un grupo pass-alive', () => {
    // Grupo negro con dos ojos en la esquina: (0,0) vacío = ojo, resto negro alrededor.
    const stones = board((p) => {
      p(1, 0, BLACK); p(0, 1, BLACK); p(1, 1, BLACK)
      p(2, 0, BLACK); p(2, 1, BLACK); p(0, 2, BLACK); p(1, 2, BLACK); p(2, 2, BLACK)
    })
    const area = computeAreaMapV7KataGo(stones, false)
    expect(area[idx(0, 0)]).toBe(BLACK)   // ojo = territorio de Negro
  })
  it('deja dame como EMPTY', () => {
    const stones = board((p) => { p(9, 9, BLACK); p(9, 10, WHITE) })
    const area = computeAreaMapV7KataGo(stones, false)
    expect(area[idx(0, 0)]).toBe(EMPTY)
  })
})
```

- [ ] **Step 2: Verificar (debería pasar si el vendoring es correcto)**

Run: `npm test -w @tengen/engine -- ladderArea`
Expected: PASS. Si una posición no se comporta como el comentario, ajustar la posición (no el código vendorizado) hasta reflejar el invariante real de KataGo; si un método está roto por el vendoring, arreglar imports en `fastBoard.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/tests/ladderArea.test.ts
git commit -m "test(engine): escaleras y Benson de fastBoard con posiciones a mano"
```

---

### Task 5: GameState + encoder V7 en NCHW (oráculo diferencial)

Se construye `GameState` (reconstruye la `SimPosition`, el historial de jugadas recientes, y los tableros de hace 1/2 turnos para los planos 15/16) y se **forkea** `featuresV7Fast.ts` a `encoding/featuresV7.ts` con indexador **NCHW** y `boardSize` parametrizado. Se ancla la reescritura con un oráculo diferencial: comparar contra el `fillInputsV7Fast` NHWC original (vendorizado sin tocar, solo para test) tras des-transponer.

**Files:**
- Create: `packages/engine/src/encoding/featuresV7.ts`, `packages/engine/src/encoding/gameState.ts`, `packages/engine/src/vendor/web-katrain/featuresV7Fast.ts` (copia NHWC intacta, **solo para el test diferencial**)
- Test: `packages/engine/tests/featuresV7.test.ts`

**Interfaces:**
- Consumes: `fastBoard` (Task 3/4), `Position`/`Move` (Task 1).
- Produces:
  ```ts
  // gameState.ts
  export type GameState = {
    boardSize: number; stones: Uint8Array; koPoint: number; currentPlayer: 'black' | 'white'
    recentMoves: { move: number; player: 'black' | 'white' }[]  // cronológico, último = más reciente
    prevStones: Uint8Array; prevPrevStones: Uint8Array          // tableros de hace 1 y 2 turnos
    komi: number; rules: 'chinese' | 'japanese'
  }
  export function buildGameState(pos: Position): GameState
  // featuresV7.ts
  export const SPATIAL_CHANNELS_V7 = 22
  export const GLOBAL_CHANNELS_V7 = 19
  export function fillFeaturesV7NCHW(args: {
    state: GameState; conservativePassAndIsRoot?: boolean
    outSpatial: Float32Array   // len boardSize²·22, NCHW: c·N²+y·N+x
    outGlobal: Float32Array    // len 19
  }): void
  ```

- [ ] **Step 1: Test que falla (oráculo diferencial NHWC↔NCHW)**

`packages/engine/tests/featuresV7.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { fillInputsV7Fast } from '../src/vendor/web-katrain/featuresV7Fast'   // NHWC original
import { fillFeaturesV7NCHW, SPATIAL_CHANNELS_V7 } from '../src/encoding/featuresV7'
import { buildGameState } from '../src/encoding/gameState'

const N = 19, C = SPATIAL_CHANNELS_V7
const nhwc = (x: number, y: number, c: number) => (y * N + x) * C + c
const nchw = (x: number, y: number, c: number) => c * N * N + y * N + x

describe('featuresV7 NCHW == NHWC de web-katrain (des-transpuesto)', () => {
  it('coincide plano a plano en una posición con historial y capturas', () => {
    setBoardSize(N)
    const state = buildGameState({
      boardSize: 19, komi: 7.5, rules: 'chinese', handicap: 0,
      moves: [
        { color: 'black', vertex: { x: 3, y: 3 } }, { color: 'white', vertex: { x: 15, y: 15 } },
        { color: 'black', vertex: { x: 15, y: 3 } }, { color: 'white', vertex: { x: 3, y: 15 } },
      ],
    })
    // NHWC de referencia
    const refSpatial = new Float32Array(N * N * C), refGlobal = new Float32Array(19)
    fillInputsV7Fast({
      stones: state.stones, koPoint: state.koPoint, currentPlayer: state.currentPlayer,
      recentMoves: state.recentMoves, komi: state.komi, rules: state.rules,
      outSpatial: refSpatial, outGlobal: refGlobal,
    })
    // Nuestro NCHW
    const ourSpatial = new Float32Array(N * N * C), ourGlobal = new Float32Array(19)
    fillFeaturesV7NCHW({ state, outSpatial: ourSpatial, outGlobal: ourGlobal })

    for (let c = 0; c < C; c++)
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++)
          expect(ourSpatial[nchw(x, y, c)]).toBe(refSpatial[nhwc(x, y, c)])
    expect(Array.from(ourGlobal)).toEqual(Array.from(refGlobal))
  })
  it('plano 0 (máscara) = 1 en todo el tablero', () => {
    setBoardSize(N)
    const state = buildGameState({ boardSize: 19, komi: 7.5, rules: 'chinese', handicap: 0, moves: [] })
    const sp = new Float32Array(N * N * C), gl = new Float32Array(19)
    fillFeaturesV7NCHW({ state, outSpatial: sp, outGlobal: gl })
    for (let i = 0; i < N * N; i++) expect(sp[i]).toBe(1) // plano 0 = índices 0..360
    expect(gl[5]).toBeCloseTo(-0.375, 6) // selfKomi/20, Negro al turno
  })
})
```

- [ ] **Step 2: Vendorizar featuresV7Fast (NHWC) + verificar que falla**

```bash
cp ~/dev/vendor/web-katrain/src/engine/katago/featuresV7Fast.ts packages/engine/src/vendor/web-katrain/featuresV7Fast.ts
```
Añadir la cabecera MIT. Arreglar sus imports de tipos (`Player`, `GameRules`) a definiciones locales o a `../../types` según corresponda.

Run: `npm test -w @tengen/engine -- featuresV7`
Expected: FAIL — `encoding/featuresV7` y `encoding/gameState` no existen.

- [ ] **Step 3: Implementar gameState + encoder NCHW**

`encoding/gameState.ts`: `buildGameState(pos)` coloca las piedras de handicap (para chinas, en los hoshi estándar; el komi efectivo con handicap +N lo ajusta el llamador vía `komi`), aplica `pos.moves` con `playMove` sobre una `SimPosition`, guardando copias de `stones` **antes** de las dos últimas jugadas (`prevStones`, `prevPrevStones`) y el `recentMoves` (mapeando `Vertex`→índice plano o `PASS_MOVE`). Deriva `currentPlayer` de la paridad. `koPoint` sale del último `playMove`.

`encoding/featuresV7.ts`: portar `fillInputsV7Fast` **cambiando SOLO** (a) el indexador a `const idx = (x,y,c) => c*N*N + y*N + x` con `N = state.boardSize`, (b) todos los bucles `for (pos<361)` y `BOARD_SIZE` hardcodeado a `N` parametrizado, (c) precomputar los mapas de ladder/área/libertades llamando a `fastBoard` (`computeLibertyMap`, `computeAreaMapV7KataGo` solo si `rules==='chinese'`, `computeLadderFeaturesV7KataGo` para 14/17 y `computeLadderedStonesV7KataGo` sobre `prevStones`/`prevPrevStones` para 15/16). El resto (qué plano/qué global, reglas, onda de komi, supresión de historial con `conservativePassAndIsRoot`) idéntico al original.

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine -- featuresV7 && npx -w @tengen/engine tsc --noEmit`
Expected: PASS — NCHW coincide con NHWC des-transpuesto en todos los planos; máscara y komi correctos.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/encoding packages/engine/src/vendor/web-katrain/featuresV7Fast.ts packages/engine/tests/featuresV7.test.ts
git commit -m "feat(engine): GameState + encoder V7 NCHW (anclado a oráculo diferencial de web-katrain)"
```

---

### Task 6: meta_input[192] de Human SL

Encoder propio de `sgfmetadata` (`fuentes.md §2`) con los perfiles de rango `preaz_20k…preaz_9d`. No lo tiene web-katrain. Se computa una vez por partida.

**Files:**
- Create: `packages/engine/src/encoding/metaV1.ts`
- Test: `packages/engine/tests/metaV1.test.ts`, `packages/engine/tests/fixtures/meta/preaz_9d.json` (golden de `sgfmetadata.py`)

**Interfaces:**
- Produces:
  ```ts
  export const META_CHANNELS = 192
  export function inverseRank(rank: HumanRank): number   // 9d=1, 1d=9, 1k=10, 20k=29
  export function fillMetaV1(args: { rank: HumanRank; boardArea: number; out: Float32Array /* len 192 */ }): void
  ```
  Perfil fijo `preaz_`: ambos humanos, mismo rango, `[74]=0.5`, byo-yomi 1200 s + 30 s × 5, source=KGS (índice 2), fecha `2016-09-01`.

- [ ] **Step 1: Golden de referencia (una vez, con KataGo)**

Generar el vector esperado con el script Python de KataGo:
```bash
cd ~/dev/vendor && python3 -c "import sys; sys.path.insert(0,'KataGo/python')" 2>/dev/null || true
# Usar sgfmetadata.py de KataGo para preaz_9d, boardArea=361 → volcar 192 floats a JSON.
```
Guardar en `tests/fixtures/meta/preaz_9d.json` como `{ rank: '9d', boardArea: 361, meta: number[192] }`. (Si KataGo no está clonado, generar tras Task 0 desde `~/dev/vendor` o el scratchpad; el fixture se commitea.)

- [ ] **Step 2: Test que falla**

`packages/engine/tests/metaV1.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import golden from './fixtures/meta/preaz_9d.json'
import { fillMetaV1, inverseRank, META_CHANNELS } from '../src/encoding/metaV1'

describe('metaV1', () => {
  it('inverseRank: 9d=1, 1d=9, 1k=10, 20k=29', () => {
    expect(inverseRank('9d')).toBe(1); expect(inverseRank('1d')).toBe(9)
    expect(inverseRank('1k')).toBe(10); expect(inverseRank('20k')).toBe(29)
  })
  it('invariantes: termómetro suma min(invRank,34), one-hots, fecha módulo 1, [74]=0.5', () => {
    const out = new Float32Array(META_CHANNELS)
    fillMetaV1({ rank: '9d', boardArea: 361, out })
    const thermo = Array.from(out.slice(6, 40)).reduce((a, b) => a + b, 0)
    expect(thermo).toBe(Math.min(inverseRank('9d'), 34)) // = 1
    expect(Array.from(out.slice(75, 82)).reduce((a, b) => a + b, 0)).toBe(1) // time-control one-hot
    expect(out[74]).toBe(0.5)
    for (let i = 0; i < 32; i++) {
      const cos = out[87 + i * 2]!, sin = out[87 + i * 2 + 1]!
      expect(cos * cos + sin * sin).toBeCloseTo(1, 5)
    }
  })
  it('coincide con el golden de sgfmetadata.py (preaz_9d)', () => {
    const out = new Float32Array(META_CHANNELS)
    fillMetaV1({ rank: '9d', boardArea: 361, out })
    for (let i = 0; i < META_CHANNELS; i++) expect(out[i]).toBeCloseTo(golden.meta[i]!, 5)
  })
})
```

- [ ] **Step 3: Implementar metaV1**

Portar `fillMetadataRow` de `fuentes.md §2` / `sgfmetadata.cpp`: `[0,1]=1` (ambos humanos), `[74]=0.5`, termómetro `[6..39]`/`[40..73]` (primeros `min(invRank,34)` a 1), one-hot time-control byo-yomi (`[79]=1`), `[82..85]` de tiempos (`mainTime=1200`, `period=30`, `byoYomiPeriods=5`), `[86]=0.5·ln(area/361)`, fecha `[87..150]` (32 pares cos/sin con `period=7·factor^k`, `factor=80000^(1/31)`, días desde 1970-01-01 hasta 2016-09-01 = 17075), source KGS `[151+2]=1`. Resto 0.

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine -- metaV1`
Expected: PASS — invariantes + golden dentro de 1e-5.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/encoding/metaV1.ts packages/engine/tests/metaV1.test.ts packages/engine/tests/fixtures/meta
git commit -m "feat(engine): meta_input[192] de Human SL con perfiles preaz + golden"
```

---

### Task 7: Postproceso value/score (evalV8)

Se adapta `evalV8.ts` (`postprocessKataGoV8` + `scoreValue.ts` con `boardSize` explícito) y se testea la matemática pura (softmax, softplus, ×20, ×(1−noResult), perspectiva a Negro).

**Files:**
- Modify: `packages/engine/src/vendor/web-katrain/evalV8.ts` (imports), `packages/engine/src/vendor/web-katrain/scoreValue.ts` (romper acoplamiento a `BOARD_AREA` global → parámetro)
- Test: `packages/engine/tests/evalV8.test.ts`

**Interfaces:**
- Consumes (verificados): `postprocessKataGoV8({ nextPlayer, valueLogits, scoreValue, postProcessParams? }): { blackWinProb; blackScoreLead; blackScoreMean; blackScoreStdev; blackNoResultProb }`.
- Produces: `scoreValue.ts` con `expectedWhiteScoreValue({ whiteScoreMean, whiteScoreStdev, center, scale, sqrtBoardArea })` — **sin leer `BOARD_AREA` global**; `getSqrtBoardArea` reemplazado por parámetro donde se use.

- [ ] **Step 1: Test que falla**

`packages/engine/tests/evalV8.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { postprocessKataGoV8 } from '../src/vendor/web-katrain/evalV8'

describe('postprocessKataGoV8', () => {
  it('value logits iguales → win 0.5; score con multiplicadores por defecto (20)', () => {
    const r = postprocessKataGoV8({
      nextPlayer: 'black',
      valueLogits: [0, 0, -50],                 // win=loss, noResult≈0
      scoreValue: [0.5, -10, 0.5, 0],           // scoreMean=0.5·20=10, stdev=softplus(-10)·20≈0, lead=10
    })
    expect(r.blackWinProb).toBeCloseTo(0.5, 3)
    expect(r.blackNoResultProb).toBeCloseTo(0, 3)
    expect(r.blackScoreMean).toBeCloseTo(10, 1)
    expect(r.blackScoreLead).toBeCloseTo(10, 1)
  })
  it('perspectiva: con nextPlayer=white se niega el lead y se intercambia win/loss', () => {
    const asBlack = postprocessKataGoV8({ nextPlayer: 'black', valueLogits: [2, 0, -50], scoreValue: [0.5, -10, 0.5, 0] })
    const asWhite = postprocessKataGoV8({ nextPlayer: 'white', valueLogits: [2, 0, -50], scoreValue: [0.5, -10, 0.5, 0] })
    expect(asWhite.blackWinProb).toBeCloseTo(1 - asBlack.blackWinProb, 5)
    expect(asWhite.blackScoreLead).toBeCloseTo(-asBlack.blackScoreLead, 3)
  })
})
```

- [ ] **Step 2: Adaptar evalV8/scoreValue + verificar que falla**

Arreglar imports en `evalV8.ts`. En `scoreValue.ts`, cambiar las lecturas de `BOARD_AREA`/`BOARD_SIZE` globales de `./fastBoard` por parámetros (`sqrtBoardArea` ya es argumento de `expectedWhiteScoreValue`; el cacheo de tabla se keyea por el `boardSize` recibido, no por el global). Añadir cabeceras MIT.

Run: `npm test -w @tengen/engine -- evalV8` → Expected: FAIL hasta arreglar imports; luego evaluar aserciones.

- [ ] **Step 3: Ajuste**

Si `postprocessKataGoV8` necesita `postProcessParams` explícitos (verificar defaults 20/20/20/1), pasarlos; para b18 los defaults son correctos.

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine -- evalV8 && npx -w @tengen/engine tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/vendor/web-katrain/evalV8.ts packages/engine/src/vendor/web-katrain/scoreValue.ts packages/engine/tests/evalV8.test.ts
git commit -m "feat(engine): postproceso value/score (evalV8) con boardSize explícito"
```

---

### Task 8: MCTS adaptado con evaluador inyectado (red mock determinista)

Se adapta `analyzeMcts.ts`: se **reemplaza la costura TF.js** (`evaluateBatch` → `model.forward()`) por una interfaz `NNEvaluator` inyectada, se poda la ruta de policy-optimism (head-0 pura), y se sustituye la detección de backend `tf.getBackend()` por un flag. Se prueba con una red mock determinista.

**Files:**
- Create: `packages/engine/src/nn/evaluator.ts` (solo la **interfaz** `NNEvaluator` + un `MockEvaluator` para tests)
- Modify: `packages/engine/src/vendor/web-katrain/analyzeMcts.ts` (inyección + poda de optimism + quitar `import * as tf`)
- Create: `packages/engine/src/search/mcts.ts` (wiring de alto nivel)
- Test: `packages/engine/tests/mcts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // nn/evaluator.ts
  export type RawEval = {
    policy: Float32Array     // len batch·boardArea, logits head-0 (NCHW: por-batch contiguo)
    policyPass: Float32Array // len batch, logit de pase head-0
    value: Float32Array      // len batch·3, logits [win,loss,noResult] jugador al turno
    scoreValue: Float32Array // len batch·4, [scoreMean, stdevPreSoftplus, lead, varTimeLeft] crudos
    ownership?: Float32Array  // len batch·boardArea, pre-tanh
  }
  export interface NNEvaluator {
    readonly boardSize: number
    readonly hasMeta: boolean
    evaluate(args: {
      bin: Float32Array; global: Float32Array; meta: Float32Array | null
      batch: number; includeOwnership: boolean
    }): Promise<RawEval>
  }
  // search/mcts.ts
  export function createSearch(args: {
    evaluator: NNEvaluator; state: GameState
    conservativePass?: boolean; wideRootNoise?: number
  }): Promise<MctsSearch>   // MctsSearch adaptado del vendor
  ```
- Consumes: `MctsSearch.create/run/getAnalysis`, `expandNode`, `selectEdge` (adaptados), `postprocessKataGoV8` (Task 7), `fillFeaturesV7NCHW` (Task 5).

- [ ] **Step 1: Test que falla (MCTS con mock determinista)**

`packages/engine/tests/mcts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { buildGameState } from '../src/encoding/gameState'
import { createSearch } from '../src/search/mcts'
import type { NNEvaluator, RawEval } from '../src/nn/evaluator'

// Mock: policy uniforme salvo un punto favorito; value fijo; determinista.
function mockEvaluator(N: number, favorite: number): NNEvaluator {
  const area = N * N
  return {
    boardSize: N, hasMeta: false,
    async evaluate({ batch }): Promise<RawEval> {
      const policy = new Float32Array(batch * area)
      const policyPass = new Float32Array(batch)
      const value = new Float32Array(batch * 3)
      const scoreValue = new Float32Array(batch * 4)
      for (let b = 0; b < batch; b++) {
        for (let i = 0; i < area; i++) policy[b * area + i] = i === favorite ? 3 : 0
        policyPass[b] = -5
        value[b * 3 + 0] = 0.2; value[b * 3 + 1] = -0.2; value[b * 3 + 2] = -50 // win ligera
      }
      return { policy, policyPass, value, scoreValue }
    },
  }
}

describe('MCTS', () => {
  it('con policy que favorece un punto, la jugada más visitada es ese punto', async () => {
    const N = 9, favorite = 4 * N + 4 // tengen (centro)
    setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const search = await createSearch({ evaluator: mockEvaluator(N, favorite) })
    await search.run({ visits: 200, maxTimeMs: 5000, batchSize: 8 })
    const a = search.getAnalysis({ topK: 5, analysisPvLen: 3 })
    const best = a.moves.find((m) => m.order === 0)!
    expect(best.x + best.y * N).toBe(favorite)
    expect(best.visits).toBeGreaterThan(50)
  })
  it('es determinista con el mismo mock y sin ruido', async () => {
    const N = 9
    setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const run = async () => {
      const s = await createSearch({ evaluator: mockEvaluator(N, 40), wideRootNoise: 0 })
      await s.run({ visits: 120, maxTimeMs: 5000, batchSize: 4 })
      return s.getAnalysis({ topK: 3, analysisPvLen: 1 }).moves.map((m) => m.visits)
    }
    expect(await run()).toEqual(await run())
  })
})
```

- [ ] **Step 2: Adaptar analyzeMcts (inyección + poda de optimism) + verificar que falla**

En `analyzeMcts.ts`: (a) eliminar `import * as tf`; (b) donde el constructor/`create` recibe `model: KataGoModelV8Tf`, cambiar a `evaluator: NNEvaluator`; (c) en `evaluateBatch`, reemplazar el bloque `tf.tensor4d(...)`/`model.forward()`/`.data()`/`.dispose()` (~L1447-1466) por: construir `bin`/`global`/`meta` con `fillFeaturesV7NCHW` para cada estado del batch, llamar `await evaluator.evaluate({...})`, y usar `RawEval`; (d) **podar** el bloque de policy-optimism (L1468-1492): usar `policy`/`policyPass` head-0 directos (sin leer canal +1); (e) reemplazar `tf.getBackend()==='webgpu'` por un flag `preferLargeBatch` en args (default false). El resto (expandNode softmax, selectEdge PUCT/FPU, virtual loss, backup, getAnalysis) intacto.

`nn/evaluator.ts`: solo la interfaz + `MockEvaluator` no es necesario en src (vive en el test). `search/mcts.ts`: `createSearch` mapea `GameState`→lo que `MctsSearch.create` espera (board/previousBoard/moveHistory/komi/rules) e inyecta el evaluador.

Run: `npm test -w @tengen/engine -- mcts` → Expected: FAIL hasta completar la adaptación.

- [ ] **Step 3: Iterar hasta verde**

Ajustar el mapeo `GameState`→`MctsSearch.create` (el port espera `BoardState` `[y][x]`; convertir desde `stones`). Verificar que `expandNode` consume `policy` head-0 (índice `p=y·N+x`) + `passLogit`.

- [ ] **Step 4: Verificar que pasa**

Run: `npm test -w @tengen/engine -- mcts && npx -w @tengen/engine tsc --noEmit`
Expected: PASS — jugada más visitada = favorito; determinismo con mismo mock.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/vendor/web-katrain/analyzeMcts.ts packages/engine/src/nn/evaluator.ts packages/engine/src/search/mcts.ts packages/engine/tests/mcts.test.ts
git commit -m "feat(engine): MCTS adaptado con evaluador inyectado (head-0 puro) + red mock"
```

---

### Task 9: NNEvaluator sobre onnxruntime-web

Implementación real del `NNEvaluator`: carga la sesión ONNX (introspección de nombres de input/output), arma feeds fp16/fp32 (+`meta` opcional), corre `session.run`, y produce `RawEval` crudo (split de `policy[b,6,H·W+1]` head-0, `miscvalue→scoreValue`, decode fp16). Se extrae el patrón de sesión de `runner.ts` a `nn/session.ts`.

**Files:**
- Create: `packages/engine/src/nn/session.ts`
- Modify: `packages/engine/src/nn/evaluator.ts` (`OnnxEvaluator implements NNEvaluator`)
- Test: cubierto por Task 10 (requiere modelo; no hay test unitario aislado sin ONNX).

**Interfaces:**
- Produces:
  ```ts
  export async function createOnnxSession(source: string | ArrayBuffer, opts?: { ep?: 'webgpu' | 'wasm' }): Promise<ort.InferenceSession>
  export function resolveInputNames(session: ort.InferenceSession): { bin: string; global: string; meta?: string }
  export function resolveOutputNames(session: ort.InferenceSession): { policy: string; value: string; miscvalue: string; ownership?: string }
  export class OnnxEvaluator implements NNEvaluator { /* boardSize, hasMeta, evaluate(...) */ }
  ```

- [ ] **Step 1: Implementar session.ts + OnnxEvaluator**

`nn/session.ts`: extraer de `runner.ts` la config de EP (`ort.env.wasm.wasmPaths`, `ort.env.webgpu.adapter`), aceptar `source` por URL **o** `ArrayBuffer` (para OPFS/Node), `graphOptimizationLevel: 'all'`, `release()` en el `dispose` del evaluador. `resolveInputNames` con el fallback de introspección (`inputNames.find(n=>n.includes('bin'|'global'|'meta'))`).

`OnnxEvaluator.evaluate`: construir tensores según `dtype` (fp16 vía `f32ToF16`; fp32 directo), `bin` [batch,22,N,N], `global` [batch,19], `meta` [batch,192] solo si `hasMeta`; `session.run` pidiendo outputs explícitos (evita los outputs numéricos espurios, `fuentes.md §0`); decodificar outputs fp16 con `f16ToF32`; **partir** `policy[b,6,H·W+1]` → `policy` head-0 (canal 0, índices `0..H·W-1`) + `policyPass` (índice `H·W`); mapear `miscvalue[b,10]` → `scoreValue[b,4]` = `[0,1,2, varTimeLeft]`; `value[b,3]` directo; `ownership` si `includeOwnership`. Estado ORT **por-instancia** (no module-global).

- [ ] **Step 2: Typecheck**

Run: `npx -w @tengen/engine tsc --noEmit`
Expected: verde (la validación funcional llega en Task 10).

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/nn/session.ts packages/engine/src/nn/evaluator.ts
git commit -m "feat(engine): NNEvaluator sobre onnxruntime-web (split head-0, miscvalue, fp16 decode)"
```

---

### Task 10: Test de referencia end-to-end vs kata-raw-nn (Node + ONNX)

Gate de correctitud del encoding + evaluador: encoder NCHW → ONNX fp32 (en Node, wasm EP — ya verificado que corre, `fuentes.md §0`) → postproceso, comparado contra los fixtures `kata-raw-nn` de Task 0. Corre bajo un script aparte (`test:nn`), no en la suite Vitest normal.

**Files:**
- Create: `packages/engine/tests/nn.reference.test.ts`
- Modify: `packages/engine/package.json` (script `test:nn`)

**Interfaces:**
- Consumes: `OnnxEvaluator` (Task 9), `fillFeaturesV7NCHW` (Task 5), `postprocessKataGoV8` (Task 7), fixtures (Task 0).

- [ ] **Step 1: Test que falla**

`packages/engine/tests/nn.reference.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { buildGameState } from '../src/encoding/gameState'
import { fillFeaturesV7NCHW, SPATIAL_CHANNELS_V7 } from '../src/encoding/featuresV7'
import { OnnxEvaluator } from '../src/nn/evaluator'
import { postprocessKataGoV8 } from '../src/vendor/web-katrain/evalV8'

const MODEL = 'packages/engine/models/b18c384nbt-kata1.fp32.onnx'
const DIR = 'packages/engine/tests/fixtures/reference'

describe('encoder + ONNX vs kata-raw-nn (fp32)', () => {
  for (const f of readdirSync(DIR)) {
    it(`coincide en ${f}`, async () => {
      const fx = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
      const N = fx.boardSize
      setBoardSize(N)
      const moves = fx.moves.map(([c, v]: [string, string]) => ({ color: c === 'b' ? 'black' : 'white', vertex: gtpToVertex(v, N) }))
      const state = buildGameState({ boardSize: N, komi: fx.komi, rules: fx.rules, handicap: 0, moves })
      const bin = new Float32Array(N * N * SPATIAL_CHANNELS_V7), global = new Float32Array(19)
      fillFeaturesV7NCHW({ state, outSpatial: bin, outGlobal: global })
      const ev = await OnnxEvaluator.create(MODEL, { ep: 'wasm' })  // dtype fp32
      const raw = await ev.evaluate({ bin, global, meta: null, batch: 1, includeOwnership: true })
      const pp = postprocessKataGoV8({ nextPlayer: state.currentPlayer, valueLogits: raw.value, scoreValue: raw.scoreValue })
      // winrate en persp. Blanca del fixture:
      const whiteWin = state.currentPlayer === 'black' ? 1 - pp.blackWinProb : pp.blackWinProb
      expect(whiteWin).toBeCloseTo(fx.whiteWin, 2)                    // |Δ| ≲ 0.01
      expect(-pp.blackScoreLead * (state.currentPlayer === 'black' ? 1 : -1)).toBeCloseTo(fx.whiteLead, 1) // ≲0.3? usar delta explícito
      // argmax de policy coincide (sobre legales)
      expect(argmaxLegal(raw.policy, state)).toBe(argmaxLegal(fixturePolicy(fx), state))
    })
  }
})
// gtpToVertex, argmaxLegal, fixturePolicy: helpers locales.
```

- [ ] **Step 2: Script test:nn + verificar que falla**

`package.json`: `"test:nn": "vitest run tests/nn.reference.test.ts"`. (Aislado porque carga ONNX y tarda.)

Run: `npm run -w @tengen/engine test:nn`
Expected: FAIL — helpers/`OnnxEvaluator.create` por implementar, o discrepancia inicial que revela un bug de encoding.

- [ ] **Step 3: Depurar hasta tolerancia**

Si el argmax no coincide, es casi seguro (a) layout NHWC/NCHW mal, o (b) el orden de `miscvalue`/`policy` del ONNX difiere del asumido (`decisiones-adaptacion.md §4` avisa: verificar contra el export real). Ajustar el split/mapeo en `OnnxEvaluator` y registrar el orden real en `decisiones-adaptacion.md`. Confirmar que el grafo emite **logits crudos** (no ya-softmaxeados) — si no, quitar el postproceso redundante.

- [ ] **Step 4: Verificar que pasa**

Run: `npm run -w @tengen/engine test:nn`
Expected: PASS en todos los fixtures dentro de tolerancia (winrate ≲0.01, lead ≲0.3, argmax + top-5).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/tests/nn.reference.test.ts packages/engine/package.json
git commit -m "test(engine): referencia end-to-end encoder+ONNX vs kata-raw-nn (fp32, Node)"
```

---

### Task 11: Human SL en juego (genMove por rango)

Uso de Human SL: `meta_input` por rango + muestreo de la policy humana con temperatura por tramo + guarda de pase (el pase lo decide la lógica normal, no la red humana — `humanSLChosenMoveIgnorePass=true`).

**Files:**
- Create: `packages/engine/src/humansl.ts`
- Test: `packages/engine/tests/humansl.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function rankTemperature(rank: HumanRank): number  // kyu ~0.85→dan ~0.70..0.25 (fuentes.md §5)
  export function sampleHumanMove(args: {
    policy: Float32Array; policyPass: number; state: GameState
    rank: HumanRank; rng: () => number
  }): Move   // muestrea ~ policy^(1/temp) sobre legales; pase con guarda
  ```

- [ ] **Step 1: Test que falla**

`packages/engine/tests/humansl.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { buildGameState } from '../src/encoding/gameState'
import { sampleHumanMove, rankTemperature } from '../src/humansl'
import { mulberry32 } from '../src/testutil/rng'

describe('Human SL', () => {
  it('temperatura decrece de kyu a dan', () => {
    expect(rankTemperature('20k')).toBeGreaterThan(rankTemperature('9d'))
  })
  it('muestrea una jugada legal; con temp→0 elige el máximo de policy', () => {
    const N = 9; setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const policy = new Float32Array(N * N); policy[40] = 10 // centro dominante
    const m = sampleHumanMove({ policy, policyPass: -20, state, rank: '9d', rng: mulberry32(1) })
    expect(m.vertex).toEqual({ x: 4, y: 4 })
  })
  it('no pasa cuando hay jugadas normales y la policy de pase es baja', () => {
    const N = 9; setBoardSize(N)
    const state = buildGameState({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] })
    const policy = new Float32Array(N * N).fill(1)
    const m = sampleHumanMove({ policy, policyPass: -50, state, rank: '5k', rng: mulberry32(2) })
    expect(m.vertex).not.toBe('pass')
  })
})
```

- [ ] **Step 2..4: Implementar, verificar, y confirmar**

`humansl.ts`: `rankTemperature` interpola por tramo (`fuentes.md §5`: 5k 0.85→0.70, 9d 0.70→0.25; v1 puede usar un mapa por rango). `sampleHumanMove`: softmax sobre legales de `policy` con `1/temp`, muestreo con `rng`; la guarda de pase ignora `policyPass` salvo que no queden jugadas razonables (v1: solo pasar si todas las legales tienen prob despreciable). Run: `npm test -w @tengen/engine -- humansl` hasta PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/humansl.ts packages/engine/tests/humansl.test.ts
git commit -m "feat(engine): Human SL genMove por rango (temperatura + guarda de pase)"
```

---

### Task 12: LocalEngine (interfaz Engine completa)

Ensambla `Engine`: `init` (crea `OnnxEvaluator` con la red y `setBoardSize`), `genMove` (kata = MCTS por visitas → `moves[order===0]`; humano = `sampleHumanMove` con `meta`), `analyze` (MCTS con updates incrementales), `stop` (cancelación cooperativa). Convierte perspectivas a Negro para la API pública.

**Files:**
- Create: `packages/engine/src/engine.ts`
- Modify: `packages/engine/src/index.ts` (export `LocalEngine`)
- Test: `packages/engine/tests/engine.test.ts` (con `OnnxEvaluator` inyectable → usa mock para no requerir ONNX)

**Interfaces:**
- Produces: `export class LocalEngine implements Engine`. Constructor acepta una `evaluatorFactory` inyectable (para tests con mock; en prod crea `OnnxEvaluator`).
  ```ts
  export class LocalEngine implements Engine {
    constructor(deps?: { evaluatorFactory?: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator> })
    init(config): Promise<void>
    genMove(pos, opts): Promise<Move>
    analyze(pos, opts, onUpdate): CancelFn
    stop(): void
  }
  ```

- [ ] **Step 1: Test que falla**

`packages/engine/tests/engine.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { LocalEngine } from '../src/index'
// reutiliza el mockEvaluator de mcts.test (extraer a testutil si conviene)

describe('LocalEngine', () => {
  it('genMove kata devuelve una jugada legal en perspectiva de Negro', async () => {
    const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N) })
    await eng.init({ network: 'b18', boardSize: 9 })
    const move = await eng.genMove(
      { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] },
      { level: { kind: 'kata', visits: 100 } },
    )
    expect(move.color).toBe('black')
    expect(move.vertex).not.toBe('pass')
  })
  it('analyze emite al menos un update y stop lo cancela', async () => {
    const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N) })
    await eng.init({ network: 'b18', boardSize: 9 })
    const updates: number[] = []
    const cancel = eng.analyze(
      { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] },
      { visits: 500 }, (a) => updates.push(a.visits),
    )
    await new Promise((r) => setTimeout(r, 50))
    cancel()
    expect(updates.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2..4: Implementar y verificar**

`engine.ts`: `init` guarda `evaluator` + `setBoardSize`; `genMove` ramifica por `opts.level.kind`; `analyze` corre `MctsSearch.run` en bucle emitiendo `getAnalysis` cada ~N visitas hasta `visits`/cancel; `stop`/`CancelFn` setean un flag leído por `shouldAbort`. Convertir `MoveAnalysis`/`Analysis` a perspectiva de Negro. Run hasta PASS: `npm test -w @tengen/engine -- engine`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/engine.ts packages/engine/src/index.ts packages/engine/tests/engine.test.ts
git commit -m "feat(engine): LocalEngine implementa la interfaz Engine (genMove/analyze/stop)"
```

---

### Task 13: Web Worker (protocolo tipado + client + smoke)

Envuelve `LocalEngine` en un Web Worker con protocolo tipado (id-correlación, cola serial obligatoria por el scratch no-reentrante, Transferables para los Float arrays, par update/result para `analyze` en streaming). `WorkerEngine` implementa `Engine` desde el hilo principal. Página dev de smoke manual (browser).

**Files:**
- Create: `packages/engine/src/worker/protocol.ts`, `packages/engine/src/worker/engine.worker.ts`, `packages/engine/src/worker/client.ts`, `packages/engine/engine-smoke.html`
- Modify: `packages/engine/src/index.ts` (export `WorkerEngine`), `packages/engine/vite.config.ts` (servir la smoke page)
- Test: `packages/engine/tests/protocol.test.ts` (serialización pura, sin Worker real)

**Interfaces:**
- Produces:
  ```ts
  export type WorkerRequest =
    | { type: 'init'; id: number; network: NetworkId; boardSize: BoardSize }
    | { type: 'genMove'; id: number; pos: Position; level: RankLevel }
    | { type: 'analyze'; id: number; pos: Position; visits: number }
    | { type: 'stop'; id: number }
  export type WorkerResponse =
    | { type: 'ready'; id: number }
    | { type: 'move'; id: number; move: Move }
    | { type: 'analysis'; id: number; analysis: Analysis; final: boolean }
    | { type: 'error'; id: number; message: string }
  export class WorkerEngine implements Engine { constructor(worker: Worker) }
  ```

- [ ] **Step 1: Test que falla (protocolo puro)**

`packages/engine/tests/protocol.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { encodeRequest, decodeResponse, transferablesOf } from '../src/worker/protocol'

describe('protocolo Worker', () => {
  it('round-trip de una request init', () => {
    const req = { type: 'init', id: 1, network: 'b18', boardSize: 19 } as const
    expect(decodeResponse(encodeRequest(req) as any)).toBeDefined // estructura estable
  })
  it('extrae Transferables del ownership de una analysis', () => {
    const analysis = { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits: 10, moves: [], ownership: new Float32Array(361) }
    const t = transferablesOf({ type: 'analysis', id: 2, analysis, final: false } as any)
    expect(t).toContain(analysis.ownership.buffer)
  })
})
```

- [ ] **Step 2..4: Implementar worker + client + smoke; verificar**

`protocol.ts`: tipos + helpers `transferablesOf` (extrae `.buffer` de `ownership`/policy arrays). `engine.worker.ts`: instancia `LocalEngine`, `self.onmessage` encola en `queue = queue.then(handle)` (serial), responde con `self.postMessage(msg, transferables)`. `client.ts`: `WorkerEngine` mantiene `Map<id,{resolve,reject}>` + `onUpdate` por id; `analyze` devuelve `CancelFn` que postea `stop`. `engine-smoke.html`: crea el Worker, `init` + `genMove` en el tablero vacío, imprime la jugada (verificación manual en Chrome). Run `npm test -w @tengen/engine -- protocol` hasta PASS.

- [ ] **Step 5: Smoke manual + commit**

Run: `npm run -w @tengen/engine bench` no debe romperse; abrir `engine-smoke.html` en Chrome (requiere modelo descargado + WebGPU) y confirmar que devuelve una jugada. Luego:
```bash
git add packages/engine/src/worker packages/engine/engine-smoke.html packages/engine/vite.config.ts packages/engine/src/index.ts packages/engine/tests/protocol.test.ts
git commit -m "feat(engine): Web Worker (protocolo tipado + WorkerEngine + smoke page)"
```

---

### Task 14: Cierre — typecheck, suite completa y verificación de no-regresión

**Files:** ninguno nuevo (verificación).

- [ ] **Step 1: Suite completa + typecheck + referencia**

Run:
```bash
npm test -w @tengen/engine
npx -w @tengen/engine tsc --noEmit
npm run -w @tengen/engine test:nn   # requiere modelos descargados
```
Expected: todas verdes. `git diff --stat` no debe tocar `src/bench/` salvo el import de `f16` (Task 2).

- [ ] **Step 2: Bench intacto**

Run: `npm run bench` (abre Chrome). Expected: la matriz de fase 0 sigue corriendo (no se rompió por mover `f16.ts`).

- [ ] **Step 3: Check de licencias**

Verificar que ningún archivo de `src/vendor/web-katrain/` proviene de Kaya (solo de web-katrain, MIT) y que todos llevan cabecera + entrada en `THIRD-PARTY-LICENSES`. `grep -rL "web-katrain" packages/engine/src/vendor/web-katrain/` debe salir vacío.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "chore(engine): cierre de la fase engine — suite verde, bench intacto, licencias en orden"
```

---

## Self-Review

**1. Cobertura de la spec.**
- *Encoding testeado contra KataGo desktop*: Task 0 (fixtures `kata-raw-nn`) + Task 10 (end-to-end fp32) + oráculo diferencial NHWC/NCHW (Task 5). ✓
- *MCTS con red mock determinista*: Task 8 (mock evaluator, PUCT/FPU/virtual-loss, `moves[order===0]`, determinismo). ✓
- *Niveles 20k–9d + visitas*: Task 6 (meta[192] por rango), Task 11 (genMove humano por rango), Task 12 (`RankLevel` kata=visitas / human=rango). ✓
- *Interfaz `Engine`*: Task 1 (tipos) + Task 12 (`LocalEngine`) + Task 13 (`WorkerEngine`). ✓
- *Web Worker*: Task 13. ✓
- *Reglas chinas y japonesas (KO_SIMPLE, sin encore)*: constraint global + encoder (Task 5) + fixtures por regla (Task 0). ✓
- *onnxruntime-web / WebGPU / OPFS*: evaluador ONNX (Task 9), fuente por URL/ArrayBuffer para OPFS (Task 9), WebGPU en el Worker/smoke (Task 13). ✓ (La caché OPFS concreta se implementa en `apps/web`/`worker`, fuera del paquete `engine`; el evaluador ya acepta `ArrayBuffer`.)

**2. Placeholders.** Task 0 (`gen-reference.mjs`) y Task 9 (`OnnxEvaluator.evaluate`) describen lógica con firmas y contrato exactos pero difieren detalles de implementación (parsing GTP, orden de outputs ONNX) porque **dependen de verificar el export real** — el plan marca explícitamente ese punto de verificación (Task 10 step 3) en vez de inventar índices. No son placeholders ocultos: son el riesgo documentado en `decisiones-adaptacion.md §4`. El resto lleva código o firmas concretas.

**3. Consistencia de tipos.** `NNEvaluator`/`RawEval` (Task 8) los consume `OnnxEvaluator` (Task 9) y el mock (Task 8 test) con la misma firma. `GameState` (Task 5) fluye a `fillFeaturesV7NCHW` (Task 5), `createSearch` (Task 8) y el test de referencia (Task 10). `Engine`/`Position`/`Move`/`Analysis` (Task 1) son idénticos en `LocalEngine` (Task 12) y `WorkerEngine` (Task 13). `HumanRank` (Task 1) lo usan `metaV1` (Task 6) y `humansl` (Task 11).

**Conflicto resuelto (destacado):** policy head-0 pura con `policyOptimism=0` (constraint global + Task 8 step 2e + Task 9 split), zanjando la contradicción `fuentes.md §3` vs. el optimism-mix del port.
