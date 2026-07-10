import { describe, expect, it } from 'vitest'
import Board from '@sabaki/go-board'
import type { StoneColor } from '../src/vendor/web-katrain/fastBoard'
import { setBoardSize, playMove, undoMove, PASS_MOVE, EMPTY, BLACK, WHITE } from '../src/vendor/web-katrain/fastBoard'
import { mulberry32 } from '../src/testutil/rng'

const N = 19

// Tablero reducido para las jugadas aleatorias: en 19×19, 200 jugadas de una sola piedra
// uniformemente al azar son demasiado dispersas para producir capturas u ko con fiabilidad
// (medido: seed 0xc0ffee y otras 30 semillas dan 0 capturas y 0 ko en 19×19). En 9×9 la misma
// caminata SÍ captura de forma consistente (ver aserción `totalCaptured` más abajo), así que el
// diferencial contra el oráculo deja de ser tautológico para las ramas de captura/ko.
const FUZZ_N = 9

/** Compara, celda a celda, el mapa de signos de fastBoard contra el tablero de @sabaki/go-board. */
function expectSignMapsMatch(stones: Uint8Array, sabaki: Board, n: number): void {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const c = stones[y * n + x]!
      const sign = c === BLACK ? 1 : c === WHITE ? -1 : 0
      expect(sabaki.get([x, y])).toBe(sign)
    }
}

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
  //
  // OJO — landmine verificado leyendo playMove(): de las tres jugadas ilegales que lanza
  // (ocupado, ko simple, suicidio), las dos primeras lanzan ANTES de tocar `pos.stones`
  // (líneas ~236-238), pero la de SUICIDIO lanza DESPUÉS de colocar la piedra y aplicar las
  // capturas de grupos rivales (líneas ~241-274) — y como el throw interrumpe la función antes
  // del `return`, el caller nunca recibe el `UndoSnapshot` para deshacerlo con `undoMove`. Un
  // `catch { continue }` ingenuo (como tenía este test antes de esta revisión) deja el tablero
  // de fastBoard corrompido en ese caso concreto — se detectó exactamente así: en 9×9 con 200
  // jugadas aparecía una piedra fantasma que sabaki nunca vio. La corrección tiene que ser
  // quirúrgica: SOLO para "Illegal suicide move" hay que deshacer manualmente con los valores
  // de `koPointBefore`/`captureStart` guardados antes del intento; para "ocupado" o "ko simple"
  // NO hay que tocar nada, porque no hubo mutación — de hecho, llamar undoMove() en esos dos
  // casos sería un bug nuevo: pondría `pos.stones[move] = EMPTY`, borrando una piedra legítima
  // que ya estaba ahí (caso "ocupado"). Esto se verificó empíricamente: una primera versión de
  // este fix que deshacía en todos los casos de throw producía una divergencia distinta.
  it('coinciden en el estado de piedras tras 200 jugadas aleatorias legales en 9×9, ejercitando capturas', () => {
    setBoardSize(FUZZ_N)
    const pos = { stones: new Uint8Array(FUZZ_N * FUZZ_N), koPoint: -1 }
    const captureStack: number[] = []
    let sabaki = Board.fromDimensions(FUZZ_N, FUZZ_N)
    const rng = mulberry32(0xc0ffee)
    let player = BLACK
    let totalCaptured = 0
    for (let i = 0; i < 200; i++) {
      const move = Math.floor(rng() * FUZZ_N * FUZZ_N)
      const koPointBefore = pos.koPoint
      const captureLenBefore = captureStack.length
      let snapshot
      try {
        snapshot = playMove(pos, move, player, captureStack)
      } catch (err) {
        if (err instanceof Error && err.message === 'Illegal suicide move') {
          undoMove(pos, move, player, { koPointBefore, captureStart: captureLenBefore }, captureStack)
        }
        continue
      }
      const x = move % FUZZ_N
      const y = (move / FUZZ_N) | 0
      const sign = player === BLACK ? 1 : -1
      try {
        sabaki = sabaki.makeMove(sign, [x, y])
      } catch {
        undoMove(pos, move, player, snapshot, captureStack)
        continue
      }
      totalCaptured += captureStack.length - captureLenBefore
      player = player === BLACK ? WHITE : BLACK
    }
    // Guardia contra degeneración silenciosa: si un futuro refactor hace que la caminata deje de
    // capturar piedras, este test debe fallar en vez de pasar comparando dos tableros vacíos.
    expect(totalCaptured).toBeGreaterThan(0)
    // Comparar mapas de signos (no se debilita: se compara el tablero completo igual que antes).
    expectSignMapsMatch(pos.stones, sabaki, FUZZ_N)
  })

  it('PASS_MOVE no coloca piedra y limpia ko', () => {
    setBoardSize(N)
    const pos = { stones: new Uint8Array(N * N), koPoint: 5 }
    playMove(pos, PASS_MOVE, BLACK, [])
    expect(pos.koPoint).toBe(-1)
    expect(pos.stones.every((v) => v === EMPTY)).toBe(true)
  })

  it('captura una piedra blanca al quitarle la última libertad', () => {
    // Forma construida a mano (verificar en papel antes de tocar índices):
    //   . . . . B . . . .   y=3
    //   . . . . W . . . .   y=4  (única libertad restante: (4,5), abajo)
    //   . . . B W B . . .   y=4 fila real: B en (3,4) y (5,4), W en (4,4)
    //   . . . . B . . . .   y=5  (jugada que captura)
    // (coordenadas x,y con x columna, y fila; ver `idx` más abajo)
    setBoardSize(FUZZ_N)
    const idx = (x: number, y: number): number => y * FUZZ_N + x
    const pos = { stones: new Uint8Array(FUZZ_N * FUZZ_N), koPoint: -1 }
    const captureStack: number[] = []
    let sabaki = Board.fromDimensions(FUZZ_N, FUZZ_N)

    const moves: Array<[number, number, StoneColor]> = [
      [4, 4, WHITE], // piedra blanca que quedará rodeada
      [3, 4, BLACK],
      [5, 4, BLACK],
      [4, 3, BLACK], // quedan 3 de 4 libertades ocupadas por negro; solo queda (4,5)
    ]
    for (const [x, y, color] of moves) {
      playMove(pos, idx(x, y), color, captureStack)
      sabaki = sabaki.makeMove(color === BLACK ? 1 : -1, [x, y])
    }
    expect(pos.stones[idx(4, 4)]).toBe(WHITE) // todavía viva: le queda 1 libertad

    const captureLenBefore = captureStack.length
    playMove(pos, idx(4, 5), BLACK, captureStack) // jugada que quita la última libertad
    sabaki = sabaki.makeMove(1, [4, 5])

    // La piedra blanca fue capturada: fastBoard la marca EMPTY y la registra en captureStack.
    expect(pos.stones[idx(4, 4)]).toBe(EMPTY)
    const captured = captureStack.slice(captureLenBefore)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toBe(idx(4, 4))
    // El tablero completo coincide con el oráculo tras la captura.
    expectSignMapsMatch(pos.stones, sabaki, FUZZ_N)
  })

  it('crea un ko simple tras la captura y prohíbe la recaptura inmediata (KO_SIMPLE)', () => {
    // Forma de ko clásica (verificada en papel y con un script de sondeo antes de escribir el
    // test — ver reporte de la task):
    //   x:      0 1 2 3
    //   y=0:    . B W .
    //   y=1:    B W . W
    //   y=2:    . B W .
    // La piedra blanca en (1,1) tiene una sola libertad: (2,1). Negro juega ahí, captura esa
    // única piedra y su propia piedra recién puesta en (2,1) queda con una sola libertad —
    // exactamente (1,1), el punto vaciado — que es la condición de ko simple en fastBoard
    // (captura de una sola piedra + grupo propio de una piedra con una sola libertad).
    setBoardSize(FUZZ_N)
    const idx = (x: number, y: number): number => y * FUZZ_N + x
    const pos = { stones: new Uint8Array(FUZZ_N * FUZZ_N), koPoint: -1 }
    const captureStack: number[] = []
    let sabaki = Board.fromDimensions(FUZZ_N, FUZZ_N)

    // NOTA: estas jugadas NO alternan estrictamente B/W como una partida real — playMove() no
    // exige alternancia (recibe el jugador explícito en cada llamada) — se eligen en el orden y
    // color que arman la forma de ko de manera directa.
    const setup: Array<[number, number, StoneColor]> = [
      [1, 0, BLACK],
      [2, 0, WHITE],
      [0, 1, BLACK],
      [1, 1, WHITE], // piedra que quedará capturada
      [1, 2, BLACK],
      [3, 1, WHITE], // relleno para que el grupo negro de (2,1) quede con 1 sola libertad tras capturar
      [2, 2, WHITE], // ídem
    ]
    for (const [x, y, color] of setup) {
      playMove(pos, idx(x, y), color, captureStack)
      sabaki = sabaki.makeMove(color === BLACK ? 1 : -1, [x, y])
    }
    expect(pos.koPoint).toBe(-1) // todavía no hay ko

    const captureLenBefore = captureStack.length
    playMove(pos, idx(2, 1), BLACK, captureStack) // captura que crea el ko
    sabaki = sabaki.makeMove(1, [2, 1])

    const captured = captureStack.slice(captureLenBefore)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toBe(idx(1, 1))
    expect(pos.stones[idx(1, 1)]).toBe(EMPTY)
    expect(pos.koPoint).toBe(idx(1, 1)) // fastBoard marcó el punto de ko esperado
    // El tablero coincide con el oráculo justo antes de la (ilegal) recaptura.
    expectSignMapsMatch(pos.stones, sabaki, FUZZ_N)

    // KO_SIMPLE: la recaptura inmediata en el punto de ko está prohibida en fastBoard (misma
    // regla que usa KataGo). @sabaki/go-board con sus opciones por defecto (sin `preventKo`) NO
    // implementa esta prohibición y aceptaría la recaptura sin lanzar — por eso esta aserción es
    // específica de fastBoard y deliberadamente NO se compara contra sabaki.
    expect(() => playMove(pos, idx(1, 1), WHITE, captureStack)).toThrow(/simple ko/i)
    // Contraste explícito: confirmamos que sabaki, con las opciones por defecto, sí permite esa
    // misma jugada (documenta la diferencia de semántica en vez de solo afirmarla en un comentario).
    expect(() => sabaki.makeMove(-1, [1, 1])).not.toThrow()
  })
})
