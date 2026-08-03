/*
 * Duelo de calibración entre dos motores. Herramienta local, NO parte del producto.
 *
 *     npx tsx packages/engine/scripts/duel.ts [--visits 25] [--rank 1k] [--max-moves 200]
 *                                             [--seed 1] [--games 2] [--board 19] [--out <dir>]
 *
 * ── Qué pregunta responde ─────────────────────────────────────────────────────────────────────
 * Los tres presets de fuerza de KataGo (`opponentStrength.ts`: 50/200/500 visitas) son etiquetas SIN
 * significado medido. La pregunta de producto es concreta: ¿puede un kyu ganarle a "Fuerza baja"?
 *
 * La hipótesis a FALSAR es que bajar visitas produce un jugador kyu. La policy de b18c384nbt ya sabe
 * dónde se juega: con pocas visitas elige aperturas razonables, formas correctas y buena dirección; lo
 * que se pierde es la LECTURA TÁCTICA, no el criterio posicional. Si la hipótesis es falsa, el
 * oponente abre como un dan y de pronto pierde un grupo por no leer una escalera — lo contrario de un
 * kyu humano. Esa es la razón por la que el equipo de KataGo entrenó las redes Human SL.
 *
 * ── El piso de 16 visitas ─────────────────────────────────────────────────────────────────────
 * `MctsSearch.run()` fuerza `Math.max(16, ...)` (analyzeMcts.ts:1749): pedir 1, 5 o 10 devuelve 16
 * igual. El KataGo más débil alcanzable SIN tocar el motor es 16 visitas, y el default de 25 está
 * apenas por encima. Si 25 resulta muy fuerte, el margen que queda bajando visitas es angosto y la
 * respuesta pasa a ser otra palanca (temperatura sobre las visitas, ruido en la raíz) o Human SL.
 *
 * ── Por qué la partida no llega al final ──────────────────────────────────────────────────────
 * Human SL NUNCA pasa: es deliberado (`humansl.ts`), ignora `policyPass` porque en tengen el pase lo
 * decide la lógica de fin de partida (`endgame.ts`, en apps/web), no la red. Entre dos motores esa
 * lógica no existe → la partida se iría a ~360 jugadas rellenando territorio propio. Así que NO se
 * juega el yose: se corta por lo primero que ocurra —kata elige pasar, o el tope de jugadas— y el
 * resultado estimado es el `rootScoreLead` del último análisis de kata. KataGo estima el resultado
 * final con buena precisión mucho antes del final real, y ese número ya se calcula gratis.
 *
 * ── Costo (medido, no estimado) ───────────────────────────────────────────────────────────────
 * ≈1 inferencia/s en Node/wasm sobre M1 (19×19, fp32) — medido con este mismo script. Con el default
 * de 25 visitas y tope de 200 jugadas son ≈2.500 inferencias por partida: ≈40 min cada una. CORRER EN
 * BACKGROUND con la salida a un log. El SGF se escribe cada 10 jugadas, así que un proceso matado a
 * mitad deja igual una partida mirable en disco.
 *
 * ── Qué puede y qué NO puede concluir esta herramienta ────────────────────────────────────────
 * Con 2 partidas NO calibra: un 2-0 es compatible con cualquier winrate entre ~20 % y 100 %. Lo que
 * sí muestra es CÓMO juega —aperturas, blunders tácticos y sobre todo la TRAYECTORIA DEL SCORE—, que
 * con tan pocas partidas vale más que un número. Si kata se va +20 en la jugada 50 y no lo suelta,
 * eso es dominación evidente sin necesidad de estadística. Una calibración de verdad necesitaría
 * paralelizar con `worker_threads` y ~20 partidas por punto.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BoardSize, HumanRank, Move, Position, StoneColor } from '../src/types'
import { HUMAN_RANKS } from '../src/types'
import { setBoardSize } from '../src/vendor/web-katrain/fastBoard'
import { buildGameState, type GameState } from '../src/encoding/gameState'
import { fillFeaturesV7NCHW, GLOBAL_CHANNELS_V7, SPATIAL_CHANNELS_V7 } from '../src/encoding/featuresV7'
import { fillMetaV1, META_CHANNELS } from '../src/encoding/metaV1'
import { createSearch } from '../src/search/mcts'
import { sampleHumanMove } from '../src/humansl'
import { OnnxEvaluator } from '../src/nn/evaluator'
import { mulberry32 } from '../src/rng'

const req = createRequire(import.meta.url)
// Mismo truco que `tests/nn.reference.test.ts` y `validate-humanv0-mixed.ts`: el `exports` map de
// onnxruntime-web no expone `./package.json`, así que se resuelve el entry principal y se toma su dir.
const ORT_DIST = dirname(req.resolve('onnxruntime-web')) + '/'
const HERE = dirname(fileURLToPath(import.meta.url))

// fp32 en las dos redes: es el binario ya probado en producción (escritorio sirve fp32). Si el proceso
// muriera cargando el segundo modelo por memoria, los `.mixed16.onnx` de ambas redes existen y están
// validados — pero cambiar de formato es una decisión a reportar, no a tomar en silencio.
const KATA_MODEL = resolve(HERE, '../models/b18c384nbt-kata1.fp32.onnx')
const HUMAN_MODEL = resolve(HERE, '../models/b18c384nbt-humanv0.fp32.onnx')

const GTP_COLS = 'ABCDEFGHJKLMNOPQRST' // letras GTP, sin la 'I'

/** Komi y reglas del producto (`engineProbe.ts`), para que el resultado sea representativo de lo que
 *  juega la gente y no de una configuración inventada para el experimento. */
