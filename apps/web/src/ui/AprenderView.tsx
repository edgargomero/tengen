// Fase Aprender T6: la sección /aprender. Dos niveles con estado interno (sin sub-rutas, como
// PartidasView):
//   1. Colecciones → lista de ejercicios (.card-screen). SIN ModelGate: la lista se navega sin
//      descargar el modelo — el gate aparece recién al abrir un ejercicio.
//   2. Player: <ModelGate net='b18'> → EngineExercisePlayer (patrón exacto de ReadyAnalyzeView:
//      EngineManager + ReviewScheduler en refs, ensureReady('b18', 19), dispose al desmontar) →
//      ExercisePlayer (interacción pura, testeable con scheduler mock).
import type { RoutableProps } from 'preact-router'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { NetworkId } from '@tengen/engine'
import { EngineManager } from '../engine/engineManager'
import { createWorkerManagedEngine } from '../engine/workerManagedEngine'
import { ReviewScheduler } from '../analysis/reviewScheduler'
import { ModelGate } from '../models/ModelGate'
import { COLLECTIONS, type ExerciseCollectionData } from '../learn/collections'
import type { Exercise } from '../learn/exercise'
import { LEARN_ANALYSIS_GROUP } from '../learn/engineRefutation'
import { loadProgress, type ProgressMap } from '../learn/progress'
import type { StorageLike } from '../game/persistence'
import { ExercisePlayer } from './ExercisePlayer'

export type { ExerciseCollectionData } from '../learn/collections'

/** La red del player: la principal de la app (no hay red chica; decisión del plan de la fase). */
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

/** Estado visible de un ejercicio en la lista: glifo del motivo ●○ del sistema. */
function stateGlyph(progress: ProgressMap, id: string): { glyph: string; title: string; modifier: string } {
  const estado = progress[id]?.estado
  if (estado === 'resuelto') return { glyph: '●', title: 'Resuelto', modifier: 'resuelto' }
  if (estado === 'intentado') return { glyph: '○', title: 'Intentado', modifier: 'intentado' }
  return { glyph: '·', title: 'Pendiente', modifier: 'pendiente' }
}

export function AprenderView({ collections = COLLECTIONS, storage = window.localStorage }: AprenderViewProps) {
  const [selection, setSelection] = useState<Selection | null>(null)

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

  // El progreso se relee en cada render de la lista: volver del player ya refleja lo recién jugado.
  const progress = loadProgress(storage)

  return (
    <main class="card-screen aprender-list">
      <h1>Aprender</h1>
      <p>Vida y muerte con el motor de verdad: si tu jugada no está en la solución, KataGo te muestra cuánto costó.</p>
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
