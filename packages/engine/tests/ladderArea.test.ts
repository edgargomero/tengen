import { describe, expect, it } from 'vitest'
import type { StoneColor } from '../src/vendor/web-katrain/fastBoard'
import { setBoardSize, BLACK, WHITE, EMPTY, computeLadderFeaturesV7KataGo, computeAreaMapV7KataGo } from '../src/vendor/web-katrain/fastBoard'

// Construye un tablero de n×n, llamando setBoardSize(n) primero (fastBoard usa estado global de
// módulo dimensionado por tamaño de tablero: buffers de escaleras, vecinos, etc.). Usamos dos
// tamaños distintos en este archivo (19 para escaleras, 5 para los grupos pass-alive de Benson,
// donde nos conviene que el tablero completo actúe como "pared") — setBoardSize es un no-op si el
// tamaño no cambia, así que alternar entre ellos en tests sucesivos del mismo archivo reinicializa
// correctamente cada vez (ver `initBoardArrays` en fastBoard.ts).
function idx(n: number, x: number, y: number): number {
  return y * n + x
}

function board(n: number, place: (put: (x: number, y: number, c: StoneColor) => void) => void): Uint8Array {
  setBoardSize(n)
  const s = new Uint8Array(n * n)
  place((x, y, c) => {
    s[idx(n, x, y)] = c
  })
  return s
}

