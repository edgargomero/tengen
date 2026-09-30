// @vitest-environment jsdom
//
// Fase Aprender Bloque 3 T3: tests de `CountingExercisePlayer` -- el player de un ejercicio de
// CONTEO (posición terminada, sin jugada). Cubre: calificación en vivo contra `countArea` (con y
// sin komi), el desglose de feedback ante un fallo, `recordResult` marcando resuelto/intentado, que
// "Mostrar la respuesta" cuenta como intento fallado solo si no estaba ya resuelto, y que un input
// vacío nunca califica como una respuesta "0".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import { CountingExercisePlayer } from '../src/ui/CountingExercisePlayer'
import type { CountingExercise } from '../src/learn/countingExercise'
import type { StorageLike } from '../src/game/persistence'

// jsdom no trae ResizeObserver y `useBoundedBoardSize` lo instancia al montar. El stub es inerte:
// estos tests inyectan `boardBounds` fijos, así que la medición real nunca se usa (mismo patrón que
// AprenderView.test.tsx).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

afterEach(() => {
  cleanup()
})

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v
    },
    removeItem: (k) => {
      delete data[k]
    },
  }
}

const PROGRESS_KEY = 'tengen:learn:v1'
const BOUNDS = { maxWidth: 600, maxHeight: 600 }

// Mismo muro adyacente negro(x=4)/blanco(x=5) de territory.test.ts / countingExercise.test.ts --
// calculado a mano: countArea da negro=45, blanco=36, sin dame (9×9).
const SIZE = 9
const SETUP = {
  black: Array.from({ length: SIZE }, (_, y) => ({ x: 4, y })),
  white: Array.from({ length: SIZE }, (_, y) => ({ x: 5, y })),
}

function countingExercise(overrides: Partial<CountingExercise> = {}): CountingExercise {
  return {
    kind: 'conteo',
    id: 'test-conteo-001',
    collection: 'test',
    boardSize: SIZE,
    setup: { black: [...SETUP.black], white: [...SETUP.white] },
    correctScore: { black: 45, white: 36 },
    ...overrides,
  }
}

function progressOf(storage: StorageLike): Record<string, { estado: string; intentos: number }> {
  return JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, { estado: string; intentos: number }>
}

function fillAndGrade(black: string, white: string): void {
  fireEvent.change(screen.getByLabelText(/puntos negro/i), { target: { value: black } })
  fireEvent.change(screen.getByLabelText(/puntos blanco/i), { target: { value: white } })
  fireEvent.click(screen.getByRole('button', { name: /calificar/i }))
}