const KOMI = 6.5
const RULES = 'chinese' as const

/** Reintentos de muestreo humano ante jugada ilegal antes de rendirse y pasar. `sampleHumanMove` NO
 *  chequea suicidio (lo dice su propio comentario: la policy humana le da probabilidad ≈0, pero en
 *  cientos de jugadas no es despreciable). Un fallo silencioso acá corrompería la partida entera. */
const MAX_ILLEGAL_RETRIES = 5

type Options = {
  visits: number
  rank: HumanRank
  maxMoves: number
  seed: number
  games: number
  board: BoardSize
  outDir: string
}

type KataTurn = {
  moveNumber: number // 1-indexado, número de la jugada dentro de la partida
  /** Perspectiva NEGRO (ver `mapAnalysis` en engine.ts): positivo = Negro va ganando. */
  scoreLead: number
  winrate: number // perspectiva Negro
  visits: number
  label: string // coordenada GTP de la jugada elegida, o 'pass'
}

type GameResult = {
  index: number
  kataColor: StoneColor
  moves: Move[]
  trajectory: KataTurn[]
  stopReason: string
  illegalRetries: number
  forcedPasses: number
  sgfPath: string
  elapsedMs: number
}

// ── Utilidades de coordenadas ──────────────────────────────────────────────────────────────────

/** `Vertex` → etiqueta GTP legible para el log. `y=0` es la fila de ARRIBA (ver `gtpToVertex` en
 *  engine.ts: `y = N - num`), así que el número de fila es `N - y`. */
function gtpLabel(v: Move['vertex'], n: number): string {
  if (v === 'pass') return 'pass'
  return `${GTP_COLS[v.x] ?? '?'}${n - v.y}`
}

/**
 * `Vertex` → coordenada SGF de dos letras. En SGF `a` es la primera columna Y la primera FILA DESDE
 * ARRIBA, que es exactamente la convención de `Vertex` (`y=0` arriba) → mapeo directo, sin espejar.
 * Pase = string vacío (`B[]`), que es la forma canónica en FF[4].
 */
function sgfCoord(v: Move['vertex']): string {
  if (v === 'pass') return ''
  return String.fromCharCode(97 + v.x) + String.fromCharCode(97 + v.y)
}

/** Escapa `]` y `\` dentro de un valor de propiedad SGF (los comentarios que escribimos no los
 *  contienen, pero un SGF malformado es un fallo silencioso caro de diagnosticar). */
function sgfEscape(s: string): string {
  return s.replace(/([\]\\])/g, '\\$1')
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────

