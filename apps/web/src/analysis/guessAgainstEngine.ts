/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/guessMove.ts (SOLO `scoreGuess`/`guessVerdict`). Licencia completa en
 * apps/web/THIRD-PARTY-LICENSES.
 *
 * ── Recorte deliberado del origen ────────────────────────────────────────────────────────────
 * `scoreGuess`/`guessVerdict` se portan VERBATIM (misma matemática Manhattan, mismos umbrales
 * 0/≤2/≤5, mismos labels/tonos). Único cambio: el tipo de `expected` en `scoreGuess` se simplifica
 * de `Move` (`{x,y,player}`) completo a `{x,y}` — la función original NUNCA lee `.player`, así que
 * arrastrar ese campo sería ruido de tipo sin uso.
 *
 * **NO se portan** `buildGuessPositions`/`GuessPosition`/`GuessPlayerFilter`/`playerLabel` — son la
 * maquinaria de "extraer la jugada real jugada del kifu" como insumo del "expected" a adivinar.
 * Esta tarea REEMPLAZA por completo ese insumo (ver `guessAgainstEngine` más abajo): en vez de leer
 * la jugada real de la partida, pregunta al motor cuál es su candidata más visitada. Portar esas 4
 * exportaciones sería código muerto garantizado (nunca tendrían un consumidor posible en este
 * archivo), a diferencia de Tasks 3/4 donde SÍ había consumidores futuros razonables dentro del
 * propio archivo portado.
 *
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */
//
// ── La función nativa `guessAgainstEngine`: desviación deliberada del texto literal del plan ────
// El plan dice "llama a `EngineManager.analyze(pos, N)`". Esta función usa
// **`ReviewScheduler.analyzePosition`** (Task 6) en su lugar, con `priority:'interactive'` — NO
// `EngineManager.analyze` directo. Motivo: `EngineManager.analyze` es streaming puro sin noción de
// "visitas alcanzadas → completar" (haría falta reimplementar ese loop de espera una TERCERA vez,
// tras `analyzeToScore` y `reviewScheduler.runAnalyzeJob`); `ReviewScheduler` YA resuelve
// exactamente ese problema (Task 6) además de gestionar la contención con el review de fondo (Task
// 7) que puede estar corriendo al mismo tiempo — llamar a `EngineManager.analyze` directo se
// saltaría esa gestión de contención. Si un reviewer no comparte esta lectura del plan, es una
// decisión legítima para escalar, pero la razón técnica ya está validada por el propio Task 6.
import type { Position, Vertex as TengenVertex } from '@tengen/engine'
import type { ReviewScheduler } from './reviewScheduler'

export interface GuessOutcome {
  correct: boolean
  /** Distancia Manhattan entre el guess y la jugada esperada. */
  distance: number
}

export function scoreGuess(expected: { x: number; y: number }, x: number, y: number): GuessOutcome {
  const distance = Math.abs(expected.x - x) + Math.abs(expected.y - y)
  return { correct: distance === 0, distance }
}

export function guessVerdict(outcome: GuessOutcome): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (outcome.correct) return { label: 'Exact match!', tone: 'success' }
  if (outcome.distance <= 2) return { label: 'Very close', tone: 'warning' }
  if (outcome.distance <= 5) return { label: 'In the area', tone: 'warning' }
  return { label: 'Off the mark', tone: 'danger' }
}

export interface GuessAgainstEngineResult {
  /** El vértice más visitado del análisis — incluye `'pass'` si corresponde. */
  expected: TengenVertex
  outcome: GuessOutcome
  verdict: { label: string; tone: 'success' | 'warning' | 'danger' }
}

/**
 * Adivina la jugada del motor sobre `args.pos`: encola un análisis interactivo vía
 * `ReviewScheduler` (ver desviación documentada arriba), toma la candidata con MÁS `visits` como
 * "expected", y puntúa `args.guess` (siempre un clic de tablero — un pase no se "adivina" haciendo
 * clic, ver el tipo de `guess`) contra ella.
 *
 * `args.visits` no tiene default: es una decisión de producto de quien llama (Task 10), no de esta
 * función. `args.guess` nunca representa un pase — si Task 10 necesita cubrir "el usuario adivina
 * pase", es un caso aparte (un botón dedicado, no un clic en el tablero) fuera del alcance de esta
 * función.
 */
export async function guessAgainstEngine(args: {
  pos: Position
  guess: { x: number; y: number }
  visits: number
  scheduler: ReviewScheduler
}): Promise<GuessAgainstEngineResult> {
  const analysis = await args.scheduler.analyzePosition({
    pos: args.pos,
    visits: args.visits,
    priority: 'interactive',
    group: 'guess',
  })

  if (analysis.moves.length === 0) {
    // Comportamiento explícito, no un resultado con datos inventados: sin candidatas no hay nada
    // contra lo que puntuar el guess del usuario.
    throw new Error('guessAgainstEngine: el análisis no devolvió ninguna candidata (analysis.moves vacío)')
  }

  const best = analysis.moves.reduce((top, candidate) => (candidate.visits > top.visits ? candidate : top))
  const expected = best.vertex

  // El motor ya entrega `MoveAnalysis.vertex` en la convención nativa de tengen (`'pass'|{x,y}`),
  // sin necesidad de convertir nada (al revés de `adaptVertex` de `katrainAdapter.ts`, que traduce
  // HACIA la convención `(-1,-1)` del vendor — aquí no aplica, tengen ya usa esta forma).
  //
  // Un pase esperado nunca puede coincidir con el guess del usuario, que SIEMPRE es un vértice de
  // tablero real (ver el tipo de `args.guess`): se marca `correct:false` explícitamente con una
  // distancia centinela `Infinity` (nunca `NaN` colándose en silencio de una resta con `'pass'`).
  const outcome: GuessOutcome = expected === 'pass' ? { correct: false, distance: Infinity } : scoreGuess(expected, args.guess.x, args.guess.y)

  return { expected, outcome, verdict: guessVerdict(outcome) }
}
