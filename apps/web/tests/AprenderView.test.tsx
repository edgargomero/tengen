// @vitest-environment jsdom
//
// Tests de componente de la sección Aprender (fase Aprender T6). Dos superficies:
// - La LISTA pinta el estado de cada ejercicio desde el storage inyectado (sin ModelGate: navegar
//   la lista no descarga ningún modelo).
// - El PLAYER (`ExercisePlayer`, exportado aparte justamente para esto) valida una jugada correcta
//   SIN motor: el scheduler es un mock por parámetro y solo se consulta ante fuera-de-árbol.
//
// Cleanup POR-ARCHIVO: la config de vitest no usa `globals: true` (ver `NewGameForm.test.tsx`).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import type { Analysis, Position } from '@tengen/engine'
import { AprenderView, type ExerciseCollectionData } from '../src/ui/AprenderView'
import { ExercisePlayer } from '../src/ui/ExercisePlayer'
import type { Exercise, ExerciseNode } from '../src/learn/exercise'
import type { StorageLike } from '../src/game/persistence'

// jsdom no trae ResizeObserver y `useBoundedBoardSize` lo instancia al montar. El stub es inerte:
// estos tests inyectan `boardBounds` fijos, así que la medición real nunca se usa.
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

const n = (partial: Partial<ExerciseNode>): ExerciseNode => ({ children: [], ...partial })
const B = (x: number, y: number) => ({ color: 'black' as const, vertex: { x, y } })
const W = (x: number, y: number) => ({ color: 'white' as const, vertex: { x, y } })

function demoExercise(id: string): Exercise {
  return {
    id,
    collection: 'demo',
    boardSize: 19,
    setup: {
      black: [
        { x: 0, y: 2 },
        { x: 1, y: 1 },
        { x: 2, y: 0 },
      ],
      white: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    },
    toPlay: 'black',
    objective: 'matar',
    tree: n({
      comment: 'Las blancas viven o mueren en la esquina.',
      children: [
        n({ move: B(0, 1), correct: true, comment: 'Captura limpia' }),
        n({ move: B(6, 6), correct: false, comment: 'Deja vivir', children: [n({ move: W(7, 7) })] }),
      ],
    }),
  }
}

const COLLECTION: ExerciseCollectionData = {
  id: 'demo',
  title: 'Colección de prueba',
  exercises: [demoExercise('demo-001'), demoExercise('demo-002')],
}

const PROGRESS_KEY = 'tengen:learn:v1'
const BOUNDS = { maxWidth: 600, maxHeight: 600 }

describe('AprenderView — lista', () => {
  it('pinta cada ejercicio con su estado desde el storage (resuelto / intentado / pendiente)', () => {
    const storage = memoryStorage({
      [PROGRESS_KEY]: JSON.stringify({
        'demo-001': { estado: 'resuelto', intentos: 2, resueltoEn: 't' },
      }),
    })
    render(<AprenderView collections={[COLLECTION]} storage={storage} />)
    expect(screen.getByText('Colección de prueba')).toBeInTheDocument()
    expect(screen.getByTitle('Resuelto')).toBeInTheDocument()
    expect(screen.getByTitle('Pendiente')).toBeInTheDocument()
    expect(screen.getByText('Problema 1')).toBeInTheDocument()
    expect(screen.getByText('Problema 2')).toBeInTheDocument()
  })

  it('sin colecciones muestra un estado vacío honesto, no una pantalla en blanco', () => {
    render(<AprenderView collections={[]} storage={memoryStorage()} />)
    expect(screen.getByText(/todavía no hay ejercicios/i)).toBeInTheDocument()
  })
})

function mockScheduler(before: Analysis, after: Analysis) {
  return {
    analyzePosition: vi.fn(async (args: { pos: Position }) => (args.pos.moves.length === 0 ? before : after)),
  }
}

function analysis(scoreLead: number): Analysis {
  return { winrate: 0.5, scoreLead, scoreStdev: 1, visits: 64, moves: [] }
}

function clickVertex(x: number, y: number): void {
  const vertex = document.querySelector(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)
  expect(vertex).not.toBeNull()
  fireEvent.click(vertex!)
}

