// Fase Aprender T6: la sección /aprender. Dos niveles con estado interno (sin sub-rutas, como
// PartidasView):
//   1. Colecciones ("Primeros pasos") → lista de ejercicios (.card-screen). SIN ModelGate para
//      LISTAR: el gate aparece recién al abrir un ejercicio, con <ModelGate net='b18'> →
//      EngineExercisePlayer (patrón exacto de ReadyAnalyzeView: EngineManager + ReviewScheduler en
//      refs, ensureReady('b18', 19), dispose al desmontar) → ExercisePlayer.
//   2. Currículo → el mismo <ExercisePlayer>, pero SIN motor en NINGUNA lección de todo
//      `CURRICULUM` (spec, Pieza 3; ver la nota junto al render de más abajo para el porqué) —
//      interacción pura, testeable con scheduler mock cuando aplica.
import type { RoutableProps } from 'preact-router'
import { route } from 'preact-router'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { NetworkId } from '@tengen/engine'
import { EngineManager } from '../engine/engineManager'
import { createWorkerManagedEngine } from '../engine/workerManagedEngine'
import { ReviewScheduler } from '../analysis/reviewScheduler'
import { ModelGate } from '../models/ModelGate'
import { COLLECTIONS, type ExerciseCollectionData } from '../learn/collections'
import { CURRICULUM } from '../learn/curriculum'
import type { Exercise } from '../learn/exercise'
import type { Lesson } from '../learn/lesson'
import { LEARN_ANALYSIS_GROUP } from '../learn/engineRefutation'
import { isLessonUnlocked, loadProgress, type ProgressMap } from '../learn/progress'
import type { StorageLike } from '../game/persistence'
import { ExercisePlayer } from './ExercisePlayer'

export type { ExerciseCollectionData } from '../learn/collections'

/** La red del player: la de "Primeros pasos" (Colecciones), la única superficie de Aprender que
 * todavía usa motor. El Currículo (todo `CURRICULUM`) es 100% engineless -- ver la nota junto a su
 * render. */
const LEARN_NETWORK: NetworkId = 'b18'

interface AprenderViewProps extends RoutableProps {
  /** Inyectables en tests; en producción los defaults (registro real + localStorage). */
  collections?: readonly ExerciseCollectionData[]
  storage?: StorageLike
}

interface Selection {
  collectionId: string
  index: number
}

interface LessonSelection {
  lessonId: string
  /** 'teoria' -> exercises[0..5] -> 'practicar'. */
  step: 'teoria' | number | 'practicar'
}

/** Estado visible de un ejercicio en la lista: glifo del motivo ●○ del sistema. */
function stateGlyph(progress: ProgressMap, id: string): { glyph: string; title: string; modifier: string } {
  const estado = progress[id]?.estado
  if (estado === 'resuelto') return { glyph: '●', title: 'Resuelto', modifier: 'resuelto' }
  if (estado === 'intentado') return { glyph: '○', title: 'Intentado', modifier: 'intentado' }
  return { glyph: '·', title: 'Pendiente', modifier: 'pendiente' }
}

/** Estado visible de una LECCIÓN en la lista del currículo: análogo a `stateGlyph`, pero agregado
 * sobre los 6 ejercicios de la lección (no un solo id) más `isLessonUnlocked`. Reusa el vocabulario
 * ●/○/· de `stateGlyph` para 'resuelto'/'intentado'/'pendiente'; 'bloqueado' usa '–' (raya, NO
 * emoji): un glifo geométrico plano que no compite con la familia ●○· ni introduce un pictograma
 * (spec, Pieza 4; `.kntor-design-atomic/system.md` documenta esa familia como "la firma de la
 * sección"). Los títulos llevan el prefijo "Lección" para no colisionar (mismo texto que
 * `stateGlyph` produciría) cuando ambas listas -- Currículo y Colecciones -- están en la misma
 * pantalla, como en los tests. */
function lessonGlyph(
  lessons: readonly Lesson[],
  progress: ProgressMap,
  lesson: Lesson,
): { glyph: string; title: string; modifier: string } {
  if (!isLessonUnlocked(lessons, progress, lesson.id)) {
    return { glyph: '–', title: 'Lección bloqueada', modifier: 'bloqueado' }
  }
  const estados = lesson.exercises.map((ex) => progress[ex.id]?.estado)
  if (estados.every((estado) => estado === 'resuelto')) {
    return { glyph: '●', title: 'Lección resuelta', modifier: 'resuelto' }
  }
  if (estados.some((estado) => estado === 'resuelto' || estado === 'intentado')) {
    return { glyph: '○', title: 'Lección en progreso', modifier: 'intentado' }
  }
  return { glyph: '·', title: 'Lección pendiente', modifier: 'pendiente' }
}

