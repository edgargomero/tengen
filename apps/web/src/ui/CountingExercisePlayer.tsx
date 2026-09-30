// Fase Aprender Bloque 3 T3: el player de un ejercicio de CONTEO (posición TERMINADA, sin árbol de
// jugadas -- ver learn/countingExercise.ts). Mismo template visual "estudio de tablero" que
// ExercisePlayer (.study-shell/.study-board/.study-rail), pero el tablero es fijo -- sin
// `onVertexClick`, no hay jugada que marcar -- y la interacción vive en dos inputs numéricos del
// rail (Puntos Negro / Puntos Blanco).
//
// Única fuente de verdad en runtime: la respuesta se deriva UNA sola vez con `countArea` al montar
// (memoizada sobre `exercise`, que es estable durante la vida del componente -- el padre remonta
// con `key={exercise.id}`, mismo patrón que `ExercisePlayer`) y ESE único valor se usa para
// calificar, para revelar ("Mostrar la respuesta") y para el desglose de fallo. `correctScore`
// (horneado en el JSON) NO tiene consumidor acá -- solo alimenta `countingExerciseIssues` en tiempo
// de autoría (Task 2).
//
// Komi se suma UNA sola vez, en la comparación (y en el desglose): `countArea` nunca lo incluye. El
// campo de Blanco pide el puntaje CON komi ya sumado -- el label lo aclara cuando `exercise.komi`
// está presente.
import { useMemo, useRef, useState } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import { boardFromMoves, signMapOf } from '../game/rules'
import { countArea } from '../game/territory'
import { formatResult } from '../game/endgame'
import type { CountingExercise } from '../learn/countingExercise'
import { recordResult } from '../learn/progress'
import type { StorageLike } from '../game/persistence'
import { useBoundedBoardSize, type BoundedBoardSize } from './useBoundedBoardSize'

/** Mismo tope de vértice que `ExercisePlayer` (`VERTEX_SIZE` de AnalyzeView, que no exporta). */
const MAX_VERTEX_SIZE_19 = 38

type Feedback = { tone: 'accent' | 'danger' | 'neutral'; text: string }

function noticeClass(tone: Feedback['tone']): string {
  if (tone === 'accent') return 'notice notice--accent'
  if (tone === 'danger') return 'notice notice--danger'
  return 'notice'
}

export interface CountingExercisePlayerProps {
  exercise: CountingExercise
  storage: StorageLike
  /** null = medir con el hook (browser). Los tests jsdom lo inyectan (offsetHeight ahí es 0). */
  boardBounds?: BoundedBoardSize
  onBackToList(): void
  /** Presente si hay un siguiente ejercicio en la colección/lección. */
  onNext?(): void
}

