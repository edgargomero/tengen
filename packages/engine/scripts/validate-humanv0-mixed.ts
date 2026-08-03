/*
 * Valida `humanv0.mixed16.onnx` contra SÍ MISMO en fp32. Herramienta local, NO parte del producto.
 *
 *     npx tsx packages/engine/scripts/validate-humanv0-mixed.ts
 *
 * ── Por qué no alcanza el gate `test:nn` ──────────────────────────────────────────────────────
 * Los fixtures `kata-raw-nn` son de la red *kata*: sus policy/value son los de b18c384nbt-kata1, así
 * que compararlos contra humanv0 mediría la diferencia entre DOS REDES, no el efecto de la
 * conversión. Human SL no tiene vectores de referencia propios de KataGo desktop.
 *
 * La validación correcta para una conversión de precisión es la red contra su propia versión fp32:
 * mismo input exacto, dos binarios, y toda diferencia observada es atribuible a la conversión.
 *
 * ── Por qué esta red necesita su propia validación ────────────────────────────────────────────
 * humanv0 es la ÚNICA que consume `meta_input[192]` (`fillMetaV1`), un camino del grafo que b18 ni
 * siquiera tiene — o sea, un subgrafo que los 10/10 de b18 nunca ejercitaron. Y es exactamente donde
 * el fp16 ciego anterior producía NaN. Por eso se prueban varios rangos: el termómetro de rango
 * ([6..73]) cambia el contenido de `meta_input`, y un overflow podría depender de él.
 *
 * ── Qué se mide, y por qué NO alcanza la diferencia de logit ──────────────────────────────────
 * Human SL no toma el argmax: `sampleHumanMove` MUESTREA de la policy con una temperatura que
 * depende del rango (0,85 en 20k → 0,30 en 9d). Entonces lo que decide si la red convertida "juega
 * igual" no es cuánto se movió un logit crudo, sino cuánto se movió la DISTRIBUCIÓN DE MUESTREO
 * real. Un umbral sobre el logit es además engañoso en los dos sentidos: una temperatura < 1 divide
 * el logit, así que AMPLIFICA en el exponente (d/T) cualquier diferencia.
 *
 * La métrica que acota el comportamiento observable es la distancia de variación total (TV) entre
 * las dos distribuciones de muestreo: TV = ½·Σ|p−q| es exactamente la cota superior de la
 * probabilidad de que las dos versiones elijan jugadas distintas. TV = 0,01 significa "se comportan
 * idénticamente el 99 % de las veces". Ese es el número que hay que mirar.
 */
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BoardSize, HumanRank, Move, Position } from '../src/types'
import { EMPTY, setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { rankTemperature } from '../src/humansl'
import { buildGameState } from '../src/encoding/gameState'
import { fillFeaturesV7NCHW, GLOBAL_CHANNELS_V7, SPATIAL_CHANNELS_V7 } from '../src/encoding/featuresV7'
import { fillMetaV1, META_CHANNELS } from '../src/encoding/metaV1'
import { OnnxEvaluator } from '../src/nn/evaluator'

const req = createRequire(import.meta.url)
// Mismo truco que `tests/nn.reference.test.ts`: el `exports` map de onnxruntime-web no expone
// `./package.json`, así que se resuelve el entry principal y se toma su directorio.
const ORT_DIST = dirname(req.resolve('onnxruntime-web')) + '/'
const HERE = dirname(fileURLToPath(import.meta.url))

const FP32 = resolve(HERE, '../models/b18c384nbt-humanv0.fp32.onnx')
const MIXED = resolve(HERE, '../models/b18c384nbt-humanv0.mixed16.onnx')
const FIXTURES = resolve(HERE, '../tests/fixtures/reference')

// ── Umbrales de aprobación, FIJADOS A PRIORI (antes de ver ningún resultado) ────────────────────
//
// El plan pedía "diferencia de logit del orden de 1e-2 o menor". Se conserva como dato REPORTADO,
// pero no como veredicto: mide la magnitud equivocada (ver cabecera). El veredicto lo dan los
// criterios de comportamiento.

/** Se reporta, no decide. Referencia del plan: en b18 la diferencia de logit fue 0,005. */
const LOGIT_REFERENCE = 1e-2

/** VEREDICTO. Cota superior de la probabilidad de que fp32 y mixto elijan jugadas distintas, sobre
 *  la distribución de muestreo REAL (con la temperatura del rango). 0,01 = coinciden el 99 % de las
 *  veces. Exigente a propósito: es la MISMA red, no dos implementaciones distintas. */
const TV_TOLERANCE = 0.01

/** VEREDICTO. Diferencia máxima de probabilidad post-softmax sin temperatura. Mismo umbral que usa
 *  el gate `test:nn` de b18 contra KataGo desktop — allá compara dos implementaciones enteras, así
 *  que acá, comparando una red contra sí misma, debería sobrar. */
const PROB_TOLERANCE = 0.06

const GTP_COLS = 'ABCDEFGHJKLMNOPQRST' // letras GTP, sin la 'I'

type FixtureJSON = {
  boardSize: number
  komi: number
  rules: 'chinese' | 'japanese'
  moves: [string, string][]
}

function gtpToVertex(gtp: string, n: number): { x: number; y: number } {
  const col = gtp[0]
  if (!col) throw new Error('gtpToVertex: vértice GTP vacío')
  return { x: GTP_COLS.indexOf(col.toUpperCase()), y: n - parseInt(gtp.slice(1), 10) }
}

function toBoardSize(n: number): BoardSize {
  if (n === 9 || n === 13 || n === 19) return n
  throw new Error(`tamaño de tablero no soportado: ${n}`)
}

/** Entradas del modelo para un fixture + un rango. Se calculan UNA vez y se pasan a los dos
 *  evaluadores: que el input sea literalmente el mismo objeto es lo que hace que la comparación
 *  aísle la conversión. */
function buildInput(fixtureName: string, rank: HumanRank): {
  bin: Float32Array
  global: Float32Array
  meta: Float32Array
  n: BoardSize
  /** Misma máscara de candidatas que usa `sampleHumanMove`: vacía y distinta del punto de ko. */
  legal: boolean[]
} {
  const fx = JSON.parse(readFileSync(resolve(FIXTURES, `${fixtureName}.json`), 'utf8')) as FixtureJSON
  const n = toBoardSize(fx.boardSize)
  const moves: Move[] = fx.moves.map(([c, v]) => ({
    color: c === 'b' ? 'black' : 'white',
    vertex: gtpToVertex(v, n),
  }))

  setBoardSize(n) // `fastBoard` tiene estado global dimensionado por tablero — antes de buildGameState
  const position: Position = { boardSize: n, komi: fx.komi, rules: fx.rules, handicap: 0, moves }
  const state = buildGameState(position)

  const bin = new Float32Array(n * n * SPATIAL_CHANNELS_V7)
  const global = new Float32Array(GLOBAL_CHANNELS_V7)
  fillFeaturesV7NCHW({ state, outSpatial: bin, outGlobal: global })

  const meta = new Float32Array(META_CHANNELS)
  // `rank` es un HumanRank DIRECTO, no un `{ kind: 'human', rank }` — ver `src/encoding/metaV1.ts`.
  fillMetaV1({ rank, boardArea: n * n, out: meta })

  const legal: boolean[] = []
  for (let i = 0; i < n * n; i++) legal.push(state.stones[i] === EMPTY && i !== state.koPoint)

  return { bin, global, meta, n, legal }
}

/** Softmax sobre las casillas legales con temperatura `temp` — la distribución de la que
 *  `sampleHumanMove` muestrea de verdad. Las ilegales quedan en 0 (no son candidatas). */
function softmaxLegal(logits: ArrayLike<number>, legal: boolean[], temp: number): Float64Array {
  const out = new Float64Array(legal.length)
  let max = -Infinity
  for (let i = 0; i < legal.length; i++) if (legal[i] && logits[i]! > max) max = logits[i]!
  let sum = 0
  for (let i = 0; i < legal.length; i++) {
    if (!legal[i]) continue
    const e = Math.exp((logits[i]! - max) / temp)
    out[i] = e
    sum += e
  }
  for (let i = 0; i < legal.length; i++) out[i] = out[i]! / sum
  return out
}

/** Distancia de variación total: ½·Σ|p−q|. Cota superior EXACTA de la probabilidad de que dos
 *  muestreos independientes de `p` y `q` den resultados distintos. */
function totalVariation(p: ArrayLike<number>, q: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < p.length; i++) sum += Math.abs(p[i]! - q[i]!)
  return sum / 2
}

