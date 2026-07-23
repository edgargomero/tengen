// @vitest-environment jsdom
//
// Tests de componente (jsdom + @testing-library/preact) del editor de repaso extraído de
// `AnalyzeView.tsx`. Automatizan la verificación de UI que antes era 100% manual en Chrome:
// paleta de herramientas, binding del comentario, ops de árbol y sus estados deshabilitados.
// El componente es presentación pura (no toca el motor), así que corre sin worker/WebGPU/Shudan.
//
// Cleanup POR-ARCHIVO: la config de vitest no usa `globals: true`, así que el auto-cleanup de
// testing-library (que engancha un `afterEach` global) no dispara — hay que registrarlo a mano o
// el segundo `render()` deja dos árboles en el DOM y las queries fallan con "multiple elements".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import { AnnotationEditor, type AnnotationEditorProps } from '../src/ui/AnnotationEditor'
import type { GameNode } from '../src/game/gameTree'

afterEach(cleanup)

/** Stub deliberadamente parcial: el componente lee ÚNICAMENTE `node.comment` (ver su cabecera), así
 *  que no hace falta construir un `GameTree`/`GameNode` real. */
function makeNode(comment?: string): GameNode {
  return { comment } as unknown as GameNode
}

/** Renderiza con defaults sensatos (edición abierta, fuera de la raíz, motor listo) + mocks de todos
 *  los callbacks; los overrides pisan lo que cada test necesite. Devuelve las props para poder
 *  aseverar sobre los mocks. */
function renderEditor(overrides: Partial<AnnotationEditorProps> = {}): AnnotationEditorProps {
  const props: AnnotationEditorProps = {
    node: makeNode(),
    editing: true,
    editTool: 'stone',
    turn: 'black',
    atRoot: false,
    booting: false,
    onToggleEdit: vi.fn(),
    onSelectTool: vi.fn(),
    onCommentInput: vi.fn(),
    onCommentBlur: vi.fn(),
    onDeleteBranch: vi.fn(),
    onPromote: vi.fn(),
    onPass: vi.fn(),
    ...overrides,
  }
  render(<AnnotationEditor {...props} />)
  return props
}

describe('AnnotationEditor', () => {
  it('el toggle dice "Editar" en modo lectura', () => {
    renderEditor({ editing: false })
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dejar de editar' })).not.toBeInTheDocument()
  })

  it('el toggle dice "Dejar de editar" en edición y dispara onToggleEdit', () => {
    const props = renderEditor({ editing: true })
    fireEvent.click(screen.getByRole('button', { name: 'Dejar de editar' }))
    expect(props.onToggleEdit).toHaveBeenCalledOnce()
  })

  it('marca la herramienta activa con la clase "active" y dispara onSelectTool al elegir otra', () => {
    const props = renderEditor({ editTool: 'triangle' })
    expect(screen.getByRole('button', { name: '△' })).toHaveClass('active')
    expect(screen.getByRole('button', { name: '● Piedra' })).not.toHaveClass('active')
    fireEvent.click(screen.getByRole('button', { name: '□' }))
    expect(props.onSelectTool).toHaveBeenCalledWith('square')
  })

  it('el textarea bindea node.comment y dispara onCommentInput al escribir', () => {
    const props = renderEditor({ node: makeNode('hola') })
    const textarea = screen.getByPlaceholderText('Comentario de esta jugada…') as HTMLTextAreaElement
    expect(textarea.value).toBe('hola')
    fireEvent.input(textarea, { target: { value: 'nuevo comentario' } })
    expect(props.onCommentInput).toHaveBeenCalledWith('nuevo comentario')
  })

  it('persiste (onCommentBlur) al perder el foco / cambiar el textarea', () => {
    const props = renderEditor()
    fireEvent.change(screen.getByPlaceholderText('Comentario de esta jugada…'), {
      target: { value: 'x' },
    })
    expect(props.onCommentBlur).toHaveBeenCalledOnce()
  })

  it('"Borrar rama" y "Promover a principal" están deshabilitados en la raíz', () => {
    renderEditor({ atRoot: true })
    expect(screen.getByRole('button', { name: 'Borrar rama' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Promover a principal' })).toBeDisabled()
  })

  it('fuera de la raíz "Borrar rama"/"Promover a principal" están habilitados y disparan su callback', () => {
    const props = renderEditor({ atRoot: false })
    const del = screen.getByRole('button', { name: 'Borrar rama' })
    const promote = screen.getByRole('button', { name: 'Promover a principal' })
    expect(del).toBeEnabled()
    expect(promote).toBeEnabled()
    fireEvent.click(del)
    fireEvent.click(promote)
    expect(props.onDeleteBranch).toHaveBeenCalledOnce()
    expect(props.onPromote).toHaveBeenCalledOnce()
  })

  it('"Pasar" dispara onPass', () => {
    const props = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Pasar' }))
    expect(props.onPass).toHaveBeenCalledOnce()
  })

  it('muestra de quién es el turno en modo edición', () => {
    renderEditor({ turn: 'white', editing: true })
    expect(screen.getByText(/le toca a Blanco/)).toBeInTheDocument()
  })

  it('en modo lectura muestra el comentario del nodo y oculta la paleta/textarea', () => {
    renderEditor({ editing: false, node: makeNode('un comentario de repaso') })
    expect(screen.getByText('un comentario de repaso')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Comentario de esta jugada…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pasar' })).not.toBeInTheDocument()
  })
})