describe('ExercisePlayer', () => {
  it('la jugada correcta resuelve sin consultar la jugada al motor y escribe el progreso', async () => {
    const storage = memoryStorage()
    const scheduler = mockScheduler(analysis(0), analysis(0))
    render(
      <ExercisePlayer
        exercise={demoExercise('demo-001')}
        storage={storage}
        scheduler={scheduler}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    clickVertex(0, 1)
    expect(await screen.findByText(/resuelto/i)).toBeInTheDocument()
    expect(screen.getByText(/captura limpia/i)).toBeInTheDocument()
    // El único tráfico al motor permitido acá es el PRECALENTAMIENTO del baseline (posición raíz,
    // 0 jugadas): la validación de la jugada en sí nunca consulta al motor.
    for (const call of scheduler.analyzePosition.mock.calls) {
      expect(call[0].pos.moves).toEqual([])
    }
    const saved = JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, { estado: string }>
    expect(saved['demo-001']?.estado).toBe('resuelto')
  })

  it('muestra el enunciado del problema (comentario raíz) mientras no hay feedback, y lo cede al feedback', async () => {
    render(
      <ExercisePlayer
        exercise={demoExercise('demo-001')}
        storage={memoryStorage()}
        scheduler={mockScheduler(analysis(0), analysis(0))}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    expect(screen.getByText(/las blancas viven o mueren/i)).toBeInTheDocument()
    clickVertex(0, 1)
    await screen.findByText(/resuelto/i)
    expect(screen.queryByText(/las blancas viven o mueren/i)).not.toBeInTheDocument()
  })

  it('al montar precalienta el baseline de la raíz con prioridad review (el primer veredicto cuesta UN análisis)', async () => {
    const scheduler = mockScheduler(analysis(5), analysis(2))
    render(
      <ExercisePlayer
        exercise={demoExercise('demo-001')}
        storage={memoryStorage()}
        scheduler={scheduler}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    await waitFor(() => expect(scheduler.analyzePosition).toHaveBeenCalledTimes(1))
    const args = scheduler.analyzePosition.mock.calls[0]![0]
    expect(args).toMatchObject({ priority: 'review', group: 'learn' })
    expect(args.pos.moves).toEqual([])
  })

  it('una jugada incorrecta DEL árbol muestra la refutación y registra el intento', async () => {
    const storage = memoryStorage()
    render(
      <ExercisePlayer
        exercise={demoExercise('demo-001')}
        storage={storage}
        scheduler={mockScheduler(analysis(0), analysis(0))}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    clickVertex(6, 6)
    expect(await screen.findByText(/deja vivir/i)).toBeInTheDocument()
    const saved = JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, { estado: string }>
    expect(saved['demo-001']?.estado).toBe('intentado')
  })

  it('fuera del árbol consulta al motor (mock) y muestra el veredicto en puntos', async () => {
    const scheduler = mockScheduler(analysis(5), analysis(2))
    render(
      <ExercisePlayer
        exercise={demoExercise('demo-001')}
        storage={memoryStorage()}
        scheduler={scheduler}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    clickVertex(9, 9)
    expect(await screen.findByText(/regala ~3 puntos/i)).toBeInTheDocument()
    expect(scheduler.analyzePosition).toHaveBeenCalled()
  })

  it('Reintentar tras un fallo vuelve al setup y deja jugar de nuevo', async () => {
    render(
      <ExercisePlayer
        exercise={demoExercise('demo-001')}
        storage={memoryStorage()}
        scheduler={mockScheduler(analysis(0), analysis(0))}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    clickVertex(6, 6)
    await screen.findByText(/deja vivir/i)
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    clickVertex(0, 1)
    expect(await screen.findByText(/resuelto/i)).toBeInTheDocument()
  })

  it('Ver solución reproduce la línea principal numerada y cuenta como intento fallado', async () => {
    const storage = memoryStorage()
    render(
      <ExercisePlayer
        exercise={demoExercise('demo-001')}
        storage={storage}
        scheduler={mockScheduler(analysis(0), analysis(0))}
        boardBounds={BOUNDS}
        onBackToList={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /ver solución/i }))
    await waitFor(() => {
      const saved = JSON.parse(storage.getItem(PROGRESS_KEY) ?? '{}') as Record<string, { estado: string }>
      expect(saved['demo-001']?.estado).toBe('intentado')
    })
    // La primera jugada de la solución queda numerada sobre el tablero (marker label "1").
    expect(document.querySelector('.shudan-vertex[data-x="0"][data-y="1"] .shudan-marker')).not.toBeNull()
  })
})
