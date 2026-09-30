// @vitest-environment jsdom
//
// Pantalla `/online/nueva`: crear una sala sin pasar por el gate de WebGPU ni por el router.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import { OnlineNewGame } from '../src/ui/OnlineNewGame'

afterEach(cleanup)

describe('OnlineNewGame', () => {
  it('va dentro de OnlineFrame con la ubicación "Nueva partida online" y sin el grupo Oponente', () => {
    render(<OnlineNewGame createRoom={vi.fn()} navigate={vi.fn()} />)
    expect(document.querySelector('header.topbar .topbar-location')).toHaveTextContent('Nueva partida online')
    expect(document.querySelector('a.topbar-home')).toHaveAttribute('href', '/')
    expect(screen.queryByText('Oponente')).toBeNull()
  })

  it('enviar crea la sala y navega a /online/<id> codificado', async () => {
    const createRoom = vi.fn().mockResolvedValue({ roomId: 'a b' })
    const navigate = vi.fn()
    render(<OnlineNewGame createRoom={createRoom} navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Empezar partida' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/online/a%20b'))
    expect(createRoom.mock.calls[0]![0]).toMatchObject({ boardSize: 9, rules: 'chinese' })
  })

  it('Cancelar vuelve a /', () => {
    const navigate = vi.fn()
    render(<OnlineNewGame createRoom={vi.fn()} navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('si createRoom falla muestra el aviso del formulario y no navega', async () => {
    const navigate = vi.fn()
    render(<OnlineNewGame createRoom={vi.fn().mockRejectedValue(new Error('x'))} navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Empezar partida' }))
    expect(await screen.findByText(/No se pudo crear la partida online/)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })
})
