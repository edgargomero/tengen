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
  ClockConfig,
  ClockState,
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
import { computeBaseBudgetMs, timeManagementPolicy } from './search/timeManagementPolicy'

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

/** Token de cancelación POR-LLAMADA (Fase 3a Task 1, M-1): cada `genMove`/`analyze` crea el suyo y lo
 *  captura en su propia clausura (leído por `shouldAbort` en `run()`). Reemplaza el flag ÚNICO de
 *  instancia de antes, que hacía que cancelar UNA llamada cancelara TODAS las demás en vuelo/encoladas. */
type CancelToken = { cancelled: boolean }

export class LocalEngine implements Engine {
  private readonly evaluatorFactory: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>
  private readonly rng: () => number
  private evaluator: NNEvaluator | undefined
  private boardSize: BoardSize | undefined
  /** Token de la operación (`genMove`/`analyze`) actualmente activa: es lo único que `stop()` (global)
   *  puede tocar. Cada llamada se apunta a sí misma aquí al arrancar; la última en arrancar "gana" —
   *  mismo alcance que el flag único de antes, pero ahora conviviendo con tokens por-llamada para la
   *  `CancelFn` propia de cada `analyze` (que cancela SÓLO su propio token, nunca `activeToken`). */
  private activeToken: CancelToken | undefined
  /** Lector de reloj inyectable (Fase reloj, 2026-07-16) — mismo patrón que `evaluatorFactory`: en
   *  producción `performance.now()`, en tests un contador falso determinista. NUNCA leído desde
   *  `timeManagementPolicy` (función pura) — solo desde `runWithClock`, más abajo. */
  private readonly now: () => number

  constructor(deps?: {
    evaluatorFactory?: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>
    seed?: number
    now?: () => number
  }) {
    this.evaluatorFactory = deps?.evaluatorFactory ?? defaultEvaluatorFactory
    // RNG persistente: avanza entre `genMove` humanos → una partida reproducible por `seed`.
    this.rng = mulberry32(deps?.seed ?? 1)
    this.now = deps?.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  }

  async init(config: { network: NetworkId; boardSize: BoardSize }): Promise<void> {
    setBoardSize(config.boardSize)
    this.boardSize = config.boardSize
    this.evaluator = await this.evaluatorFactory(config.network, config.boardSize)
  }

