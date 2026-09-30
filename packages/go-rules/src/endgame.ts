// Fin de partida del "Modo Jugar" (Fase 2, Task 4). Módulo puro: formatea el resultado final
// (resign o estimación de score) y detecta el fin por dos pases consecutivos. Sin UI, sin motor.
import type { Move, StoneColor } from '@tengen/engine'

/**
 * Resultado en formato estilo SGF RE ("B+7.5", "W+3.5", "Draw", "B+R", "W+R", "B+T", "W+T").
 *
 * - Con `timeout`: `timeout` es el color que SE QUEDÓ SIN TIEMPO; gana el OPUESTO (Fase reloj,
 *   2026-07-16). Tiene prioridad sobre `resign`/`scoreLead` si se pasan varios (no debería ocurrir
 *   en uso normal — son causas de fin de partida mutuamente excluyentes).
 * - Con `resign` (sin `timeout`): `resign` es el color que SE RINDE; gana el OPUESTO.
 *   `formatResult(_, 'black')` → 'W+R'. El `scoreLead` se ignora en este caso.
 * - Sin `resign`/`timeout`: `scoreLead` es la estimación de score en perspectiva de Negro (komi
 *   incluido, tal como lo entrega `Analysis.scoreLead`). >0 → gana Negro; <0 → gana Blanco;
 *   ===0 → 'Draw'. La diferencia se redondea a 1 decimal.
 */
export function formatResult(scoreLead: number, resign?: StoneColor, timeout?: StoneColor): string {
  if (timeout) return timeout === 'black' ? 'W+T' : 'B+T'
  if (resign) return resign === 'black' ? 'W+R' : 'B+R'
  if (scoreLead === 0) return 'Draw'
  return scoreLead > 0 ? `B+${scoreLead.toFixed(1)}` : `W+${(-scoreLead).toFixed(1)}`
}

/** true si hay al menos dos jugadas y las DOS ÚLTIMAS son ambas pase (fin de partida estándar). */
export function isGameOverByTwoPasses(moves: Move[]): boolean {
  if (moves.length < 2) return false
  const last = moves[moves.length - 1]
  const secondLast = moves[moves.length - 2]
  return last?.vertex === 'pass' && secondLast?.vertex === 'pass'
}
