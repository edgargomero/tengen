// Fase Aprender T6: el player de un ejercicio de tsumego. Interactivo pero SIN motor adentro: la
// sesión (learn/exerciseSession) decide qué es cada clic, y solo ante 'fuera-de-arbol' se consulta
// al scheduler INYECTADO (learn/engineRefutation) — por eso este componente se testea en jsdom con
// un mock y el arranque real del motor vive en `AprenderView` (EngineExercisePlayer).
//
// Page → template "estudio de tablero" (.study-shell/.study-main/.study-board/.study-rail) →
// organismos (rail con header/footer) → moléculas (.action-row) → átomos (.notice/.hint/.eyebrow/
// botón/glifo ●○) → tokens. El tablero sigue siendo el único héroe; el veredicto vive en el rail.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import type { GhostStone, Marker } from '@sabaki/shudan'
import type { Move } from '@tengen/engine'
import { createExerciseSession, type AttemptResult } from '../learn/exerciseSession'
import type { Exercise } from '../learn/exercise'
import {
  LEARN_ANALYSIS_GROUP,
  REFUTE_VISITS,
  refuteOutOfTree,
  type Refutation,
  type RefutationScheduler,
} from '../learn/engineRefutation'
import { recordResult } from '../learn/progress'
import type { StorageLike } from '../game/persistence'
import { signMapOf } from '../game/rules'
import { useBoundedBoardSize, type BoundedBoardSize } from './useBoundedBoardSize'

/** Mismo tamaño de vértice que Analizar en 19×19 (`VERTEX_SIZE` de AnalyzeView, que no exporta). */
const MAX_VERTEX_SIZE_19 = 38

const OBJECTIVE_LABELS: Record<Exercise['objective'], string> = {
  matar: 'Matar',
  vivir: 'Vivir',
  ko: 'Ko',
  desconocido: 'Vida y muerte',
}

type Feedback = { tone: 'accent' | 'warning' | 'danger' | 'neutral'; text: string }

const ILLEGAL_REASONS: Record<'ko' | 'suicide' | 'overwrite', string> = {
  ko: 'Ko: no puedes recapturar ahí todavía.',
  suicide: 'Esa jugada sería suicidio.',
  overwrite: 'Ese punto ya está ocupado.',
}

export interface ExercisePlayerProps {
  exercise: Exercise
  storage: StorageLike
  scheduler: RefutationScheduler
  /** El motor todavía está arrancando (solo afecta a la refutación fuera-de-árbol). */
  booting?: boolean
  /** null = medir con el hook (browser). Los tests jsdom lo inyectan (offsetHeight ahí es 0). */
  boardBounds?: BoundedBoardSize
  onBackToList(): void
  /** Presente si hay un siguiente ejercicio en la colección. */
  onNext?(): void
}