function parseArgv(argv: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined || !a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out.set(a.slice(2), 'true')
    } else {
      out.set(a.slice(2), next)
      i++
    }
  }
  return out
}

function parseOptions(argv: string[]): Options {
  const args = parseArgv(argv)

  const num = (key: string, fallback: number): number => {
    const raw = args.get(key)
    if (raw === undefined) return fallback
    const v = Number(raw)
    if (!Number.isFinite(v)) throw new Error(`--${key} debe ser un número (recibido "${raw}")`)
    return v
  }

  const rankRaw = args.get('rank') ?? '1k'
  if (!(HUMAN_RANKS as readonly string[]).includes(rankRaw)) {
    throw new Error(`--rank inválido: "${rankRaw}". Válidos: ${HUMAN_RANKS.join(', ')}`)
  }

  const boardRaw = num('board', 19)
  if (boardRaw !== 9 && boardRaw !== 13 && boardRaw !== 19) {
    throw new Error(`--board debe ser 9, 13 o 19 (recibido ${boardRaw})`)
  }

  return {
    visits: num('visits', 25),
    rank: rankRaw as HumanRank,
    maxMoves: num('max-moves', 200),
    seed: num('seed', 1),
    games: num('games', 2),
    board: boardRaw,
    outDir: args.get('out') ?? resolve(HERE, '../duel-out'),
  }
}

// ── SGF ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Serializa una partida a SGF a mano. `packages/engine` no tiene utilidades de SGF (viven en
 * `apps/web/src/game/sgf.ts`) y cruzar workspaces por 15 líneas no vale la pena.
 *
 * El comentario por jugada lleva el `rootScoreLead` de kata: al abrir el SGF en tengen (Analizar) la
 * trayectoria del score queda visible jugada a jugada, que es el entregable principal del duelo.
 */
function toSgf(game: GameResult, opts: Options, header: string): string {
  const kataName = `KataGo b18 ${opts.visits}v`
  const humanName = `Human SL ${opts.rank}`
  const pb = game.kataColor === 'black' ? kataName : humanName
  const pw = game.kataColor === 'white' ? kataName : humanName

  const leadByMove = new Map<number, KataTurn>()
  for (const t of game.trajectory) leadByMove.set(t.moveNumber, t)

  const body = game.moves
    .map((m, i) => {
      const tag = m.color === 'black' ? 'B' : 'W'
      const node = `;${tag}[${sgfCoord(m.vertex)}]`
      const turn = leadByMove.get(i + 1)
      if (turn === undefined) return node
      const sign = turn.scoreLead >= 0 ? '+' : ''
      return `${node}C[${sgfEscape(
        `lead Negro ${sign}${turn.scoreLead.toFixed(1)} · winrate Negro ${(turn.winrate * 100).toFixed(1)} % · ${turn.visits} visitas`,
      )}]`
    })
    .join('\n')

  return (
    `(;GM[1]FF[4]CA[UTF-8]AP[tengen-duel]SZ[${opts.board}]KM[${KOMI}]RU[Chinese]\n` +
    `PB[${sgfEscape(pb)}]PW[${sgfEscape(pw)}]\n` +
    `C[${sgfEscape(header)}]\n` +
    `${body}\n)\n`
  )
}

/** Escribe el SGF de la partida. Se llama INCREMENTALMENTE (cada 10 jugadas) además de al final: una
 *  corrida de ~30 min por partida se puede perder a mitad, y un proceso matado en la jugada 140 tiene
 *  que dejar algo mirable en disco. */
function writeSgf(game: GameResult, opts: Options, header: string): void {
  writeFileSync(game.sgfPath, toSgf(game, opts, header), 'utf8')
}

// ── El duelo ───────────────────────────────────────────────────────────────────────────────────

