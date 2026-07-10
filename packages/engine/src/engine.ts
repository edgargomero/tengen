// `LocalEngine`: implementación client-side de la interfaz pública `Engine` (types.ts). Archivo 100%
// de tengen (no adapta upstream): ENSAMBLA las piezas ya construidas y testeadas (Tasks 5–11) —
// encoder V7, metaV1, MCTS PUCT, evaluador ONNX, muestreo Human SL— detrás de un único objeto.
// NO reimplementa nada. La perspectiva pública es SIEMPRE la de Negro (ver `mapAnalysis`).
//
// Acoplamiento "un Worker por tamaño de tablero": el encoder y el MCTS leen el global `BOARD_SIZE`
// (fijado por `setBoardSize`), así que una instancia de `LocalEngine` sirve un único `boardSize`,
// fijado en `init`. Cambiar de tamaño requiere otra instancia (otro Worker en Task 13).

import type {
  Analysis,
  BoardSize,
  CancelFn,
  Engine,
  Move,
  NetworkId,
  Position,
  RankLevel,
  Vertex,
} from './types'
import { setBoardSize } from './vendor/web-katrain/fastBoard'
import { buildGameState } from './encoding/gameState'
import { fillFeaturesV7NCHW, SPATIAL_CHANNELS_V7, GLOBAL_CHANNELS_V7 } from './encoding/featuresV7'
import { fillMetaV1, META_CHANNELS } from './encoding/metaV1'
import { createSearch } from './search/mcts'
import { sampleHumanMove } from './humansl'
import { OnnxEvaluator, type NNEvaluator } from './nn/evaluator'
import { mulberry32 } from './rng'

/**
 * Inverso de `moveToGtp` (analyzeMcts.ts:1003): `col = x >= 8 ? x + 1 : x` (salta 'I'),
 * letra = `65 + col`, número = `N - y`. Convierte un string GTP (columnas del `pv` del MCTS) al
 * `Vertex` público de tengen. Exportado para el test de frontera ('H'→x=7, 'J'→x=8).
 */
export function gtpToVertex(s: string, N: number): Vertex {
  if (s === 'pass') return 'pass'
  const col = s.charCodeAt(0) - 65 // 'A'=0 ... 'H'=7, 'J'=9 (nunca 'I'=8)
  const x = col > 8 ? col - 1 : col
  const y = N - parseInt(s.slice(1), 10)
  return { x, y }
}

/**
 * Traduce la salida de `MctsSearch.getAnalysis()` al `Analysis` público, en perspectiva de Negro.
 *
 * `getAnalysis()` ya devuelve `rootWinRate`/`winRate` como winrate de Negro y `rootScoreLead`/
 * `scoreLead` como lead de Negro (comentarios literales en analyzeMcts.ts:90-91). Por eso se mapean
 * DIRECTO. En cambio `winRateLost`/`pointsLost`/`relativePointsLost` SÍ están firmados por el jugador
 * al turno (`sign = currentPlayer==='black'?1:-1`, analyzeMcts.ts:2170): NO se usan.
 *
 * `ownership` se OMITE (undefined): `createSearch` usa `ownershipMode:'none'`, así que ese buffer es
 * ceros sin sentido.
 */
function mapAnalysis(g: ReturnType<import('./vendor/web-katrain/analyzeMcts').MctsSearch['getAnalysis']>, N: number): Analysis {
  return {
    winrate: g.rootWinRate,
    scoreLead: g.rootScoreLead,
    scoreStdev: g.rootScoreStdev,
    visits: g.rootVisits,
    moves: g.moves.map((m) => ({
      vertex: m.x < 0 ? ('pass' as const) : { x: m.x, y: m.y },
      visits: m.visits,
      winrate: m.winRate,
      scoreLead: m.scoreLead,
      prior: m.prior,
      pv: m.pv.map((s) => gtpToVertex(s, N)),
    })),
  }
}

/**
 * Factory por defecto del evaluador para uso standalone / browser-dev: mapea `NetworkId` al ONNX
 * servido en `/models/<archivo>.onnx` (ids de `bench/registry.ts`, servidos por el dev server) y
 * construye un `OnnxEvaluator` con WebGPU. El Worker (Task 13) y `apps/web` inyectan su propia factory
 * respaldada por OPFS/`ArrayBuffer`, así que en producción este default NO se ejercita.
 */
async function defaultEvaluatorFactory(net: NetworkId, boardSize: BoardSize): Promise<NNEvaluator> {
  const files: Record<NetworkId, string> = {
    b18: 'b18c384nbt-kata1.fp16.onnx',
    humanv0: 'b18c384nbt-humanv0.fp16.onnx',
    b10: '', // no convertida — se maneja abajo
  }
  if (net === 'b10') throw new Error('red b10 aún no convertida')
  return OnnxEvaluator.create(`/models/${files[net]}`, { boardSize, ep: 'webgpu' })
}

export class LocalEngine implements Engine {
  private readonly evaluatorFactory: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>
  private readonly rng: () => number
  private evaluator: NNEvaluator | undefined
  private boardSize: BoardSize | undefined
  /** Flag ÚNICO de cancelación cooperativa: leído por `shouldAbort` en `run()`; lo alzan tanto la
   *  `CancelFn` de `analyze` como `stop()`. Se resetea al entrar a `genMove`/`analyze`. */
  private cancelled = false