/** Los `k` índices legales de mayor valor, en orden descendente. */
function topKLegal(values: ArrayLike<number>, legal: boolean[], k: number): number[] {
  const idxs: number[] = []
  for (let i = 0; i < legal.length; i++) if (legal[i]) idxs.push(i)
  idxs.sort((a, b) => values[b]! - values[a]!)
  return idxs.slice(0, k)
}

function countNaN(xs: ArrayLike<number>): number {
  let c = 0
  for (let i = 0; i < xs.length; i++) if (!Number.isFinite(xs[i]!)) c++
  return c
}

function argmax(xs: ArrayLike<number>): number {
  let best = -1
  let bestVal = -Infinity
  for (let i = 0; i < xs.length; i++) {
    if (xs[i]! > bestVal) {
      bestVal = xs[i]!
      best = i
    }
  }
  return best
}

/** Diferencia absoluta máxima elemento a elemento. NaN en cualquiera de los dos → Infinity, para
 *  que un NaN no se cuele como "diferencia 0" por la semántica de las comparaciones con NaN. */
function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!)
    if (!Number.isFinite(d)) return Infinity
    if (d > max) max = d
  }
  return max
}

function vertexLabel(idx: number, n: number): string {
  const x = idx % n
  const y = Math.floor(idx / n)
  return `${GTP_COLS[x]}${n - y} (idx ${idx})`
}