async function playGame(args: {
  index: number
  opts: Options
  kataEval: OnnxEvaluator
  humanEval: OnnxEvaluator
  runStamp: string
}): Promise<GameResult> {
  const { index, opts, kataEval, humanEval, runStamp } = args
  const n = opts.board

  // kata alterna de color entre partidas: con tan pocas partidas, no alternar dejaría el komi y la
  // primera jugada como variable de confusión gratuita.
  const kataColor: StoneColor = index % 2 === 0 ? 'black' : 'white'

  // RNG PERSISTENTE por partida (mismo patrón que `LocalEngine`): `sampleHumanMove` llama `rng()` una
  // sola vez, así que el reintento del guard de legalidad funciona SOLO porque la clausura avanza. Un
  // `mulberry32` creado dentro del loop devolvería el mismo valor en los 5 intentos.
  const rng = mulberry32(opts.seed + index)

  const moves: Move[] = []
  const position: Position = { boardSize: n, komi: KOMI, rules: RULES, handicap: 0, moves }
  const trajectory: KataTurn[] = []

  const game: GameResult = {
    index,
    kataColor,
    moves,
    trajectory,
    stopReason: 'en curso',
    illegalRetries: 0,
    forcedPasses: 0,
    sgfPath: resolve(opts.outDir, `duel-${runStamp}-g${index + 1}-kata-${kataColor}.sgf`),
    elapsedMs: 0,
  }
  const header = () =>
    `duelo de calibración · kata ${opts.visits} visitas (${kataColor}) vs Human SL ${opts.rank} · ` +
    `semilla ${opts.seed + index} · tope ${opts.maxMoves} jugadas · fin: ${game.stopReason}`

  const startedAt = Date.now()
  console.log(
    `\n══ Partida ${index + 1}/${opts.games} — kata (${opts.visits} visitas) juega ${kataColor === 'black' ? 'NEGRO' : 'BLANCO'}, ` +
      `Human SL ${opts.rank} juega ${kataColor === 'black' ? 'BLANCO' : 'NEGRO'} · semilla ${opts.seed + index}`,
  )

  // El `state` se reconstruye UNA vez por jugada aplicada: `buildGameState` lanza ante una jugada
  // ilegal (gameState.ts:88 → `playMove`), así que reconstruir ES la validación.
  let state: GameState = buildGameState(position)

  while (moves.length < opts.maxMoves) {
    const moveNumber = moves.length + 1
    const toPlay = state.currentPlayer

    if (toPlay === kataColor) {
      // ── kata: MCTS PUCT, mismas piezas que `LocalEngine.genMove` ────────────────────────────
      // No se pasa por `LocalEngine` porque `genMove` sólo devuelve el `Move` y acá hace falta LEER el
      // análisis: `getAnalysis` da la jugada Y el `rootScoreLead` en la misma llamada, así que la
      // trayectoria del score sale a costo cero.
      const search = await createSearch({ evaluator: kataEval, state })
      await search.run({ visits: opts.visits, maxTimeMs: 600_000, batchSize: 8 })
      const analysis = search.getAnalysis({ topK: 1, analysisPvLen: 0 })
      const best = analysis.moves.find((m) => m.order === 0)

      const vertex: Move['vertex'] = best === undefined || best.x < 0 ? 'pass' : { x: best.x, y: best.y }
      trajectory.push({
        moveNumber,
        scoreLead: analysis.rootScoreLead,
        winrate: analysis.rootWinRate,
        visits: analysis.rootVisits,
        label: gtpLabel(vertex, n),
      })

      if (vertex === 'pass') {
        // Fin de partida acordado: kata considera que no queda nada que jugar. Es el corte "bueno"
        // (el otro es el tope de jugadas) y el `rootScoreLead` de ESTE turno es el resultado estimado.
        game.stopReason = `kata pasó en la jugada ${moveNumber}`
        break
      }

      const move: Move = { color: toPlay, vertex }
      moves.push(move)
      try {
        state = buildGameState(position)
      } catch (e) {
        // El MCTS sólo expande jugadas legales, así que esto no debería pasar nunca. Si pasa, es un
        // bug del puente y la partida deja de ser interpretable: cortar en vez de seguir a ciegas.
        moves.pop()
        game.stopReason = `kata propuso una jugada ilegal en ${moveNumber} (${gtpLabel(vertex, n)}): ${String(e)}`
        break
      }

      const sign = analysis.rootScoreLead >= 0 ? '+' : ''
      console.log(
        `  #${String(moveNumber).padStart(3)} ${toPlay === 'black' ? 'B' : 'W'} ${gtpLabel(vertex, n).padEnd(4)} ` +
          `kata · lead Negro ${sign}${analysis.rootScoreLead.toFixed(1)} · wr ${(analysis.rootWinRate * 100).toFixed(1)} % · ${analysis.rootVisits}v`,
      )
    } else {
      // ── Human SL: una inferencia + muestreo con temperatura por rango ───────────────────────
      const bin = new Float32Array(n * n * SPATIAL_CHANNELS_V7)
      const global = new Float32Array(GLOBAL_CHANNELS_V7)
      fillFeaturesV7NCHW({ state, outSpatial: bin, outGlobal: global })
      const meta = new Float32Array(META_CHANNELS)
      fillMetaV1({ rank: opts.rank, boardArea: n * n, out: meta })
      const raw = await humanEval.evaluate({ bin, global, meta, batch: 1, includeOwnership: false })

      // La policy no cambia entre reintentos: se re-muestrea con el siguiente valor del rng, sin
      // volver a correr la red.
      let applied: Move | undefined
      for (let attempt = 0; attempt < MAX_ILLEGAL_RETRIES && applied === undefined; attempt++) {
        const candidate = sampleHumanMove({
          policy: raw.policy,
          policyPass: raw.policyPass[0]!,
          state,
          rank: opts.rank,
          rng,
        })
        if (candidate.vertex === 'pass') {
          // Sólo ocurre con el tablero lleno (Human SL ignora `policyPass` a propósito).
          applied = candidate
          moves.push(candidate)
          state = buildGameState(position)
          break
        }
        moves.push(candidate)
        try {
          state = buildGameState(position)
          applied = candidate
        } catch {
          moves.pop()
          game.illegalRetries++
        }
      }

      if (applied === undefined) {
        // Agotados los reintentos: pasar y registrarlo. `playMove` trata `PASS_MOVE` antes de los
        // guards de legalidad (fastBoard.ts:231), así que un pase nunca lanza.
        const pass: Move = { color: toPlay, vertex: 'pass' }
        moves.push(pass)
        state = buildGameState(position)
        game.forcedPasses++
        applied = pass
        console.log(`  #${String(moveNumber).padStart(3)} ${toPlay === 'black' ? 'B' : 'W'} pass  Human SL ← FORZADO (${MAX_ILLEGAL_RETRIES} muestreos ilegales)`)
      } else {
        console.log(
          `  #${String(moveNumber).padStart(3)} ${toPlay === 'black' ? 'B' : 'W'} ${gtpLabel(applied.vertex, n).padEnd(4)} Human SL ${opts.rank}`,
        )
      }
    }

    // Volcado incremental: una partida son ~30 min y el proceso se puede perder a mitad.
    if (moves.length % 10 === 0) writeSgf(game, opts, header())
  }

  if (game.stopReason === 'en curso') {
    game.stopReason = `tope de ${opts.maxMoves} jugadas alcanzado`
  }
  game.elapsedMs = Date.now() - startedAt
  writeSgf(game, opts, header())

  const last = trajectory[trajectory.length - 1]
  console.log(
    `── Partida ${index + 1} terminada: ${game.stopReason} · ${moves.length} jugadas · ` +
      `${(game.elapsedMs / 60000).toFixed(1)} min · SGF: ${game.sgfPath}`,
  )
  if (last !== undefined) {
    console.log(`   último lead de kata (persp. Negro): ${last.scoreLead >= 0 ? '+' : ''}${last.scoreLead.toFixed(1)}`)
  }

  return game
}

