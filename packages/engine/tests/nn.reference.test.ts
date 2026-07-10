// Test de referencia end-to-end (Task 10): valida el pipeline completo del motor —
// buildGameState → fillFeaturesV7NCHW → OnnxEvaluator (ONNX fp32, EP wasm en Node) →
// postprocessKataGoV8 — contra los 10 fixtures `kata-raw-nn` de KataGo desktop (Task 0).
//
// Aislado de la suite normal: carga un ONNX de 116 MB y corre inferencia real (varios segundos),
// así que vive en `vitest.nn.config.ts` / `npm run test:nn`, no en `npm test`. El modelo es
// gitignored (`scripts/download-models.sh` lo descarga) — si no está, este archivo hace SKIP.
//
// Un spike previo (de-risk de esta task, ver `.superpowers/sdd/task-10-brief.md`) corrió este mismo
// pipeline sobre los 10 fixtures y confirmó que el encoding es correcto; este archivo transcribe esa
// validación (orientación, perspectiva y tolerancias YA MEDIDAS), no las re-deriva.
import { afterAll, describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { BoardSize, Move, Position } from '../src/types'
import { setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { buildGameState } from '../src/encoding/gameState'
import { fillFeaturesV7NCHW, SPATIAL_CHANNELS_V7, GLOBAL_CHANNELS_V7 } from '../src/encoding/featuresV7'
import { OnnxEvaluator } from '../src/nn/evaluator'
import { postprocessKataGoV8 } from '../src/vendor/web-katrain/evalV8'

// --- Rutas portables (nada de `/Users/...` hardcodeado) ---------------------------------------
//
// NOTA sobre una discrepancia con el brief: el snippet propuesto ahí
// (`req.resolve('onnxruntime-web/package.json')`) lanza `ERR_PACKAGE_PATH_NOT_EXPORTED` con la
// versión instalada (su `exports` map no expone el subpath `./package.json`), verificado
// empíricamente. En su lugar resolvemos el entry principal del paquete (`.` → bajo Node,
// `dist/ort.node.min.js`, condiciones `node`+`require` de `createRequire`) y tomamos su `dirname`:
// mismo directorio `dist/` que necesita `wasmPaths`, sin depender de un subpath frágil.
const req = createRequire(import.meta.url)
const ORT_DIST = dirname(req.resolve('onnxruntime-web')) + '/'
const HERE = dirname(fileURLToPath(import.meta.url))
const MODEL = resolve(HERE, '../models/b18c384nbt-kata1.fp32.onnx')
const DIR = resolve(HERE, 'fixtures/reference')

// --- Forma de los fixtures `kata-raw-nn` (Task 0) ---------------------------------------------
type FixtureJSON = {
  boardSize: number
  komi: number
  rules: 'chinese' | 'japanese'
  moves: [string, string][] // [color 'b'|'w', vértice GTP]
  nextPlayer: 'b' | 'w'
  whiteWin: number
  whiteLead: number
  policy: (number | null)[] // probabilidades post-softmax de KataGo; null = ilegal
  policyPass: number
  whiteOwnership: number[]
}

const GTP_COLS = 'ABCDEFGHJKLMNOPQRST' // letras GTP, sin la 'I'

/** GTP → vértice del board interno. Orientación resuelta en el spike de-risk:
 *  `y = N - rank` hace que el índice `y·N+x` coincida EXACTO con el índice impreso de los
 *  fixtures (sin flip). Evidencia: Q16→(15,3)/idx72, C4→(2,15)/idx287 en 19×19. */
function gtpToVertex(gtp: string, n: number): { x: number; y: number } {
  const col = gtp[0]
  if (!col) throw new Error(`gtpToVertex: vértice GTP vacío`)
  const rank = parseInt(gtp.slice(1), 10)
  return { x: GTP_COLS.indexOf(col.toUpperCase()), y: n - rank }
}

/** Softmax de KataGo sobre las casillas legales MÁS el pase, como UNA sola distribución (comparten
 *  el mismo `max`/`sum`) — así es como KataGo normaliza la policy (tablero + pase juntos). Hace falta
 *  porque el modelo devuelve logits crudos y el fixture trae probabilidades post-softmax (incluido
 *  `policyPass`). Devuelve las probabilidades del tablero (`NaN` en ilegales) y la del pase.
 *
 *  Incluir el pase en la MISMA normalización es lo que hace que `passProb` dependa de verdad de
 *  `raw.policyPass`: si se normalizara solo sobre el tablero, `Σ=1` por construcción y `passProb`
 *  saldría ~0 sin tocar el logit de pase — una aserción vacía (hallazgo del review de Task 10). */
function softmaxLegalWithPass(
  logits: ArrayLike<number>,
  passLogit: number,
  legal: boolean[],
  n: number,
): { board: Float32Array; pass: number } {
  let max = passLogit
  for (let i = 0; i < n * n; i++) if (legal[i] && logits[i]! > max) max = logits[i]!
  const board = new Float32Array(n * n)
  let sum = Math.exp(passLogit - max)
  for (let i = 0; i < n * n; i++) {
    if (legal[i]) {
      const e = Math.exp(logits[i]! - max)
      board[i] = e
      sum += e
    } else {
      board[i] = NaN
    }
  }
  for (let i = 0; i < n * n; i++) if (legal[i]) board[i] = board[i]! / sum
  return { board, pass: Math.exp(passLogit - max) / sum }
}

/** Índice legal de mayor valor. El argmax es invariante al softmax (monótono), así que sirve
 *  igual sobre logits crudos (modelo) o probabilidades (fixture). `null`/`undefined` (ilegal en
 *  el fixture) se tratan igual que `!legal[i]`. */
function argmaxLegal(values: ArrayLike<number | null | undefined>, legal: boolean[]): number {
  let best = -1
  let bestVal = -Infinity
  for (let i = 0; i < legal.length; i++) {
    if (!legal[i]) continue
    const v = values[i]
    if (v === null || v === undefined) continue
    if (v > bestVal) {
      bestVal = v
      best = i
    }
  }
  return best
}

/** Los `k` índices legales de mayor valor, orden descendente (tolera permutaciones de casi-empate
 *  al comparar argmax del modelo contra el top-k del fixture, no solo el argmax exacto). */
function topKLegal(values: ArrayLike<number | null | undefined>, legal: boolean[], k: number): number[] {
  const idxs: number[] = []
  for (let i = 0; i < legal.length; i++) if (legal[i]) idxs.push(i)
  idxs.sort((a, b) => (values[b] ?? -Infinity) - (values[a] ?? -Infinity))
  return idxs.slice(0, k)
}

/** Máscara de legalidad del fixture: KataGo marca las casillas ilegales con `policy[i] === null`. */
function fixtureLegalMask(fx: FixtureJSON): boolean[] {
  return fx.policy.map((v) => v !== null)
}

function toBoardSize(n: number): BoardSize {
  if (n === 9 || n === 13 || n === 19) return n
  throw new Error(`tamaño de tablero no soportado por un fixture: ${n}`)
}

// Fixtures asimétricos donde la orientación se valida con un gate DURO (argmax exacto). El resto
// de los fixtures (simétricos o casi-empate: hoshi degenerados, ladder-fails, seki) solo pasa el
// gate SUAVE (top-5) — el mismatch ahí es ULP de casi-empate, no un bug de orientación.
const STRICT_ARGMAX_FIXTURES = new Set(['opening-44', 'opening-34'])

describe('referencia end-to-end vs kata-raw-nn (encoder V7 + ONNX fp32, Node)', () => {
  if (!existsSync(MODEL)) {
    it.skip('modelo no descargado — corre packages/engine/scripts/download-models.sh', () => {})
    return
  }

  // Evaluator cacheado por tamaño de tablero: el modelo pesa 116 MB, no se recrea por fixture.
  const evaluators = new Map<number, Promise<OnnxEvaluator>>()
  function evaluatorFor(n: number): Promise<OnnxEvaluator> {
    let p = evaluators.get(n)
    if (!p) {
      p = OnnxEvaluator.create(MODEL, { boardSize: n, ep: 'wasm', wasmPaths: ORT_DIST })
      evaluators.set(n, p)
    }
    return p
  }

  afterAll(async () => {
    for (const p of evaluators.values()) await (await p).dispose()
  })

  const names = readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))

  for (const name of names) {
    it(
      name,
      async () => {
        const fx = JSON.parse(readFileSync(resolve(DIR, `${name}.json`), 'utf8')) as FixtureJSON
        const n = toBoardSize(fx.boardSize)
        const moves: Move[] = fx.moves.map(([c, v]) => ({
          color: c === 'b' ? 'black' : 'white',
          vertex: gtpToVertex(v, n),
        }))

        setBoardSize(n) // fastBoard usa estado global dimensionado por tablero — antes de buildGameState
        const position: Position = { boardSize: n, komi: fx.komi, rules: fx.rules, handicap: 0, moves }
        const state = buildGameState(position)

        const bin = new Float32Array(n * n * SPATIAL_CHANNELS_V7)
        const global = new Float32Array(GLOBAL_CHANNELS_V7)
        fillFeaturesV7NCHW({ state, outSpatial: bin, outGlobal: global })

        const ev = await evaluatorFor(n)
        const evalArgs = { bin, global, meta: null, batch: 1, includeOwnership: true }
        const raw = await ev.evaluate(evalArgs)

        // --- (deuda Task 9) forma ---
        expect(raw.policy.length).toBe(n * n)
        expect(raw.policyPass.length).toBe(1)
        expect(raw.value.length).toBe(3)
        expect(raw.scoreValue.length).toBe(4)
        expect(raw.ownership).toBeDefined()
        expect(raw.ownership!.length).toBe(n * n)

        // --- (deuda Task 9) finitud ---
        for (const v of raw.value) expect(Number.isFinite(v)).toBe(true)
        for (const v of raw.scoreValue) expect(Number.isFinite(v)).toBe(true)

        // --- (deuda Task 9) determinismo: misma entrada → misma salida, elemento a elemento ---
        const raw2 = await ev.evaluate(evalArgs)
        expect(Array.from(raw2.value)).toEqual(Array.from(raw.value))
        expect(Array.from(raw2.scoreValue)).toEqual(Array.from(raw.scoreValue))
        expect(Array.from(raw2.policy)).toEqual(Array.from(raw.policy))

        // --- postproceso + perspectiva Blanca ---
        // Fórmula CORREGIDA (de-risk del spike): NO ramificar por `currentPlayer` — postprocessKataGoV8
        // ya normaliza a perspectiva Negro usando `nextPlayer`, así que estas dos igualdades valen para
        // AMBOS turnos tal cual.
        const pp = postprocessKataGoV8({
          nextPlayer: state.currentPlayer,
          valueLogits: raw.value,
          scoreValue: raw.scoreValue,
        })
        const whiteWin = 1 - pp.blackWinProb - pp.blackNoResultProb
        const whiteLead = -pp.blackScoreLead

        // Tolerancias por régimen de reglas (medidas en el spike sobre los 10 fixtures): el
        // value/lead crudo bajo reglas japonesas (score territorial + tax de seki) diverge más entre
        // wasm-fp32 (este test) y katago-metal (generador de los fixtures, Task 0) SIN búsqueda de por
        // medio — no es un error de encoding: los globals de komi/reglas son correctos (confirmado por
        // los fixtures chinos, que dan value casi-exacto). No es papering-over: está respaldado por la
        // evidencia medida, ver `task-10-brief.md §5`.
        const winTol = fx.rules === 'japanese' ? 0.1 : 0.03
        const leadTol = fx.rules === 'japanese' ? 1.2 : 0.4
        expect(Math.abs(whiteWin - fx.whiteWin)).toBeLessThan(winTol)
        expect(Math.abs(whiteLead - fx.whiteLead)).toBeLessThan(leadTol)

        // --- policy: distribución (softmax conjunto tablero+pase sobre legales) y pase ---
        const legal = fixtureLegalMask(fx)
        const { board: smax, pass: passProb } = softmaxLegalWithPass(raw.policy, raw.policyPass[0]!, legal, n)
        let maxProbDiff = 0
        for (let i = 0; i < n * n; i++) {
          if (legal[i]) maxProbDiff = Math.max(maxProbDiff, Math.abs(smax[i]! - fx.policy[i]!))
        }
        expect(maxProbDiff).toBeLessThan(0.06)

        // `passProb` deriva del logit real `raw.policyPass[0]` (softmax conjunto) → ejercita la salida
        // de pase del evaluador contra el ground truth de KataGo (el único punto de la suite que lo hace).
        expect(Math.abs(passProb - fx.policyPass)).toBeLessThan(0.01)

        // --- argmax: gate suave (todos) + gate fuerte de orientación (asimétricos) ---
        const modelArgmax = argmaxLegal(raw.policy, legal)
        const top5Fixture = topKLegal(fx.policy, legal, 5)
        expect(top5Fixture).toContain(modelArgmax)

        if (STRICT_ARGMAX_FIXTURES.has(name)) {
          const fixtureArgmax = argmaxLegal(fx.policy, legal)
          expect(modelArgmax).toBe(fixtureArgmax)
        }
      },
      60_000,
    )
  }
})
