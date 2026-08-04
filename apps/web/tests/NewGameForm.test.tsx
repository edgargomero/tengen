// @vitest-environment jsdom
//
// Tests de componente del formulario de nueva partida. Lo que se verifica acá es el objetivo entero
// del cambio de fuerza por dispositivo: en un teléfono el formulario tiene que emitir 25 visitas
// (~15 s por jugada a las ~1,5 visitas/s medidas en un iPhone 12) y en escritorio seguir emitiendo
// las de siempre. Es la única prueba automática que recorre el camino completo —user agent →
// `kataStrengthOptions()` → estado inicial → `GameConfig` emitido—; los tests de dominio sólo cubren
// los tramos sueltos.
//
// Cleanup POR-ARCHIVO: la config de vitest no usa `globals: true`, así que el auto-cleanup de
// testing-library no dispara solo (ver `AnnotationEditor.test.tsx`).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import { NewGameForm } from '../src/ui/NewGameForm'
import type { GameConfig } from '../src/game/gameConfig'
import { CHROME_IOS, CHROME_MAC } from './fixtures/userAgents'

/**
 * Stub QUIRÚRGICO del user agent: define una propiedad propia que tapa el getter del prototipo, en
 * vez de reemplazar `navigator` entero con `vi.stubGlobal`. Sustituir el objeto rompería a jsdom y a
 * testing-library, que leen otros campos del mismo `navigator`.
 *
 * Tiene que llamarse ANTES de `render`: `kataStrengthOptions()` se consume durante el render y el
 * valor inicial de `useState` se fija en el montaje. Ponerlo después daría el default de escritorio
 * en silencio, y el test pasaría probando lo contrario de lo que dice.
 */
