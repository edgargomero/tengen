// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import type { RoomConfig, RoomEvent } from '@tengen/go-rules'
import { OnlineGameView } from '../src/ui/OnlineGameView'

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}
class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {}
  send() {}
  close() {}
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

const config: RoomConfig = { boardSize: 9, komi: 6.5, handicap: 0, creatorColor: 'black' }
const created: RoomEvent = { seq: 0, at: 0, type: 'created', config, playerId: 'p1' }

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window.navigator, 'share')
})

function setup(fetchStatus = 200) {
  const sockets: FakeSocket[] = []
  const fetchFn = (async () => ({ status: fetchStatus, ok: fetchStatus < 400, json: async () => ({}) })) as never
  render(
    <OnlineGameView
      roomId="r1"
      storage={new MemStorage()}
      fetchFn={fetchFn}
      socketFactory={(url) => { const s = new FakeSocket(url); sockets.push(s); return s as unknown as WebSocket }}
    />,
  )
  return sockets
}

describe('OnlineGameView', () => {
  it('conectando muestra el estado inicial', () => {
    setup()
    expect(screen.getByText('Conectando…')).toBeInTheDocument()
  })

  it('not-found: aviso y botón Nueva partida hacia /jugar', async () => {
    setup(404)
    expect(await screen.findByText('Esta partida no existe o ya expiró')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nueva partida' })).toHaveAttribute('href', '/jugar')
  })

  it('creador esperando: muestra el link y Copiar (sin Compartir si no hay navigator.share)', async () => {
    const sockets = setup()
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', seatToken: 't', events: [created] })
    expect(await screen.findByText('Esperando rival')).toBeInTheDocument()
    expect(screen.getByText(`${window.location.origin}/online/r1`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compartir' })).toBeNull()
  })

  it('Copiar escribe el link en el portapapeles; Compartir usa navigator.share si existe', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'share', { value: share, configurable: true })
    const sockets = setup()
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', events: [created] })
    fireEvent.click(await screen.findByRole('button', { name: 'Copiar' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/online/r1`)
    fireEvent.click(screen.getByRole('button', { name: 'Compartir' }))
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: `${window.location.origin}/online/r1` }))
  })
})