export function CountingExercisePlayer({
  exercise,
  storage,
  boardBounds,
  onBackToList,
  onNext,
}: CountingExercisePlayerProps) {
  // La respuesta real: SIEMPRE `countArea` en vivo, nunca `correctScore` (defensa en profundidad --
  // el horneado ya se verificó contra esto mismo en tiempo de autoría, pero acá no se confía en él).
  const answer = useMemo(() => countArea(exercise.boardSize, exercise.setup), [exercise])
  const board = useMemo(
    () => boardFromMoves(exercise.boardSize, 0, [], exercise.setup),
    [exercise],
  )
  const signMap = signMapOf(board)

  const hasKomi = exercise.komi !== undefined
  const komi = exercise.komi ?? 0
  // Blanco compite con Negro CON komi ya sumado -- el input de Blanco pide justamente ese total.
  const whiteWithKomi = answer.white + komi
  const scoreLead = answer.black - whiteWithKomi

  const [blackInput, setBlackInput] = useState('')
  const [whiteInput, setWhiteInput] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [solved, setSolved] = useState(false)
  const [revealed, setRevealed] = useState(false)

  const measuredRef = useRef<HTMLDivElement | null>(null)
  const measured = useBoundedBoardSize(measuredRef)
  const bounds = boardBounds ?? measured

  // Input vacío no es "0": Number('') da 0 en JS, así que un campo sin tocar no puede calificar
  // como respuesta incorrecta -- hace falta un valor explícito en AMBOS campos.
  const canGrade = blackInput.trim() !== '' && whiteInput.trim() !== '' && !solved && !revealed

  function breakdown(): string {
    return (
      `Negro: ${answer.black} (piedras + territorio). ` +
      `Blanco: ${answer.white}${hasKomi ? ` + ${komi} de komi = ${whiteWithKomi}` : ''}. ` +
      `Resultado real: ${formatResult(scoreLead)}.`
    )
  }

  function handleGrade(e: Event): void {
    e.preventDefault()
    if (!canGrade) return
    const black = Number(blackInput)
    const white = Number(whiteInput)
    const correct = black === answer.black && white === whiteWithKomi
    if (correct) {
      setFeedback({ tone: 'accent', text: `¡Resuelto! Resultado: ${formatResult(scoreLead)}.` })
      setSolved(true)
      recordResult(storage, exercise.id, 'resuelto')
    } else {
      setFeedback({ tone: 'danger', text: `No es correcto. ${breakdown()}` })
      recordResult(storage, exercise.id, 'fallado')
    }
  }

  function handleRetry(): void {
    setBlackInput('')
    setWhiteInput('')
    setFeedback(null)
    setSolved(false)
    setRevealed(false)
  }

  function handleShowAnswer(): void {
    // Ver la respuesta sin haber resuelto cuenta como intento fallado -- mismo criterio que "Ver
    // solución" en ExercisePlayer.
    if (!solved) recordResult(storage, exercise.id, 'fallado')
    setBlackInput(String(answer.black))
    setWhiteInput(String(whiteWithKomi))
    setRevealed(true)
    setFeedback({ tone: 'neutral', text: breakdown() })
  }

  return (
    <div class="study-shell">
      <div class="study-main">
        <div class="study-board" ref={measuredRef}>
          {bounds && (
            <BoundedGoban
              signMap={signMap}
              maxWidth={bounds.maxWidth}
              maxHeight={bounds.maxHeight}
              maxVertexSize={MAX_VERTEX_SIZE_19}
              showCoordinates
            />
          )}
        </div>
        <aside class="study-rail">
          <div class="rail-header">
            <span class="eyebrow">Conteo de puntos</span>
            <div class="stat">
              <span class="stat-value">Partida terminada</span>
            </div>
            {feedback === null && (
              <p class="hint">Contá piedras + territorio de cada color y escribí el resultado.</p>
            )}
            {feedback !== null && <p class={noticeClass(feedback.tone)}>{feedback.text}</p>}
          </div>
          <form class="rail-body" onSubmit={handleGrade}>
            <label class="rail-field">
              <span class="eyebrow">Puntos Negro</span>
              <input
                type="number"
                step="0.5"
                value={blackInput}
                disabled={solved || revealed}
                onChange={(e) => setBlackInput((e.target as HTMLInputElement).value)}
                onInput={(e) => setBlackInput((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="rail-field">
              <span class="eyebrow">{hasKomi ? 'Puntos Blanco (con komi)' : 'Puntos Blanco'}</span>
              <input
                type="number"
                step="0.5"
                value={whiteInput}
                disabled={solved || revealed}
                onChange={(e) => setWhiteInput((e.target as HTMLInputElement).value)}
                onInput={(e) => setWhiteInput((e.target as HTMLInputElement).value)}
              />
            </label>
            <button type="submit" class="primary" disabled={!canGrade}>
              Calificar
            </button>
          </form>
          <div class="rail-footer">
            <div class="action-row">
              <button type="button" onClick={handleRetry}>
                Reintentar
              </button>
              <button type="button" onClick={handleShowAnswer} disabled={revealed}>
                Mostrar la respuesta
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