// NOTA sobre `currentPlayer` (verificado leyendo `computeLadderFeaturesV7KataGoInto`, línea ~1329):
// el parámetro NO determina si un grupo cuenta como "laddered" (plano 14, `ladderedStones`) — esa
// función recorre TODOS los grupos del tablero (de ambos colores) con 1 o 2 libertades y para cada
// uno corre el solver de escaleras real de KataGo (`searchIsLadderCaptured`), sin mirar de quién es
// el turno. `currentPlayer` solo decide qué grupos alimentan `ladderWorkingMoves` (plano 17): ese
// plano solo se llena para grupos de 2 libertades cuyo color es `opponentOf(currentPlayer)` (el
// bando que currentPlayer podría estar persiguiendo). Esto se confirma con un test más abajo. La
// consecuencia práctica: los tests de `ladderedStones` de este archivo no dependen de qué color se
// pase como `currentPlayer` (se prueba explícitamente en el primer test).
describe('escaleras (computeLadderFeaturesV7KataGo) — plano 14 ladderedStones', () => {
  it('captura real: una piedra en atari (1 libertad) empujada por el borde termina sin escape en la esquina', () => {
    // Blanca en (3,0), sobre el borde y=0. Negras en (4,0) y (3,1) le dejan una sola libertad:
    // (2,0). Grupo de 1 libertad → rama searchIsLadderCaptured(defenderFirst=true) directa.
    //
    // Trazado a mano de la línea ganadora del atacante (Negro), turno por turno — cada "libs="
    // es el recuento de libertades del grupo blanco justo después de la jugada:
    //   Blanca(3,0), libs=1 {(2,0)}                              [ya en atari, sin jugar aún]
    //   Blanca forzada a extender a (2,0) [única libertad]        libs=2 {(1,0),(2,1)}
    //   Negro juega (2,1) [tapa la salida hacia el tablero abierto] libs=1 {(1,0)}
    //   Blanca forzada a extender a (1,0) [única libertad]        libs=2 {(0,0),(1,1)}
    //   Negro juega (1,1) [tapa la salida otra vez]                libs=1 {(0,0)}
    //   Blanca forzada a extender a (0,0), la esquina real:
    //     (0,0) solo tiene 2 vecinos en el tablero — (1,0) [propio] y (0,1) [vacío] —
    //     así que el grupo llega a libs=1 {(0,1)}
    //   Turno de Negro con libs=1: por construcción del solver (línea ~1109, atacante con
    //     libs<=1 en su turno gana de inmediato: puede jugar esa última libertad la próxima
    //     jugada) → capturada.
    // Ninguna extensión gana una 3ª libertad porque cada punto de extensión está sobre el borde
    // y=0 (solo 3 vecinos, uno de ellos ya propio) Y Negro siempre tapa la salida hacia y=1 antes
    // de que Blanca pueda jugar ahí — así es como una escalera real "se queda sin tablero".
    const N = 19
    const stones = board(N, (p) => {
      p(3, 0, WHITE)
      p(4, 0, BLACK)
      p(3, 1, BLACK)
    })
    const { ladderedStones } = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: BLACK })
    expect(ladderedStones[idx(N, 3, 0)]).toBe(1)
  })

  it('NO marca una piedra con 3+ libertades (no está siquiera en rango de atari/escalera)', () => {
    const N = 19
    const stones = board(N, (p) => {
      p(9, 9, WHITE) // en el centro del tablero, sola: 4 libertades
    })
    const { ladderedStones } = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: BLACK })
    expect(ladderedStones[idx(N, 9, 9)]).toBe(0)
  })

  it('un rompe-escaleras (piedra blanca amiga en el camino de escape) cambia el resultado real de la MISMA forma', () => {
    // Misma forma que el primer test (Blanca(3,0) en atari, Negras en (4,0) y (3,1)), pero ahora
    // hay una piedra blanca suelta en (1,0) — un punto por el que la escalera anterior SÍ pasaba
    // (ver el trazado de arriba: "Blanca forzada a extender a (1,0)"). Esto es exactamente lo que
    // distingue un solver real de una heurística ingenua de "≤2 libertades": la piedra en (3,0)
    // sigue teniendo 1 sola libertad al empezar (idéntica al test anterior — (1,0) no es vecina de
    // (3,0), así que no se fusiona todavía), pero el resultado final es opuesto.
    //
    // Trazado a mano:
    //   Blanca(3,0), libs=1 {(2,0)}
    //   Blanca forzada a extender a (2,0) [única libertad]. (2,0) SÍ es vecina de la piedra blanca
    //     suelta en (1,0) → se fusionan en un solo grupo: {(3,0),(2,0),(1,0)}.
    //   Libertades del grupo fusionado: (3,0) no aporta nada nuevo (Negro/propio en sus 3 vecinos);
    //     (2,0) aporta (2,1); (1,0) aporta (0,0) y (1,1) — total {(2,1),(0,0),(1,1)} = 3 libertades.
    //   Turno de Negro (atacante) con libs=3: por construcción del solver (línea ~1115, atacante
    //     con libs>=3 en su turno pierde de inmediato) → escapa, NO capturada.
    // Negro solo puede tapar UNA de las tres salidas en su siguiente jugada; las otras dos quedan
    // libres — la piedra rota de verdad la escalera, no es un ajuste artificial del test.
    const N = 19
    const stones = board(N, (p) => {
      p(3, 0, WHITE)
      p(4, 0, BLACK)
      p(3, 1, BLACK)
      p(1, 0, WHITE) // rompe-escaleras
    })
    const { ladderedStones } = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: BLACK })
    expect(ladderedStones[idx(N, 3, 0)]).toBe(0)
  })

  it('escalera de esquina con 2 libertades: currentPlayer NO afecta ladderedStones, SÍ afecta ladderWorkingMoves (plano 17)', () => {
    // Blanca en (1,1) con Negras en (2,1) y (1,2): 2 libertades, {(0,1),(1,0)}, ambas apuntando
    // hacia la esquina real (0,0) — rama searchIsLadderCapturedAttackerFirst2Libs (el atacante
    // mueve primero, probando ambas libertades como primer ataque).
    //
    // Trazado a mano de la línea ganadora (Negro juega (0,1) primero):
    //   Blanca(1,1), libs=2 {(0,1),(1,0)}
    //   Negro juega (0,1) [primer ataque]                          libs=1 {(1,0)}
    //   Blanca forzada a extender a (1,0) [única libertad]         libs=2 {(0,0),(2,0)}
    //   Negro juega (2,0)                                          libs=1 {(0,0)}
    //   Blanca forzada a jugar (0,0): (0,0) solo tiene 2 vecinos —
    //     (1,0) [propio] y (0,1) [Negro, jugado arriba] — CERO libertades y no captura nada
    //     (ningún grupo negro vecino queda con 0 libertades) → es SUICIDIO, movida ilegal.
    //   Blanca no tiene jugada legal en su única "libertad" → capturada (searchIsLadderCaptured
    //     línea ~1251: si tryPlayMoveNoThrow falla para el defensor, returnValue = isDefender = true).
    const N = 19
    const stones = board(N, (p) => {
      p(1, 1, WHITE)
      p(2, 1, BLACK)
      p(1, 2, BLACK)
    })

    const black = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: BLACK })
    expect(black.ladderedStones[idx(N, 1, 1)]).toBe(1)
    // currentPlayer=BLACK => opponentOf(BLACK)=WHITE, y el grupo perseguido (c=WHITE) coincide:
    // se registran las jugadas de ataque ganadoras. Verificado leyendo el código (línea ~1376):
    // `if (g.liberties === 2 && c === opp && workingMoves.length > 0)`.
    expect(black.ladderWorkingMoves[idx(N, 0, 1)]).toBe(1)
    expect(black.ladderWorkingMoves[idx(N, 1, 0)]).toBe(1)

    const white = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: WHITE })
    // ladderedStones NO depende de currentPlayer: el mismo grupo blanco sigue laddered.
    expect(white.ladderedStones[idx(N, 1, 1)]).toBe(1)
    // Pero con currentPlayer=WHITE, opponentOf(WHITE)=BLACK, y el grupo perseguido es blanco
    // (c=WHITE !== BLACK) → no coincide la condición `c === opp` → no se registra ninguna jugada
    // de trabajo (el plano 17 codifica "grupos que ESTE jugador puede perseguir en escalera", no
    // "todas las escaleras del tablero").
    expect(white.ladderWorkingMoves[idx(N, 0, 1)]).toBe(0)
    expect(white.ladderWorkingMoves[idx(N, 1, 0)]).toBe(0)
  })

  it('una piedra de 2 libertades en tablero abierto (sin pared ni rompe-escaleras cerca) escapa: NO es una escalera ingenua de "≤2 libertades"', () => {
    // Blanca en (1,1) con Negras en (0,1) y (1,0): 2 libertades, {(2,1),(1,2)}, apuntando hacia el
    // tablero abierto (alejándose de la esquina, al revés que el test anterior). Una heurística
    // ingenua que solo mirara "¿tiene ≤2 libertades?" marcaría esta piedra igual que la de arriba;
    // el solver real no, porque de verdad puede escapar.
    //
    // Trazado a mano (cualquiera de las dos libertades como primer ataque es simétrico, uso (2,1)):
    //   Blanca(1,1), libs=2 {(2,1),(1,2)}
    //   Negro juega (2,1) [primer ataque]                          libs=1 {(1,2)}
    //   Blanca forzada a extender a (1,2) [única libertad, punto interior del tablero, NO borde]
    //   Libertades del grupo {(1,1),(1,2)}: (1,1) no aporta nada nuevo (Negro en 2 vecinos, propio
    //     en el tercero); (1,2) aporta sus 3 vecinos libres (0,2),(1,3),(2,2) → total 3 libertades.
    //   Turno de Negro (atacante) con libs=3 → escapa (misma regla que en el test del rompe-
    //     escaleras: atacante con libs>=3 en su turno pierde de inmediato).
    const N = 19
    const stones = board(N, (p) => {
      p(1, 1, WHITE)
      p(0, 1, BLACK)
      p(1, 0, BLACK)
    })
    const { ladderedStones } = computeLadderFeaturesV7KataGo({ stones, koPoint: -1, currentPlayer: BLACK })
    expect(ladderedStones[idx(N, 1, 1)]).toBe(0)
  })
})

