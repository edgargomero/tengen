import { describe, expect, it } from 'vitest'
import Board from '@sabaki/go-board'
import { setBoardSize, playMove, undoMove, PASS_MOVE, EMPTY, BLACK, WHITE } from '../src/vendor/web-katrain/fastBoard'
import { mulberry32 } from '../src/testutil/rng'

const N = 19

describe('fastBoard vs @sabaki/go-board', () => {
  // NOTA sobre semánticas: fastBoard.playMove() LANZA en jugada ilegal (punto ocupado, ko
  // simple —la misma regla que usa KataGo—, o suicidio) y NO avanza el estado ni el turno. En
  // cambio, @sabaki/go-board.makeMove() con las opciones por defecto (sin preventOverwrite/
  // preventSuicide/preventKo) NO valida esas mismas condiciones: acepta overwrite, suicidio y
  // recaptura de ko sin lanzar. Para comparar ambos motores de forma coherente, solo invocamos
  // sabaki.makeMove() para jugadas que fastBoard YA aceptó como legales (try/catch alrededor de
  // playMove salta las ilegales sin tocar ningún tablero). Con eso, ambos motores procesan
  // exactamente el mismo subconjunto de jugadas mutuamente legales bajo ko simple, y sus tableros
  // deben permanecer sincronizados en todo momento. Como defensa adicional (por si
  // sabaki.makeMove lanzara con las opciones por defecto, cosa que su implementación actual no
  // hace), si lanza deshacemos la jugada también en fastBoard con undoMove y la saltamos.
  it('coinciden en el estado de piedras tras 200 jugadas aleatorias legales', () => {
    setBoardSize(N)
    const pos = { stones: new Uint8Array(N * N), koPoint: -1 }
    const captureStack: number[] = []
    let sabaki = Board.fromDimensions(N, N)
    const rng = mulberry32(0xc0ffee)
    let player = BLACK
    for (let i = 0; i < 200; i++) {
      const move = Math.floor(rng() * N * N)
      let snapshot
      try {
        snapshot = playMove(pos, move, player, captureStack)
      } catch {
        continue // ilegal en fastBoard: no avanzamos ni cambiamos jugador
      }
      const x = move % N
      const y = (move / N) | 0
      const sign = player === BLACK ? 1 : -1
      try {
        sabaki = sabaki.makeMove(sign, [x, y])
      } catch {
        undoMove(pos, move, player, snapshot, captureStack)
        continue
      }
      player = player === BLACK ? WHITE : BLACK
    }
    // Comparar mapas de signos
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const c = pos.stones[y * N + x]!
        const sign = c === BLACK ? 1 : c === WHITE ? -1 : 0
        expect(sabaki.get([x, y])).toBe(sign)
      }
  })

  it('PASS_MOVE no coloca piedra y limpia ko', () => {
    setBoardSize(N)
    const pos = { stones: new Uint8Array(N * N), koPoint: 5 }
    playMove(pos, PASS_MOVE, BLACK, [])
    expect(pos.koPoint).toBe(-1)
    expect(pos.stones.every((v) => v === EMPTY)).toBe(true)
  })
})
