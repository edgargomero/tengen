// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import '@testing-library/jest-dom/vitest'
import type { RoomConfig, RoomEvent } from '@tengen/go-rules'
import { initialClockState } from '@tengen/engine/clock'
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
  sent: string[] = []
  constructor(public url: string) {}
  send(d: string) { this.sent.push(d) }
  close() {}
  emit(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}
// jsdom no trae ResizeObserver y `useBoundedBoardSize` lo instancia al montar; el tablero se dimensiona
// con `boardBounds` inyectado, así que la medición real nunca se usa.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const config: RoomConfig = { boardSize: 9, komi: 6.5, handicap: 0, creatorColor: 'black' }
const created: RoomEvent = { seq: 0, at: 0, type: 'created', config, playerId: 'p1' }

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
      boardBounds={{ maxWidth: 400, maxHeight: 400 }}
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

  it('I-1: sala llena (cierre 1013): aviso y botón hacia /jugar, sin reconectar', async () => {
    const sockets = setup()
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0]!.onclose?.({ code: 1013 } as never)
    expect(await screen.findByText('La sala está llena')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nueva partida' })).toHaveAttribute('href', '/jugar')
    expect(sockets).toHaveLength(1)
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

// ─── Partida en juego (Task 6) ───
const NOW = 1_700_000_000_000
const clockCfg = { mainTimeMs: 60_000, byoyomiPeriods: 3, byoyomiPeriodMs: 30_000 }
const joined: RoomEvent = { seq: 1, at: NOW, type: 'joined', seat: 'guest', playerId: 'p2' }
const started: RoomEvent = { seq: 2, at: NOW, type: 'started', creatorColor: 'black' }
const base: RoomEvent[] = [created, joined, started]

function movesEvents(list: Array<[number, number] | 'pass'>, from = 3): RoomEvent[] {
  return list.map((m, i) => {
    const color = i % 2 === 0 ? 'black' : 'white'
    return m === 'pass'
      ? { seq: from + i, at: NOW, type: 'pass', color }
      : { seq: from + i, at: NOW, type: 'move', color, x: m[0], y: m[1] }
  }) as RoomEvent[]
}

async function play(seat: 'creator' | 'guest' | 'spectator', events: RoomEvent[]) {
  const sockets = setup()
  await waitFor(() => expect(sockets.length).toBe(1))
  const s = sockets[0]!
  s.emit({ t: 'welcome', seat, events })
  return s
}
const vertex = (x: number, y: number) => document.querySelector(`.shudan-vertex[data-x="${x}"][data-y="${y}"]`)!
const intents = (s: FakeSocket) => s.sent.map((m) => JSON.parse(m))

describe('OnlineGameView en juego', () => {
  it('started: tablero con template de estudio, etiquetas, capturas y turno', async () => {
    await play('creator', base)
    expect(await screen.findByText('Negro (vos)')).toBeInTheDocument()
    expect(screen.getByText('Blanco (rival)')).toBeInTheDocument()
    expect(document.querySelector('.study-shell .study-board .shudan-goban')).not.toBeNull()
    expect(document.querySelector('.study-rail')).not.toBeNull()
    expect(screen.getByText('Tu turno')).toBeInTheDocument()
    expect(screen.getByText('Capturas')).toBeInTheDocument()
  })

  it('el invitado con color blanco se ve como Blanco (vos) y espera el turno', async () => {
    await play('guest', base)
    expect(await screen.findByText('Blanco (vos)')).toBeInTheDocument()
    expect(screen.getByText('Negro (rival)')).toBeInTheDocument()
    expect(screen.getByText('Turno del rival')).toBeInTheDocument()
  })

  it('clic en tu turno envía intent con el seq correcto; la piedra aparece recién con el evento', async () => {
    const s = await play('creator', base)
    await screen.findByText('Negro (vos)')
    fireEvent.click(vertex(4, 4))
    expect(intents(s)).toEqual([{ t: 'intent', intent: { type: 'move', x: 4, y: 4, seq: 3 } }])
    expect(vertex(4, 4).className).not.toContain('shudan-sign_1')
    s.emit({ t: 'events', events: movesEvents([[4, 4]]) })
    await waitFor(() => expect(vertex(4, 4).className).toContain('shudan-sign_1'))
  })

  it('punto ocupado / suicidio: no sale nada y el rail explica el motivo', async () => {
    const s = await play('creator', [...base, ...movesEvents([[4, 4], [1, 0], [4, 5], [0, 1]])])
    await screen.findByText('Negro (vos)')
    fireEvent.click(vertex(4, 4))
    expect(await screen.findByText('Ese punto está ocupado')).toBeInTheDocument()
    fireEvent.click(vertex(0, 0))
    expect(await screen.findByText('Esa jugada sería suicidio')).toBeInTheDocument()
    expect(s.sent).toEqual([])
  })

  it('ko: aviso en español', async () => {
    const ko: Array<[number, number]> = [[4, 1], [2, 0], [3, 0], [1, 1], [3, 2], [2, 2], [2, 1], [3, 1]]
    const s = await play('creator', [...base, ...movesEvents(ko)])
    await screen.findByText('Negro (vos)')
    fireEvent.click(vertex(2, 1))
    expect(await screen.findByText('Ko: no podés retomar enseguida')).toBeInTheDocument()
    expect(s.sent).toEqual([])
  })

  it('rejected del servidor: aviso breve y el tablero no cambia', async () => {
    const s = await play('creator', base)
    await screen.findByText('Negro (vos)')
    s.emit({ t: 'rejected', reason: 'stale' })
    expect(await screen.findByText(/La partida cambió/)).toBeInTheDocument()
    expect(document.querySelector('.shudan-sign_1')).toBeNull()
  })

  it('M-1: el mismo motivo de rechazo dos veces seguidas se vuelve a mostrar', async () => {
    const s = await play('creator', base)
    await screen.findByText('Negro (vos)')
    fireEvent.click(vertex(4, 4))
    s.emit({ t: 'rejected', reason: 'illegal' })
    const msg = await screen.findByRole('status')
    expect(msg).toBeInTheDocument()
    const text = msg.textContent
    // el usuario vuelve a tocar (el aviso se limpia) y el servidor rechaza de nuevo por lo mismo
    fireEvent.click(vertex(5, 5))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    s.emit({ t: 'rejected', reason: 'illegal' })
    expect((await screen.findByRole('status')).textContent).toBe(text)
  })

  it('M-1: doble toque rápido: sale una sola intención y el stale tardío no muestra aviso', async () => {
    const s = await play('creator', base)
    await screen.findByText('Negro (vos)')
    fireEvent.click(vertex(4, 4))
    fireEvent.click(vertex(4, 4))
    expect(s.sent).toHaveLength(1)
    s.emit({ t: 'events', events: movesEvents([[4, 4]]) })
    s.emit({ t: 'rejected', reason: 'stale' })
    await waitFor(() => expect(vertex(4, 4).className).toContain('shudan-sign_1'))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('Pasar envía pass; Rendirse pide confirmación inline y luego envía resign', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const s = await play('creator', base)
    await screen.findByText('Negro (vos)')
    fireEvent.click(screen.getByRole('button', { name: 'Pasar' }))
    expect(intents(s)).toEqual([{ t: 'intent', intent: { type: 'pass', seq: 3 } }])
    s.emit({ t: 'events', events: movesEvents(['pass']) }) // el servidor confirma el pase
    await screen.findByText('Turno del rival')
    fireEvent.click(screen.getByRole('button', { name: 'Rendirse' }))
    expect(intents(s)).toHaveLength(1)
    expect(screen.getByText('¿Seguro que querés rendirte?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByText('¿Seguro que querés rendirte?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rendirse' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, rendirme' }))
    expect(intents(s)[1]).toEqual({ t: 'intent', intent: { type: 'resign', seq: 4 } })
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('espectador: sin controles y aviso de que está mirando', async () => {
    const s = await play('spectator', base)
    expect(await screen.findByText('Esta partida ya tiene dos jugadores: estás mirando')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pasar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rendirse' })).toBeNull()
    fireEvent.click(vertex(4, 4))
    expect(s.sent).toEqual([])
    expect(screen.getByText('Negro')).toBeInTheDocument()
  })

  it('rival ausente: Rival desconectado; socket propio caído: Reconectando… y controles apagados', async () => {
    const s = await play('creator', base)
    await screen.findByText('Negro (vos)')
    s.emit({ t: 'presence', creator: true, guest: false })
    expect(await screen.findByText('Rival desconectado')).toBeInTheDocument()
    s.emit({ t: 'presence', creator: true, guest: true })
    await waitFor(() => expect(screen.queryByText('Rival desconectado')).toBeNull())
    s.onclose?.()
    expect(await screen.findByText('Reconectando…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pasar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Rendirse' })).toBeDisabled()
    fireEvent.click(vertex(4, 4))
    expect(s.sent).toEqual([])
  })

  it('fin: resultado en español, Descargar SGF con RE y jugadas, y Nueva partida online', async () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const ended: RoomEvent = { seq: 5, at: NOW, type: 'ended', result: 'B+2.0' }
    await play('creator', [...base, ...movesEvents([[4, 4], [2, 2]]), ended])
    expect(await screen.findByText('Negro gana por 2,0 puntos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nueva partida online' })).toHaveAttribute('href', '/jugar')
    expect(screen.queryByRole('button', { name: 'Pasar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar SGF' }))
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
    const text = await new Promise<string>((res) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.readAsText(blob)
    })
    expect(text).toContain('RE[B+2.0]')
    expect(text).toContain(';B[ee]')
    expect(text).toContain(';W[cc]')
  })

  it.each([
    ['W+R', 'Blanco gana por rendición'],
    ['B+T', 'Negro gana por tiempo'],
    ['Draw', 'Empate'],
  ])('resultado %s → %s', async (result, text) => {
    await play('creator', [...base, { seq: 3, at: NOW, type: 'ended', result }])
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('perder por tiempo: el reloj del que cayó queda en 00:00 sin byoyomi', async () => {
    const cfgRoom: RoomEvent = { ...created, config: { ...config, clock: clockCfg } }
    const low = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 1, inByoyomi: true }
    await play('creator', [
      cfgRoom, joined, started,
      { seq: 3, at: NOW, type: 'move', color: 'black', x: 4, y: 4, clock: low },
      { seq: 4, at: NOW, type: 'timeout', color: 'white' },
      { seq: 5, at: NOW, type: 'ended', result: 'B+T' },
    ])
    expect(await screen.findByText('Negro gana por tiempo')).toBeInTheDocument()
    expect(screen.getByText('Blanco (rival)').parentElement).toHaveTextContent('00:00')
    expect(screen.getByText('Blanco (rival)').parentElement).not.toHaveTextContent('byoyomi')
    expect(screen.getByText('Negro (vos)').parentElement).toHaveTextContent('byoyomi 1')
  })

  it('las pantallas de tarjeta (espera) van centradas como el resto', async () => {
    await play('creator', [created])
    expect(await screen.findByText('Esperando rival')).toBeInTheDocument()
    expect(document.querySelector('main.card-screen.mode-menu')).not.toBeNull()
  })

  it('I-3: la cuenta regresiva corrige el desfase entre el reloj del cliente y el del servidor', async () => {
    // El reloj del cliente va 5 s atrás del servidor: sin corregir se vería 00:55 en vez de 00:50.
    vi.spyOn(Date, 'now').mockImplementation(() => NOW + 5_000)
    const cfgRoom: RoomEvent = { ...created, config: { ...config, clock: clockCfg } }
    const sockets = setup()
    await waitFor(() => expect(sockets.length).toBe(1))
    sockets[0]!.emit({ t: 'welcome', seat: 'creator', events: [cfgRoom, joined, started], serverNow: NOW + 10_000 })
    expect(await screen.findByText('00:50')).toBeInTheDocument()
  })

  it('cuenta regresiva local del reloj en turno, recalculada desde turnStartedAt en cada evento', async () => {
    let now = NOW + 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const cfgRoom: RoomEvent = { ...created, config: { ...config, clock: clockCfg } }
    const s = await play('creator', [cfgRoom, joined, started])
    // Negro en turno: 60 s - 10 s
    expect(await screen.findByText('00:50')).toBeInTheDocument()
    expect(screen.getByText('01:00')).toBeInTheDocument() // Blanco intacto
    now = NOW + 15_000
    await waitFor(() => expect(screen.getByText('00:45')).toBeInTheDocument())
    // Negro juega a los 20 s (quedan 40 s) y empieza el turno de Blanco
    now = NOW + 20_000
    const clock = { ...initialClockState(clockCfg), mainTimeRemainingMs: 40_000 }
    s.emit({ t: 'events', events: [{ seq: 3, at: NOW + 20_000, type: 'move', color: 'black', x: 4, y: 4, clock }] })
    await waitFor(() => expect(screen.getByText('00:40')).toBeInTheDocument())
    expect(screen.getByText('01:00')).toBeInTheDocument()
    now = NOW + 25_000
    await waitFor(() => expect(screen.getByText('00:55')).toBeInTheDocument())
  })
})