// NOTA sobre lo que realmente calcula `computeAreaMapV7KataGo` (verificado leyendo
// `calculateAreaForPla`, línea ~418, con `safeBigTerritories` y `unsafeBigTerritories` ambos en
// `true` siempre — así los llama `computeAreaMapV7KataGoInto`): NO es un test de vida/muerte
// aislado (Benson puro). Combina dos reglas:
//   1) "safe" (Benson real): una región vacía se marca de un color si NINGÚN grupo que la
//      rodea fue "matado" por la poda de Benson (cadena viva solo si tiene ≥2 regiones vitales
//      distintas — el requisito clásico de "dos ojos"; ver el bucle `while(true)` que mata
//      cadenas con `VITAL_COUNT_BY_GROUP < 2`).
//   2) "unsafe" (territorio simple estilo Tromp-Taylor, como red de seguridad): si una región
//      vacía NUNCA toca al color rival (`CONTAINS_OPP === false`), se marca de todos modos para
//      el único color presente, AUNQUE su grupo haya sido matado por Benson (esto se verifica
//      abajo con el grupo de un solo ojo).
// La única forma de ver una región quedar en EMPTY es que SÍ limite con ambos colores
// (`CONTAINS_OPP` verdadero para las dos llamadas, BLACK y WHITE) — eso es lo que prueba el test
// del punto dame.
describe('Benson / área pass-alive (computeAreaMapV7KataGo)', () => {
  it('un grupo con dos ojos reales (certificado por Benson, no solo "rodeado") marca ambos ojos como territorio de Negro', () => {
    // Tablero 5×5 completamente relleno de Negro salvo dos puntos NO adyacentes: (1,1) y (3,3).
    // Usamos un tablero pequeño a propósito para que las 4 paredes sean el propio borde del
    // tablero — así el grupo negro no tiene NINGUNA libertad fuera de esos dos puntos (nada que
    // "filtre" hacia tablero abierto), evitando la ambigüedad de construir una pared a mano.
    //
    // Verificado leyendo calculateAreaForPla: cada uno de los dos puntos vacíos es una región de 1
    // solo punto cuyos 4 vecinos son todos del mismo grupo negro G (VITAL_LIST de cada región =
    // [G], longitud 1). Sumando las dos regiones, VITAL_COUNT_BY_GROUP[G] = 1 + 1 = 2 → G
    // SOBREVIVE la poda de Benson (el umbral es "≥2"). Como G no muere, ninguna de las dos
    // regiones queda con BORDERS_NONPASSALIVE, así que ambas se marcan Negro por la rama "safe"
    // (línea 607: NUM_INTERNAL_SPACES_MAX2<=1 && !BORDERS_NONPASSALIVE && atLeastOnePla) — esto sí
    // es la certificación de Benson en acción, no solo la red de seguridad "unsafe" (contrastar
    // con el test siguiente, de un solo ojo).
    const n = 5
    const stones = board(n, (p) => {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if ((x === 1 && y === 1) || (x === 3 && y === 3)) continue
          p(x, y, BLACK)
        }
      }
    })
    const area = computeAreaMapV7KataGo(stones, false)
    expect(area[idx(n, 1, 1)]).toBe(BLACK)
    expect(area[idx(n, 3, 3)]).toBe(BLACK)
  })

  it('un grupo con UN solo ojo NO sobrevive la poda de Benson, pero igual se marca por la red de seguridad "unsafe" al no haber rival en el tablero', () => {
    // Mismo truco de tablero 5×5 relleno de Negro, pero dejando un ÚNICO punto vacío: (1,1). Con
    // solo 1 región vital, VITAL_COUNT_BY_GROUP[G] = 1 < 2 → Benson MATA la cadena de verdad (esto
    // se verificó empíricamente antes de escribir este test: es el motivo real por el que este
    // test existe, no una suposición). Aun así, (1,1) termina marcado Negro, porque
    // `unsafeBigTerritories` no exige sobrevivir a Benson — solo exige que la región nunca toque
    // al rival (`!CONTAINS_OPP`), y aquí no hay ninguna piedra blanca en todo el tablero. Este test
    // documenta que `computeAreaMapV7KataGo` por sí solo NO permite distinguir "un ojo real" de
    // "territorio simple sin oposición" — para eso hace falta que el rival esté presente (ver el
    // test de dame, donde SÍ hay un rival y la región sí queda EMPTY).
    const n = 5
    const stones = board(n, (p) => {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          if (x === 1 && y === 1) continue
          p(x, y, BLACK)
        }
      }
    })
    const area = computeAreaMapV7KataGo(stones, false)
    expect(area[idx(n, 1, 1)]).toBe(BLACK)
  })

  it('deja un punto dame (libertad compartida entre piedras sueltas de ambos colores) como EMPTY', () => {
    // Negra en (9,9), Blanca en (9,11), con (9,10) vacío entre ambas — vecino directo de las dos.
    // Ninguna de las dos piedras forma grupo pass-alive (son piedras sueltas con varias
    // libertades), así que esto no depende para nada de la poda de Benson: la región que contiene
    // a (9,10) toca AMBOS colores directamente, así que `CONTAINS_OPP` es verdadero tanto para la
    // llamada de calculateAreaForPla con plaColor=BLACK (el rival Blanco toca la región) como para
    // la de plaColor=WHITE (el rival Negro toca la región) — ninguna de las dos ramas "safe" ni
    // "unsafe" se activa para ninguno de los dos colores, así que el punto se queda en su valor
    // inicial: EMPTY.
    const N = 19
    const stones = board(N, (p) => {
      p(9, 9, BLACK)
      p(9, 11, WHITE)
    })
    const area = computeAreaMapV7KataGo(stones, false)
    expect(area[idx(N, 9, 10)]).toBe(EMPTY)
  })
})