export function AprenderView({ collections = COLLECTIONS, storage = window.localStorage }: AprenderViewProps) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [lessonSelection, setLessonSelection] = useState<LessonSelection | null>(null)

  if (selection) {
    const collection = collections.find((c) => c.id === selection.collectionId)
    const exercise = collection?.exercises[selection.index]
    if (collection && exercise) {
      const hasNext = selection.index + 1 < collection.exercises.length
      return (
        <ModelGate net={LEARN_NETWORK}>
          <EngineExercisePlayer
            key={exercise.id}
            exercise={exercise}
            storage={storage}
            onBackToList={() => setSelection(null)}
            {...(hasNext ? { onNext: () => setSelection({ ...selection, index: selection.index + 1 }) } : {})}
          />
        </ModelGate>
      )
    }
    // Selección huérfana (colección cambiada entre renders): de vuelta a la lista, sin lanzar.
    setSelection(null)
  }

  if (lessonSelection) {
    const lesson = CURRICULUM.find((l) => l.id === lessonSelection.lessonId)
    if (lesson) {
      if (lessonSelection.step === 'teoria') {
        return (
          <main class="card-screen">
            <h1>{lesson.title}</h1>
            {lesson.theory.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            <button type="button" onClick={() => setLessonSelection({ ...lessonSelection, step: 0 })}>
              Empezar los 6 problemas
            </button>
            <button type="button" class="ghost" onClick={() => setLessonSelection(null)}>
              Volver
            </button>
          </main>
        )
      }
      if (lessonSelection.step === 'practicar') {
        return (
          <main class="card-screen">
            <h1>Practicá lo que aprendiste</h1>
            <p>Una partida contra Human SL, calibrado a {lesson.practiceOpponent.rank}.</p>
            <button type="button" class="primary" onClick={() => route(`/jugar?practica=${lesson.id}`)}>
              Jugar contra Human SL {lesson.practiceOpponent.rank}
            </button>
            <button type="button" class="ghost" onClick={() => setLessonSelection(null)}>
              Volver al currículo
            </button>
          </main>
        )
      }
      const index = lessonSelection.step
      const exercise = lesson.exercises[index]
      if (exercise) {
        const hasNext = index + 1 < lesson.exercises.length
        const playerProps = {
          key: exercise.id,
          exercise,
          storage,
          onBackToList: () => setLessonSelection(null),
          ...(hasNext
            ? { onNext: () => setLessonSelection({ ...lessonSelection, step: index + 1 }) }
            : { onNext: () => setLessonSelection({ ...lessonSelection, step: 'practicar' as const }) }),
        }
        // Esta rama renderiza sin motor para CUALQUIER lección de `CURRICULUM`, sin importar el
        // bloque -- el `engineless` de más abajo no condiciona por bloque. Es seguro porque el
        // score de KataGo da señal EQUIVOCADA en estas posiciones 9x9 dispersas -- un tenuki (jugar
        // en otro lado) puntuó 7-15 puntos MEJOR que la captura correcta de un grupo ya muerto y
        // completamente sellado (medido en el spike de la Task 8 del plan del Bloque 1, ya hecho).
        // Dentro del Bloque 1, antes solo las Lecciones 1-3 eran engineless (spec, Pieza 3); Edgar
        // confirmó extenderlo a 4-5 el 2026-09-15, lo que además evita la descarga bloqueante de
        // ~110MB y ~25s de `ModelGate` en esas dos -- el Bloque 2, al sumarse entero por esta misma
        // rama, hereda el mismo ahorro sin necesitar una decisión aparte. El camino CON motor
        // (`ModelGate` + `EngineExercisePlayer`) sigue existiendo -- lo usa "Primeros pasos"
        // (Colecciones), la sección aparte más abajo.
        return <ExercisePlayer {...playerProps} engineless />
      }
    }
    // Selección huérfana (currículo cambiado entre renders, o índice inválido): de vuelta a la
    // lista, sin lanzar -- mismo criterio que la selección de colecciones de arriba.
    setLessonSelection(null)
  }

  // El progreso se relee en cada render de la lista: volver del player ya refleja lo recién jugado.
  const progress = loadProgress(storage)

  return (
    <main class="card-screen aprender-list">
      <h1>Aprender</h1>
      <p>Vida y muerte con el motor de verdad: si tu jugada no está en la solución, KataGo te muestra cuánto costó.</p>
      <p class="hint">
        Con gracias a la{' '}
        <a href="https://www.fedibergo.org/ensananza" target="_blank" rel="noopener noreferrer">
          Federación Iberoamericana de Go
        </a>{' '}
        por su material de enseñanza, usado como referencia.
      </p>
      <section class="aprender-collection">
        <h2>Currículo</h2>
        <ul class="exercise-list">
          {CURRICULUM.map((lesson) => {
            const state = lessonGlyph(CURRICULUM, progress, lesson)
            const unlocked = state.modifier !== 'bloqueado'
            return (
              <li key={lesson.id}>
                <button
                  type="button"
                  class="exercise-row"
                  disabled={!unlocked}
                  onClick={() => unlocked && setLessonSelection({ lessonId: lesson.id, step: 'teoria' })}
                >
                  <span class={`exercise-state exercise-state--${state.modifier}`} title={state.title}>
                    {state.glyph}
                  </span>
                  <span class="exercise-row-label">{lesson.title}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
      {collections.length === 0 && (
        <p class="hint">
          Todavía no hay ejercicios publicados. Las colecciones clásicas están en curaduría (el veredicto de
          licencias manda).
        </p>
      )}
      {collections.map((collection) => (
        <section key={collection.id} class="aprender-collection">
          <h2>{collection.title}</h2>
          <ul class="exercise-list">
            {collection.exercises.map((exercise: Exercise, index: number) => {
              const state = stateGlyph(progress, exercise.id)
              return (
                <li key={exercise.id}>
                  <button
                    type="button"
                    class="exercise-row"
                    onClick={() => setSelection({ collectionId: collection.id, index })}
                  >
                    <span class={`exercise-state exercise-state--${state.modifier}`} title={state.title}>
                      {state.glyph}
                    </span>
                    <span class="exercise-row-label">Problema {index + 1}</span>
                    <span class="exercise-row-meta">
                      {exercise.objective === 'desconocido' ? '' : exercise.objective}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </main>
  )
}

interface EngineExercisePlayerProps {
  exercise: Exercise
  storage: StorageLike
  onBackToList(): void
  onNext?(): void
}

/** Envuelto en `ModelGate` desde `AprenderView`: el ONNX ya está en OPFS cuando esto monta.
 * Patrón exacto de `ReadyAnalyzeView`: manager/scheduler en refs (fijos por montaje), ensureReady
 * al montar, dispose al desmontar — más `cancelGroup('learn')`, que corta cualquier refutación en
 * vuelo al cambiar de ejercicio (este componente se remonta por `key={exercise.id}`). */
function EngineExercisePlayer({ exercise, storage, onBackToList, onNext }: EngineExercisePlayerProps) {
  const managerRef = useRef<EngineManager | null>(null)
  if (!managerRef.current) managerRef.current = new EngineManager(createWorkerManagedEngine)
  const manager = managerRef.current

  const schedulerRef = useRef<ReviewScheduler | null>(null)
  if (!schedulerRef.current) schedulerRef.current = new ReviewScheduler(manager)
  const scheduler = schedulerRef.current

  const [booting, setBooting] = useState(true)
  const [engineError, setEngineError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    manager
      .ensureReady(LEARN_NETWORK, exercise.boardSize)
      .then(() => {
        if (!stale) setBooting(false)
      })
      .catch((e: unknown) => {
        if (stale) return
        setEngineError(`No se pudo inicializar el motor (${e instanceof Error ? e.message : String(e)}).`)
        setBooting(false)
      })
    return () => {
      stale = true
      scheduler.cancelGroup(LEARN_ANALYSIS_GROUP)
      scheduler.dispose()
      manager.dispose()
    }
    // Una sola vez: manager/scheduler son fijos durante la vida del componente (remonta por key).
  }, [])

  return (
    <>
      {engineError !== null && <p class="notice notice--danger aprender-engine-error">{engineError}</p>}
      <ExercisePlayer
        exercise={exercise}
        storage={storage}
        scheduler={scheduler}
        booting={booting}
        onBackToList={onBackToList}
        {...(onNext ? { onNext } : {})}
      />
    </>
  )
}