  constructor(deps?: {
    evaluatorFactory?: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>
    seed?: number
  }) {
    this.evaluatorFactory = deps?.evaluatorFactory ?? defaultEvaluatorFactory
    // RNG persistente: avanza entre `genMove` humanos → una partida reproducible por `seed`.
    this.rng = mulberry32(deps?.seed ?? 1)
  }

  async init(config: { network: NetworkId; boardSize: BoardSize }): Promise<void> {
    setBoardSize(config.boardSize)
    this.boardSize = config.boardSize
    this.evaluator = await this.evaluatorFactory(config.network, config.boardSize)
  }

  async genMove(pos: Position, opts: { level: RankLevel }): Promise<Move> {
    this.cancelled = false
    const evaluator = this.requireInit(pos)

    if (opts.level.kind === 'kata') {
      const state = buildGameState(pos)
      const search = await createSearch({ evaluator, state })
      await search.run({
        visits: opts.level.visits,
        maxTimeMs: 600_000,
        batchSize: 8,
        shouldAbort: () => this.cancelled,
      })
      const a = search.getAnalysis({ topK: 1, analysisPvLen: 0 })
      const best = a.moves.find((m) => m.order === 0)
      if (best === undefined) return { color: state.currentPlayer, vertex: 'pass' }
      return { color: state.currentPlayer, vertex: best.x < 0 ? 'pass' : { x: best.x, y: best.y } }
    }

    // opts.level.kind === 'human'
    if (!evaluator.hasMeta) {
      throw new Error(
        'genMove human requiere una red con meta_input (humanv0); el evaluador actual no tiene hasMeta',
      )
    }
    const state = buildGameState(pos)
    const N = state.boardSize
    const bin = new Float32Array(N * N * SPATIAL_CHANNELS_V7)
    const global = new Float32Array(GLOBAL_CHANNELS_V7)
    fillFeaturesV7NCHW({ state, outSpatial: bin, outGlobal: global })
    const meta = new Float32Array(META_CHANNELS)
    fillMetaV1({ rank: opts.level.rank, boardArea: N * N, out: meta })
    const raw = await evaluator.evaluate({ bin, global, meta, batch: 1, includeOwnership: false })
    return sampleHumanMove({
      policy: raw.policy,
      policyPass: raw.policyPass[0]!,
      state,
      rank: opts.level.rank,
      rng: this.rng,
    })
  }

  // Extensión de Task 13 (retrocompatible): `hooks` opcionales para señalar completado natural y
  // error. Añadir parámetros OPCIONALES mantiene `implements Engine` (el método de la interfaz es
  // `(pos,opts,onUpdate)=>CancelFn`; un impl con params opcionales extra es asignable). Los callers de
  // Task 12 (sin hooks) conservan el comportamiento previo: `analyze` seguía tragando errores en
  // silencio y no señalaba fin, y sin ese contrato el Worker no podría emitir `{final:true}`/`error`.
  analyze(
    pos: Position,
    opts: { visits: number },
    onUpdate: (a: Analysis) => void,
    hooks?: { onDone?: (a: Analysis) => void; onError?: (e: unknown) => void },
  ): CancelFn {
    this.cancelled = false
    const cancel: CancelFn = () => {
      this.cancelled = true
    }
    void (async () => {
      try {
        const evaluator = this.requireInit(pos)
        const state = buildGameState(pos)
        const N = state.boardSize
        const search = await createSearch({ evaluator, state })
        const CHUNK = 32
        let target = 0
        let last: Analysis | undefined
        while (target < opts.visits && !this.cancelled) {
          target = Math.min(target + CHUNK, opts.visits)
          await search.run({
            visits: target,
            maxTimeMs: 600_000,
            batchSize: 8,
            shouldAbort: () => this.cancelled,
          })
          if (this.cancelled) break
          last = mapAnalysis(search.getAnalysis({ topK: 30, analysisPvLen: 10 }), N)
          onUpdate(last)
        }
        // `onDone` señala SÓLO el completado natural (target ≥ visits, sin cancelar). La cancelación NO
        // dispara ningún hook (el Worker resuelve la cancelación client-side; no emite mensaje).
        if (!this.cancelled && last !== undefined) hooks?.onDone?.(last)
      } catch (e) {
        // Sin hooks (callers de Task 12): traga en silencio para no rechazar una promesa flotante
        // (rompe vitest). Con hook, el Worker traduce el error a un mensaje 'error'.
        hooks?.onError?.(e)
      }
    })()
    return cancel
  }

  stop(): void {
    // Mismo flag que la `CancelFn` de `analyze`: leído por `shouldAbort` en `run()`. También aborta un
    // `genMove` kata en vuelo.
    this.cancelled = true
  }

  /** Valida que se llamó `init()` y que el tablero de `pos` coincide con el de esta instancia
   *  (acoplamiento "un Worker por tamaño"). Devuelve el evaluador ya no-undefined para que TS lo estreche. */
  private requireInit(pos: Position): NNEvaluator {
    if (this.evaluator === undefined || this.boardSize === undefined) {
      throw new Error('LocalEngine.init() debe llamarse antes de genMove/analyze')
    }
    if (pos.boardSize !== this.boardSize) {
      throw new Error(
        `LocalEngine inicializado para ${this.boardSize}x${this.boardSize}, recibió posición ${pos.boardSize}x${pos.boardSize} (una instancia por tamaño de tablero)`,
      )
    }
    return this.evaluator
  }
}