function conUserAgent(ua: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

afterEach(() => {
  // `configurable: true` es lo que permite borrarla y volver al getter real de jsdom. Sin esto, el
  // primer test que stubea un UA de móvil se lo dejaría puesto a todos los siguientes.
  Reflect.deleteProperty(window.navigator, 'userAgent')
  cleanup()
})

/** Renderiza el formulario y devuelve el mock de `onStart` para aseverar sobre el config emitido. */
function renderForm(): ReturnType<typeof vi.fn<(c: GameConfig) => void>> {
  const onStart = vi.fn<(c: GameConfig) => void>()
  render(<NewGameForm onStart={onStart} onBack={vi.fn()} />)
  return onStart
}

/** Manda el formulario como lo haría el usuario y devuelve el `GameConfig` que salió. */
function empezar(onStart: ReturnType<typeof renderForm>): GameConfig {
  fireEvent.click(screen.getByRole('button', { name: 'Empezar partida' }))
  expect(onStart).toHaveBeenCalledOnce()
  return onStart.mock.calls[0]![0]
}

describe('NewGameForm en móvil — una sola fuerza, la que responde en ~15 s', () => {
  it('emite 25 visitas sin que el usuario toque nada', () => {
    conUserAgent(CHROME_IOS)
    const config = empezar(renderForm())
    expect(config.opponent).toEqual({ kind: 'kata', visits: 25 })
  })

  it('no dibuja la fila de fuerza: una elección de una opción no es una elección', () => {
    conUserAgent(CHROME_IOS)
    renderForm()
    expect(screen.queryByRole('group', { name: 'Fuerza' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fuerza media' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fuerza alta' })).not.toBeInTheDocument()
  })

  it('explica POR QUÉ no hay más opciones, para que nadie las busque', () => {
    conUserAgent(CHROME_IOS)
    renderForm()
    expect(screen.getByText(/fuerza baja.*15 s por jugada/i)).toBeInTheDocument()
  })
})

describe('NewGameForm en escritorio — las tres de siempre', () => {
  it('arranca en la más débil (50), no en la media: el default es lo primero que se sufre', () => {
    conUserAgent(CHROME_MAC)
    const config = empezar(renderForm())
    expect(config.opponent).toEqual({ kind: 'kata', visits: 50 })
  })

  it('marca "Fuerza baja" como la elegida al abrir', () => {
    conUserAgent(CHROME_MAC)
    renderForm()
    expect(screen.getByRole('button', { name: 'Fuerza baja' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'Fuerza media' })).not.toHaveClass('active')
  })

  it('elegir "Media" emite 200 visitas', () => {
    conUserAgent(CHROME_MAC)
    const onStart = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Fuerza media' }))
    expect(empezar(onStart).opponent).toEqual({ kind: 'kata', visits: 200 })
  })

  it('elegir "Alta" emite 500 visitas', () => {
    conUserAgent(CHROME_MAC)
    const onStart = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Fuerza alta' }))
    expect(empezar(onStart).opponent).toEqual({ kind: 'kata', visits: 500 })
  })
})

describe('NewGameForm — el selector de oponente', () => {
  it('los botones de fuerza se anuncian con su nombre completo, no con el rótulo corto', () => {
    // El texto visible es "Baja" porque el eyebrow de arriba ya dice FUERZA; fuera de ese contexto
    // visual —un lector de pantalla -— "Baja" no significa nada. El nombre accesible CONTIENE al
    // visible, que es lo que pide el criterio "Label in Name" (WCAG 2.5.3).
    conUserAgent(CHROME_MAC)
    renderForm()
    const baja = screen.getByRole('button', { name: 'Fuerza baja' })
    expect(baja).toHaveTextContent('Baja')
    expect(baja).not.toHaveTextContent('Fuerza baja')
  })

  it('elegir Human SL cambia el nivel por el ranking, y el config lo refleja', () => {
    conUserAgent(CHROME_MAC)
    const onStart = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Human SL (estilo humano)' }))
    // La fuerza de KataGo deja de ofrecerse: no aplica a este oponente.
    expect(screen.queryByRole('button', { name: 'Fuerza baja' })).not.toBeInTheDocument()
    const nivel = screen.getByRole('combobox', { name: 'Nivel' })
    fireEvent.change(nivel, { target: { value: '3d' } })
    expect(empezar(onStart).opponent).toEqual({ kind: 'human', rank: '3d' })
  })

  it('el oponente elegido queda "encendido" y el otro no', () => {
    conUserAgent(CHROME_MAC)
    renderForm()
    const kata = screen.getByRole('button', { name: 'KataGo' })
    const human = screen.getByRole('button', { name: 'Human SL (estilo humano)' })
    expect(kata).toHaveClass('active')
    expect(kata).toHaveAttribute('aria-pressed', 'true')
    expect(human).not.toHaveClass('active')
    fireEvent.click(human)
    expect(screen.getByRole('button', { name: 'Human SL (estilo humano)' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: 'KataGo' })).not.toHaveClass('active')
  })

  it('el grupo de oponente conserva la agrupación semántica que daba el <fieldset>', () => {
    conUserAgent(CHROME_MAC)
    renderForm()
    expect(screen.getByRole('group', { name: 'Oponente' })).toBeInTheDocument()
  })
})

describe('NewGameForm — rediseño compacto (crítica 2026-08-03)', () => {
  it('el tamaño se elige con botones a la vista y emite el elegido', () => {
    conUserAgent(CHROME_MAC)
    const onStart = renderForm()
    fireEvent.click(screen.getByRole('button', { name: '19×19' }))
    expect(empezar(onStart).boardSize).toBe(19)
  })

  it('el color se elige con la piedra en la mano: "○ Blanco" emite white', () => {
    conUserAgent(CHROME_MAC)
    const onStart = renderForm()
    // El nombre accesible es la palabra sola: el glifo es ruido para un lector de pantalla.
    fireEvent.click(screen.getByRole('button', { name: 'Blanco' }))
    expect(empezar(onStart).humanColor).toBe('white')
  })

  it('negro es el default y queda encendido al abrir', () => {
    conUserAgent(CHROME_MAC)
    renderForm()
    expect(screen.getByRole('button', { name: 'Negro' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Blanco' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('la liturgia plegada resume su estado sin abrirse', () => {
    // El summary del <details> tiene que decir con qué se va a jugar aunque nadie lo abra:
    // defaults = chinas · komi 7 · sin handicap · 10 min + 5×30 s (9×9).
    conUserAgent(CHROME_MAC)
    renderForm()
    expect(screen.getByText('chinas · komi 7 · sin handicap · 10 min + 5×30 s')).toBeInTheDocument()
  })

  it('cambiar las reglas dentro del pliegue actualiza komi y resumen', () => {
    conUserAgent(CHROME_MAC)
    const onStart = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Japonesas' }))
    expect(screen.getByText(/japonesas · komi 6\.5/)).toBeInTheDocument()
    const config = empezar(onStart)
    expect(config.rules).toBe('japanese')
    expect(config.komi).toBe(6.5)
  })

  it('la marca no se duplica: el título dice qué hace la pantalla, no tengen', () => {
    // El marco ya muestra "tengen · Jugar" arriba; el h1 del formulario dejó de repetirlo.
    conUserAgent(CHROME_MAC)
    renderForm()
    expect(screen.getByRole('heading', { name: 'Nueva partida' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'tengen' })).not.toBeInTheDocument()
  })
})