describe('CountingExercisePlayer', () => {
  it('grading correcto SIN komi resuelve y escribe el progreso', () => {
    const storage = memoryStorage()
    render(
      <CountingExercisePlayer
        exercise={countingExercise()}
        storage={storage}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    fillAndGrade('45', '36')
    expect(screen.getByText(/¡resuelto!/i)).toBeInTheDocument()
    expect(screen.getByText(/B\+9\.0/)).toBeInTheDocument()
    expect(progressOf(storage)['test-conteo-001']?.estado).toBe('resuelto')
  })

  it('grading correcto CON komi resuelve solo si Blanco incluye el komi', () => {
    const storage = memoryStorage()
    render(
      <CountingExercisePlayer
        exercise={countingExercise({ komi: 5.5 })}
        storage={storage}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    // El label aclara que el campo pide el total CON komi.
    expect(screen.getByText(/puntos blanco \(con komi\)/i)).toBeInTheDocument()
    // 36 (countArea, SIN komi) sería incorrecto: el campo pide 36 + 5.5 = 41.5.
    fillAndGrade('45', '36')
    expect(screen.getByText(/no es correcto/i)).toBeInTheDocument()
    expect(progressOf(storage)['test-conteo-001']?.estado).toBe('intentado')

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    fillAndGrade('45', '41.5')
    expect(screen.getByText(/¡resuelto!/i)).toBeInTheDocument()
    expect(screen.getByText(/B\+3\.5/)).toBeInTheDocument()
    expect(progressOf(storage)['test-conteo-001']?.estado).toBe('resuelto')
  })

  it('una respuesta incorrecta muestra el desglose de piedras+territorio y registra el intento', () => {
    const storage = memoryStorage()
    render(
      <CountingExercisePlayer
        exercise={countingExercise()}
        storage={storage}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    fillAndGrade('10', '10')
    const feedback = screen.getByText(/no es correcto/i)
    expect(feedback).toHaveTextContent('Negro: 45')
    expect(feedback).toHaveTextContent('Blanco: 36')
    expect(feedback).toHaveTextContent('B+9.0')
    expect(progressOf(storage)['test-conteo-001']?.estado).toBe('intentado')
    expect(progressOf(storage)['test-conteo-001']?.intentos).toBe(1)
  })

  it('input vacío NO califica como 0: el botón Calificar queda deshabilitado hasta completar ambos campos', () => {
    const storage = memoryStorage()
    render(
      <CountingExercisePlayer
        exercise={countingExercise()}
        storage={storage}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    const gradeButton = screen.getByRole('button', { name: /calificar/i })
    expect(gradeButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/puntos negro/i), { target: { value: '0' } })
    expect(gradeButton).toBeDisabled() // Blanco sigue vacío: no alcanza con un solo campo.

    fireEvent.change(screen.getByLabelText(/puntos blanco/i), { target: { value: '0' } })
    expect(gradeButton).not.toBeDisabled()

    // Sometiendo el form directamente (bypass del disabled del botón): la guarda interna de
    // `handleGrade` también depende de que ambos campos tengan valor, así que un envío con un campo
    // vacío no debe calificar ni tocar el progreso.
    fireEvent.change(screen.getByLabelText(/puntos blanco/i), { target: { value: '' } })
    fireEvent.submit(document.querySelector('form')!)
    expect(progressOf(storage)['test-conteo-001']).toBeUndefined()
  })

  it('tipear (evento input, sin perder foco) habilita Calificar', () => {
    render(
      <CountingExercisePlayer
        exercise={countingExercise()}
        storage={memoryStorage()}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    const gradeButton = screen.getByRole('button', { name: /calificar/i })
    expect(gradeButton).toBeDisabled()
    fireEvent.input(screen.getByLabelText(/puntos negro/i), { target: { value: '45' } })
    fireEvent.input(screen.getByLabelText(/puntos blanco/i), { target: { value: '36' } })
    expect(gradeButton).not.toBeDisabled()
  })

  it('"Mostrar la respuesta" cuenta como intento fallado si no estaba ya resuelto, y revela el valor calculado en vivo', () => {
    const storage = memoryStorage()
    render(
      <CountingExercisePlayer
        exercise={countingExercise({ komi: 5.5 })}
        storage={storage}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /mostrar la respuesta/i }))
    expect(progressOf(storage)['test-conteo-001']?.estado).toBe('intentado')
    expect(screen.getByLabelText(/puntos negro/i)).toHaveValue(45)
    expect(screen.getByLabelText(/puntos blanco/i)).toHaveValue(41.5)
    expect(screen.getByText(/B\+3\.5/)).toBeInTheDocument()
  })

  it('"Mostrar la respuesta" NO degrada un ejercicio ya resuelto a intentado', () => {
    const storage = memoryStorage()
    render(
      <CountingExercisePlayer
        exercise={countingExercise()}
        storage={storage}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    fillAndGrade('45', '36')
    expect(progressOf(storage)['test-conteo-001']?.estado).toBe('resuelto')
    fireEvent.click(screen.getByRole('button', { name: /mostrar la respuesta/i }))
    expect(progressOf(storage)['test-conteo-001']?.estado).toBe('resuelto')
  })

  it('Reintentar limpia los campos, el feedback y permite un nuevo intento', () => {
    const storage = memoryStorage()
    render(
      <CountingExercisePlayer
        exercise={countingExercise()}
        storage={storage}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    fillAndGrade('1', '1')
    expect(screen.getByText(/no es correcto/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(screen.getByLabelText(/puntos negro/i)).toHaveValue(null)
    expect(screen.getByLabelText(/puntos blanco/i)).toHaveValue(null)
    expect(screen.queryByText(/no es correcto/i)).not.toBeInTheDocument()
    fillAndGrade('45', '36')
    expect(screen.getByText(/¡resuelto!/i)).toBeInTheDocument()
  })
})