  async genMove(
    pos: Position,
    opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } },
  ): Promise<Move> {
    const token: CancelToken = { cancelled: false }
    this.activeToken = token
    const evaluator = this.requireInit(pos)

    if (opts.level.kind === 'kata') {
      const state = buildGameState(pos)
      const search = await createSearch({ evaluator, state })
      if (opts.clock === undefined) {
        // Sin reloj: comportamiento byte-idéntico al de siempre.
        await search.run({
          visits: opts.level.visits,
          maxTimeMs: 600_000,
          batchSize: 8,
          shouldAbort: () => token.cancelled,
        })
      } else {
        await this.runWithClock(search, opts.level.visits, opts.clock, () => token.cancelled)
      }
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

  /**
   * Búsqueda kata con presupuesto de tiempo derivado del reloj (Opción B, spec
   * 2026-07-16-reloj-partida-design.md). Corre en CHUNKS (mismo patrón que `analyze()`, arriba),
   * consultando `timeManagementPolicy` tras cada uno: puede cortar antes (convergencia), seguir, o
   * extender el presupuesto UNA vez (posición difícil). El `maxTimeMs` de CADA chunk ya refleja el
   * tiempo restante del presupuesto vigente (no solo el corte entre-chunks): así el techo interno
   * que `MctsSearch.run` ya calcula (`analyzeMcts.ts:1750`) protege incluso DENTRO de un chunk ante
   * una inferencia lenta, no solo entre chunks.
   *
   * CHUNK=32 (mismo valor que `analyze()`): punto de partida razonable, no una constante sagrada —
   * si la verificación manual (Task 13 del plan) muestra cortes poco responsivos bajo WebGPU real,
   * ajustar a un valor menor es un cambio de una línea, sin tocar el resto de este método.
   */
  private async runWithClock(
    search: Awaited<ReturnType<typeof createSearch>>,
    visitsCap: number,
    clock: { config: ClockConfig; state: ClockState },
    shouldAbort: () => boolean,
  ): Promise<void> {
    const CHUNK = 32
    let budgetMs = computeBaseBudgetMs(clock.config, clock.state)
    let extended = false
    let target = 0
    const visitShareHistory: number[] = []
    const startedAt = this.now()

    while (target < visitsCap && !shouldAbort()) {
      const elapsedBeforeChunk = this.now() - startedAt
      target = Math.min(target + CHUNK, visitsCap)
      await search.run({
        visits: target,
        maxTimeMs: Math.max(budgetMs - elapsedBeforeChunk, 50),
        batchSize: 8,
        shouldAbort,
      })
      if (shouldAbort()) return

      const a = search.getAnalysis({ topK: 2, analysisPvLen: 0 })
      const top = a.moves.find((m) => m.order === 0)
      const second = a.moves.find((m) => m.order === 1)
      const totalVisits = a.moves.reduce((sum, m) => sum + m.visits, 0)
      visitShareHistory.push(top && totalVisits > 0 ? top.visits / totalVisits : 0)
      const valueGap = top && second ? Math.abs(top.winRate - second.winRate) : 1

      const decision = timeManagementPolicy({
        elapsedMsSoFar: this.now() - startedAt,
        budgetMs,
        visitShareHistory,
        valueGap,
        alreadyExtended: extended,
        inByoyomi: clock.state.inByoyomi,
        byoyomiPeriodMs: clock.config.byoyomiPeriodMs,
        byoyomiPeriodsRemaining: clock.state.byoyomiPeriodsRemaining,
      })
      if (decision === 'stop') return
      if (decision !== 'continue') {
        extended = true
        budgetMs = decision.extendTo
      }
    }
  }

  // `onError` (4º parámetro, Fase 3a Task 1, M-2): canal de error PÚBLICO por-llamada — antes sólo
  // existía vía `hooks` (uso interno del Worker) y los callers de Fase 2 (analyze con 3 args) tragaban
  // el error en silencio. `hooks` (5º parámetro, uso interno del Worker) conserva SÓLO `onDone`
  // (completado natural: target ≥ visits, sin cancelar) — `onError` se promovió a parámetro público.
  // Añadir parámetros OPCIONALES mantiene `implements Engine` (un impl con params opcionales extra al
  // final es asignable a la firma de la interfaz).
  //
  // Cancelación POR-LLAMADA (M-1): cada `analyze` crea su propio `CancelToken`, capturado en la
  // clausura de la `CancelFn` devuelta Y en el `shouldAbort` pasado al MCTS — cancelar ESTA llamada
  // nunca toca el token de otra `analyze`/`genMove` en vuelo o encolada.
  analyze(
    pos: Position,
    opts: { visits: number },
    onUpdate: (a: Analysis) => void,
    onError?: (e: unknown) => void,
    hooks?: { onDone?: (a: Analysis) => void },
  ): CancelFn {
    const token: CancelToken = { cancelled: false }
    this.activeToken = token
    const cancel: CancelFn = () => {
      token.cancelled = true
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
        while (target < opts.visits && !token.cancelled) {
          target = Math.min(target + CHUNK, opts.visits)
          await search.run({
            visits: target,
            maxTimeMs: 600_000,
            batchSize: 8,
            shouldAbort: () => token.cancelled,
          })
          if (token.cancelled) break
          last = mapAnalysis(search.getAnalysis({ topK: 50, analysisPvLen: 10 }), N)
          onUpdate(last)
        }
        // `onDone` señala SÓLO el completado natural (target ≥ visits, sin cancelar). La cancelación NO
        // dispara ningún hook (el Worker resuelve la cancelación client-side; no emite mensaje).
        if (!token.cancelled && last !== undefined) hooks?.onDone?.(last)
      } catch (e) {
        // Sin `onError` (callers de Fase 2, 3 args): traga en silencio para no rechazar una promesa
        // flotante (rompe vitest). Con `onError` (el Worker lo pasa siempre), lo propaga.
        onError?.(e)
      }
    })()
    return cancel
  }

  stop(): void {
    // Cancelación GLOBAL: corta lo que esté activo AHORA MISMO (el `genMove`/`analyze` más reciente en
    // arrancar), sin tocar tokens de operaciones ya finalizadas. Comportamiento equivalente al flag
    // único de antes, pero implementado sobre el token de la operación activa.
    if (this.activeToken !== undefined) this.activeToken.cancelled = true
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