export function ExercisePlayer({
  exercise,
  storage,
  scheduler,
  booting = false,
  boardBounds,
  onBackToList,
  onNext,
}: ExercisePlayerProps) {
  // La sesión vive lo que vive el ejercicio: el padre remonta con `key={exercise.id}`.
  const session = useMemo(() => createExerciseSession(exercise), [exercise])
  const [, setTick] = useState(0)
  const bump = (): void => setTick((t) => t + 1)

  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [refutation, setRefutation] = useState<Refutation | null>(null)
  const [showingSolution, setShowingSolution] = useState(false)
  const [refuting, setRefuting] = useState(false)

  // Baseline del motor cacheado POR NODO de partida (la posición previa a la jugada del alumno):
  // reintentar y fallar dos veces desde el mismo punto no re-analiza el baseline.
  const baselineCache = useRef(new Map<number, number>())
  // Época de intento: reintentar/desmontar invalida cualquier refutación en vuelo.
  const epochRef = useRef(0)
  useEffect(
    () => () => {
      epochRef.current++
    },
    [],
  )

  const measuredRef = useRef<HTMLDivElement | null>(null)
  const measured = useBoundedBoardSize(measuredRef)
  const bounds = boardBounds ?? measured

  // Precalentamiento del baseline (calibración T7): el primer veredicto fuera-de-árbol necesita
  // DOS análisis (~12 s cada uno a 32 visitas en el M1 de referencia). Pedir el de la posición
  // inicial apenas el motor está listo — con prioridad 'review', que no compite con nada
  // interactivo — deja el caso típico en UN análisis. Si el usuario juega antes de que termine,
  // refuteOutOfTree pide el suyo con prioridad interactiva: trabajo duplicado pero correcto.
  // Guard con flag propio (no con epochRef): el baseline de la RAÍZ sigue siendo válido tras
  // cualquier reintento.
  useEffect(() => {
    if (booting) return
    let live = true
    const rootId = session.tree.root.id
    scheduler
      .analyzePosition({
        pos: session.tree.positionAt(session.tree.root),
        visits: REFUTE_VISITS,
        priority: 'review',
        group: LEARN_ANALYSIS_GROUP,
      })
      .then((a) => {
        if (live && !baselineCache.current.has(rootId)) baselineCache.current.set(rootId, a.scoreLead)
      })
      .catch(() => {
        // Cancelado (cambio de ejercicio) o error: el precalentamiento es oportunista, no un fallo.
      })
    return () => {
      live = false
    }
  }, [booting, session, scheduler])

  function applyResult(result: AttemptResult): void {
    switch (result.kind) {
      case 'ilegal':
        setFeedback({ tone: 'warning', text: ILLEGAL_REASONS[result.reason] })
        return
      case 'resuelto':
        setFeedback({ tone: 'accent', text: result.comment ? `¡Resuelto! ${result.comment}` : '¡Resuelto!' })
        recordResult(storage, exercise.id, 'resuelto')
        return
      case 'avanza':
        setFeedback(result.comment ? { tone: 'neutral', text: result.comment } : null)
        return
      case 'fallo-en-arbol':
        setFeedback({
          tone: 'danger',
          text: result.comment ?? 'Esa no es la solución: mira la respuesta en el tablero.',
        })
        recordResult(storage, exercise.id, 'fallado')
        return
      case 'fuera-de-arbol': {
        setFeedback({ tone: 'neutral', text: 'No está en el árbol de la solución. Consultando al motor…' })
        setRefuting(true)
        const epoch = epochRef.current
        const nodeBefore = session.tree.current.parent ?? session.tree.root
        void refuteOutOfTree({
          scheduler,
          posBefore: session.tree.positionAt(nodeBefore),
          posAfter: session.tree.positionAt(),
          playedColor: exercise.toPlay,
          ...(baselineCache.current.has(nodeBefore.id)
            ? { cachedBaseline: baselineCache.current.get(nodeBefore.id)! }
            : {}),
        })
          .then((r) => {
            if (epoch !== epochRef.current) return
            baselineCache.current.set(nodeBefore.id, r.baselineScoreLead)
            setRefutation(r)
            setFeedback({ tone: r.verdict.tone, text: r.verdict.label })
            session.fail()
            recordResult(storage, exercise.id, 'fallado')
          })
          .catch(() => {
            if (epoch !== epochRef.current) return
            // Cancelación (cambio de ejercicio) o error del motor: se cierra el intento sin
            // veredicto en vez de dejar la sesión colgada en 'respondiendo'.
            session.fail()
            setFeedback({ tone: 'warning', text: 'No se pudo consultar al motor. Puedes reintentar.' })
          })
          .finally(() => {
            if (epoch !== epochRef.current) return
            setRefuting(false)
            bump()
          })
        return
      }
    }
  }

  function handleVertexClick(position: [number, number]): void {
    if (session.state !== 'esperando' || showingSolution || refuting) return
    applyResult(session.attempt({ x: position[0], y: position[1] }))
    bump()
  }

  function handleRetry(): void {
    epochRef.current++
    session.reintentar()
    setFeedback(null)
    setRefutation(null)
    setShowingSolution(false)
    setRefuting(false)
    bump()
  }

  function handleShowSolution(): void {
    // Ver la solución sin haber resuelto cuenta como intento fallado (el progreso es honesto).
    if (session.state === 'esperando' || session.state === 'respondiendo') {
      recordResult(storage, exercise.id, 'fallado')
    }
    epochRef.current++
    session.reintentar()
    for (const move of solutionLine) session.tree.addMove(move)
    setShowingSolution(true)
    setFeedback(null)
    setRefutation(null)
    setRefuting(false)
    bump()
  }

  const solutionLine = useMemo(() => session.solution(), [session])
  const boardSize = exercise.boardSize
  const board = session.tree.boardAt()
  const signMap = signMapOf(board)

  // Marcadores: en modo solución, la línea numerada; si no, un círculo en la última jugada.
  const markerMap = useMemo(() => {
    const grid: (Marker | null)[][] = Array.from({ length: boardSize }, () =>
      new Array<Marker | null>(boardSize).fill(null),
    )
    if (showingSolution) {
      solutionLine.forEach((move: Move, i: number) => {
        if (move.vertex === 'pass') return
        const row = grid[move.vertex.y]
        if (row) row[move.vertex.x] = { type: 'label', label: String(i + 1) }
      })
    } else {
      const last = session.tree.current.move
      if (last && last.vertex !== 'pass') {
        const row = grid[last.vertex.y]
        if (row) row[last.vertex.x] = { type: 'circle' }
      }
    }
    return grid
    // `tick` (via bump) fuerza el re-render; la dependencia real es el cursor del árbol mutable.
  }, [showingSolution, solutionLine, boardSize, session.tree.current])

  // La mejor respuesta del rival según el motor, como piedra fantasma (la jugada NO se juega:
  // el veredicto ya cerró el intento; esto es "mira lo que vendría").
  const ghostStoneMap = useMemo(() => {
    if (!refutation || refutation.bestReply === null || refutation.bestReply === 'pass') return undefined
    const grid: (GhostStone | null)[][] = Array.from({ length: boardSize }, () =>
      new Array<GhostStone | null>(boardSize).fill(null),
    )
    const rivalSign = exercise.toPlay === 'black' ? -1 : 1
    const row = grid[refutation.bestReply.y]
    if (row) row[refutation.bestReply.x] = { sign: rivalSign }
    return grid
  }, [refutation, boardSize, exercise.toPlay])

  const solved = session.state === 'resuelto'
  const toPlayGlyph = exercise.toPlay === 'black' ? '●' : '○'
  const toPlayLabel = exercise.toPlay === 'black' ? 'Juegan negras' : 'Juegan blancas'

  return (
    <div class="study-shell">
      <div class="study-main">
        <div class={showingSolution ? 'study-board study-board--solution' : 'study-board'} ref={measuredRef}>
          {bounds && (
            <BoundedGoban
              signMap={signMap}
              markerMap={markerMap}
              {...(ghostStoneMap ? { ghostStoneMap } : {})}
              maxWidth={bounds.maxWidth}
              maxHeight={bounds.maxHeight}
              maxVertexSize={MAX_VERTEX_SIZE_19}
              showCoordinates
              onVertexClick={(_evt: unknown, v: [number, number]) => handleVertexClick(v)}
            />
          )}
        </div>
        <aside class="study-rail">
          <div class="rail-header">
            <span class="eyebrow">Tsumego · {OBJECTIVE_LABELS[exercise.objective]}</span>
            <div class="stat">
              <span class="stat-value">
                {toPlayGlyph} {toPlayLabel}
              </span>
            </div>
            {booting && <p class="hint">Preparando motor… (puedes jugar: el árbol de la solución no lo necesita)</p>}
            {/* El enunciado del problema (comentario raíz del SGF) ocupa la franja hasta que el
                primer feedback lo reemplaza — la franja es UNA, no una pila de mensajes. */}
            {feedback === null && !showingSolution && exercise.tree.comment !== undefined && (
              <p class="notice notice--quote">{exercise.tree.comment}</p>
            )}
            {feedback !== null && (
              <p
                class={
                  feedback.tone === 'accent'
                    ? 'notice notice--accent'
                    : feedback.tone === 'danger'
                      ? 'notice notice--danger'
                      : feedback.tone === 'warning'
                        ? 'notice notice--warning'
                        : 'notice'
                }
              >
                {feedback.text}
              </p>
            )}
            {refuting && <p class="hint">El motor está midiendo la jugada…</p>}
            {showingSolution && <p class="hint">Línea principal de la solución, numerada sobre el tablero.</p>}
          </div>
          <div class="rail-footer">
            <div class="action-row">
              <button type="button" onClick={handleRetry}>
                Reintentar
              </button>
              <button type="button" onClick={handleShowSolution} disabled={showingSolution}>
                Ver solución
              </button>
            </div>
            <div class="action-row">
              {onNext && (
                <button type="button" class={solved ? 'primary' : ''} onClick={onNext}>
                  Siguiente
                </button>
              )}
              <button type="button" class="ghost" onClick={onBackToList}>
                Volver a la lista
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export { LEARN_ANALYSIS_GROUP }