// ── Resumen ────────────────────────────────────────────────────────────────────────────────────

function reportGame(game: GameResult, opts: Options): void {
  const last = game.trajectory[game.trajectory.length - 1]
  const kataIsBlack = game.kataColor === 'black'

  console.log(`\n── Partida ${game.index + 1} · kata = ${kataIsBlack ? 'Negro' : 'Blanco'}`)
  console.log(`   jugadas          ${game.moves.length} · ${game.stopReason}`)
  console.log(`   duración         ${(game.elapsedMs / 60000).toFixed(1)} min`)
  console.log(`   SGF              ${game.sgfPath}`)

  if (last === undefined) {
    console.log('   score estimado   (kata nunca llegó a jugar)')
  } else {
    // `rootScoreLead` viene en perspectiva Negro (comentario literal en analyzeMcts.ts:90-91, y así lo
    // mapea `mapAnalysis` en engine.ts). El margen DE KATA invierte el signo cuando kata es Blanco.
    const kataMargin = kataIsBlack ? last.scoreLead : -last.scoreLead
    const sign = last.scoreLead >= 0 ? '+' : ''
    console.log(`   score estimado   Negro ${sign}${last.scoreLead.toFixed(1)} (komi ${KOMI}, reglas chinas)`)
    console.log(
      `   margen de kata   ${kataMargin >= 0 ? '+' : ''}${kataMargin.toFixed(1)} → ${kataMargin >= 0 ? 'GANA kata' : `GANA Human SL ${opts.rank}`}`,
    )
  }

  if (game.illegalRetries > 0 || game.forcedPasses > 0) {
    console.log(
      `   guard legalidad  ${game.illegalRetries} re-muestreos · ${game.forcedPasses} pases forzados` +
        (game.illegalRetries > 5 || game.forcedPasses > 0 ? '  ← MIRAR EL SGF antes de concluir nada' : ''),
    )
  }

  // Trayectoria ≈cada 10 jugadas: si kata se va +20 en la jugada 50 y no lo suelta, eso es dominación
  // evidente sin necesidad de estadística. Se muestrea cada 5º TURNO DE KATA (kata juega uno de cada
  // dos, así que 5 turnos ≈ 10 jugadas) en vez de filtrar por `moveNumber % 10`: ese filtro depende de
  // la paridad del color de kata y puede saltear o duplicar puntos.
  const sampled = game.trajectory.filter((_, i) => i % 5 === 0 || i === game.trajectory.length - 1)
  console.log(
    `   trayectoria      ${sampled
      .map((t) => `#${t.moveNumber}:${t.scoreLead >= 0 ? '+' : ''}${t.scoreLead.toFixed(1)}`)
      .join('  ')}`,
  )
}

/**
 * Chequeo de cordura del propio experimento: `rootScoreLead` DEBE estar en perspectiva de Negro. Si en
 * cambio estuviera atado al jugador al turno, todos los leads se leerían invertidos en una de las dos
 * partidas y la conclusión sería exactamente la opuesta.
 *
 * La prueba: en el primer turno de kata, con komi 6,5 y reglas chinas, el lead de Negro tiene que ser
 * levemente POSITIVO en las DOS partidas (Negro tiene la ventaja de la primera jugada; el komi chino
 * de 6,5 no la compensa del todo según KataGo). Si sale positivo cuando kata es Negro y negativo
 * cuando es Blanco, el signo está atado al jugador al turno.
 */
function reportPerspectiveCheck(games: GameResult[]): void {
  const firsts = games
    .map((g) => ({ kataColor: g.kataColor, lead: g.trajectory[0]?.scoreLead }))
    .filter((f): f is { kataColor: StoneColor; lead: number } => f.lead !== undefined)

  if (firsts.length < 2) {
    console.log('\n── Chequeo de perspectiva: no aplicable (hace falta al menos una partida con kata de cada color)')
    return
  }

  console.log('\n── Chequeo de perspectiva del score (¿`rootScoreLead` es realmente persp. Negro?)')
  for (const f of firsts) {
    console.log(`   kata ${f.kataColor === 'black' ? 'Negro ' : 'Blanco'} → primer lead ${f.lead >= 0 ? '+' : ''}${f.lead.toFixed(2)}`)
  }
  const allSameSign = firsts.every((f) => f.lead >= 0) || firsts.every((f) => f.lead < 0)
  console.log(
    allSameSign
      ? '   MISMO signo en ambas → consistente con perspectiva Negro. Los leads se leen tal cual.'
      : '   SIGNOS OPUESTOS → el lead parece atado al jugador al turno, NO a Negro.\n' +
          '   ⚠ NO interpretar los márgenes hasta resolver esto: una de las dos partidas se lee al revés.',
  )
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2))

  for (const [label, path] of [['kata', KATA_MODEL], ['humanv0', HUMAN_MODEL]] as const) {
    if (!existsSync(path)) {
      console.error(`falta el modelo ${label}: ${path}\n(correr packages/engine/scripts/download-models.sh)`)
      process.exit(1)
    }
  }
  mkdirSync(opts.outDir, { recursive: true })

  // `fastBoard` tiene estado global dimensionado por tablero: fijarlo UNA vez, antes de todo.
  setBoardSize(opts.board)

  console.log('══ Duelo de calibración ═══════════════════════════════════════════════════════')
  console.log(`   kata             b18c384nbt fp32 · ${opts.visits} visitas · MCTS PUCT (piso interno: 16 visitas)`)
  console.log(`   Human SL         humanv0 fp32 · rango ${opts.rank} · muestreo con temperatura`)
  console.log(`   tablero          ${opts.board}×${opts.board} · komi ${KOMI} · reglas chinas`)
  console.log(`   partidas         ${opts.games} (kata alterna de color) · tope ${opts.maxMoves} jugadas · semilla base ${opts.seed}`)
  console.log(`   EP               wasm (Node) · salida en ${opts.outDir}`)
  // Costo MEDIDO (M1, Node/wasm, 19×19, fp32): ≈1 inferencia/s. Con `visits` por jugada de kata y kata
  // jugando la mitad de los turnos, el tope de jugadas domina el tiempo total. Correr en background.
  const estMin = Math.round((opts.games * (opts.maxMoves / 2) * opts.visits) / 60)
  console.log(
    `   ~coste           ≈${opts.visits} inferencias por jugada de kata · ≈1 inf/s medido en wasm ` +
      `→ ≈${estMin} min en total si ninguna partida corta antes`,
  )

  // Dos evaluadores, uno por red, creados UNA vez y reusados: cargar el ONNX es lo caro.
  const kataEval = await OnnxEvaluator.create(KATA_MODEL, { boardSize: opts.board, ep: 'wasm', wasmPaths: ORT_DIST })
  const humanEval = await OnnxEvaluator.create(HUMAN_MODEL, { boardSize: opts.board, ep: 'wasm', wasmPaths: ORT_DIST })
  if (!humanEval.hasMeta) {
    console.error('el modelo humanv0 no expone meta_input[192] — Human SL no puede jugar sin él')
    process.exit(1)
  }

  const runStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const results: GameResult[] = []
  for (let i = 0; i < opts.games; i++) {
    results.push(await playGame({ index: i, opts, kataEval, humanEval, runStamp }))
  }

  await kataEval.dispose()
  await humanEval.dispose()

  console.log('\n══ Resumen ════════════════════════════════════════════════════════════════════')
  for (const g of results) reportGame(g, opts)
  reportPerspectiveCheck(results)

  const decided = results.filter((g) => g.trajectory.length > 0)
  const kataWins = decided.filter((g) => {
    const last = g.trajectory[g.trajectory.length - 1]!
    return (g.kataColor === 'black' ? last.scoreLead : -last.scoreLead) >= 0
  }).length
  console.log(
    `\n   kata ${kataWins}-${decided.length - kataWins} Human SL ${opts.rank} (score ESTIMADO, no partida terminada).`,
  )
  console.log(
    '   Con esta cantidad de partidas el marcador NO calibra nada: mirar los SGF y la trayectoria.\n' +
      '   La pregunta que sí responde: ¿kata abre como un dan y luego pierde grupos por no leer, o juega como un kyu?',
  )

  const shortGames = results.filter((g) => g.moves.length < 30)
  if (shortGames.length > 0) {
    console.log(
      `\n   ⚠ ${shortGames.length} partida(s) cortaron antes de la jugada 30: el resultado NO es interpretable.\n` +
        '     Mirar el SGF antes de sacar ninguna conclusión.',
    )
  }
}

void main()