async function main(): Promise<void> {
  for (const [label, path] of [['fp32', FP32], ['mixto', MIXED]] as const) {
    if (!existsSync(path)) {
      console.error(`falta el modelo ${label}: ${path}`)
      process.exit(1)
    }
  }

  // Casos: tablero vacío y medio juego, en dos tamaños distintos, por dos rangos humanos separados
  // (el termómetro de rango llena una cantidad distinta de canales de `meta_input` en cada uno).
  const cases: Array<{ fixture: string; rank: HumanRank }> = [
    { fixture: 'empty-19', rank: '5k' },
    { fixture: 'empty-19', rank: '5d' },
    { fixture: 'endgame', rank: '5k' },
    { fixture: 'endgame', rank: '9d' },
  ]

  // Un evaluador por (modelo, tamaño de tablero): la sesión ONNX fija el tamaño al crearse.
  const evaluators = new Map<string, OnnxEvaluator>()
  const evaluatorFor = async (path: string, n: BoardSize): Promise<OnnxEvaluator> => {
    const key = `${path}:${n}`
    let ev = evaluators.get(key)
    if (!ev) {
      ev = await OnnxEvaluator.create(path, { boardSize: n, ep: 'wasm', wasmPaths: ORT_DIST })
      evaluators.set(key, ev)
    }
    return ev
  }

  let failures = 0

  for (const { fixture, rank } of cases) {
    const { bin, global, meta, n, legal } = buildInput(fixture, rank)
    const args = { bin, global, meta, batch: 1, includeOwnership: false }

    const fp32 = await (await evaluatorFor(FP32, n)).evaluate(args)
    const mixed = await (await evaluatorFor(MIXED, n)).evaluate(args)

    const nanPolicy = countNaN(mixed.policy)
    const nanValue = countNaN(mixed.value)
    const moveFp32 = argmax(fp32.policy)
    const moveMixed = argmax(mixed.policy)
    const dPolicy = maxAbsDiff(fp32.policy, mixed.policy)
    const dValue = maxAbsDiff(fp32.value, mixed.value)

    // La distribución de muestreo REAL: con la temperatura que `sampleHumanMove` usa para este rango.
    const temp = rankTemperature(rank)
    const tv = totalVariation(
      softmaxLegal(fp32.policy, legal, temp),
      softmaxLegal(mixed.policy, legal, temp),
    )
    // Sin temperatura: comparable con el `maxProbDiff` del gate de b18.
    const probDiff = maxAbsDiff(softmaxLegal(fp32.policy, legal, 1), softmaxLegal(mixed.policy, legal, 1))
    const top5Fp32 = topKLegal(fp32.policy, legal, 5)
    const top5Mixed = topKLegal(mixed.policy, legal, 5)
    const okTop5 = top5Fp32.join(',') === top5Mixed.join(',')

    // VEREDICTO: NaN + jugada + comportamiento de muestreo. El logit se reporta pero no decide.
    const okNaN = nanPolicy === 0 && nanValue === 0
    const okMove = moveFp32 === moveMixed
    const okTv = tv <= TV_TOLERANCE
    const okProb = probDiff <= PROB_TOLERANCE
    const ok = okNaN && okMove && okTv && okProb && okTop5
    if (!ok) failures++

    console.log(`\n── ${fixture} @ ${rank} (${n}×${n}, T=${temp.toFixed(2)}) ${ok ? 'OK' : 'FALLA'}`)
    console.log(`   NaN mixto        policy ${nanPolicy}, value ${nanValue}  ${okNaN ? 'ok' : '← FALLA'}`)
    console.log(
      `   jugada elegida   fp32 ${vertexLabel(moveFp32, n)} · mixto ${vertexLabel(moveMixed, n)}  ${okMove ? 'ok' : '← FALLA'}`,
    )
    console.log(`   top-5 legal      ${okTop5 ? 'idéntico y en el mismo orden  ok' : 'DIFIERE  ← FALLA'}`)
    console.log(
      `   TV muestreo      ${tv.toExponential(2)}  (≤ ${TV_TOLERANCE}) ${okTv ? 'ok' : '← FALLA'}` +
        `   → eligen distinto a lo sumo el ${(tv * 100).toFixed(2)} % de las veces`,
    )
    console.log(
      `   dif. máx. prob   ${probDiff.toExponential(2)}  (≤ ${PROB_TOLERANCE}) ${okProb ? 'ok' : '← FALLA'}`,
    )
    console.log(
      `   [informativo] dif. máx. logit: policy ${dPolicy.toExponential(2)}, value ${dValue.toExponential(2)} ` +
        `(referencia del plan ${LOGIT_REFERENCE.toExponential(0)}; en b18 fue 5e-3)`,
    )
  }

  for (const ev of evaluators.values()) await ev.dispose()

  console.log(
    failures === 0
      ? `\nAPROBADO — ${cases.length}/${cases.length} casos. humanv0.mixed16 se puede servir.`
      : `\nRECHAZADO — ${failures}/${cases.length} casos fallaron. NO servir humanv0.mixed16.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
