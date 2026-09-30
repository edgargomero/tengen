// Textos en español de la pantalla de partida online (motivos de rechazo y resultado).
import type { RejectReason } from '@tengen/go-rules'

const REJECT_TEXT: Record<RejectReason, string> = {
  stale: 'La partida cambió mientras jugabas; probá de nuevo',
  'not-a-player': 'Solo los jugadores pueden jugar',
  'not-started': 'La partida todavía no empezó',
  'game-over': 'La partida ya terminó',
  'not-your-turn': 'No es tu turno',
  illegal: 'Jugada ilegal',
  ko: 'Ko: no podés retomar enseguida',
  suicide: 'Esa jugada sería suicidio',
  occupied: 'Ese punto está ocupado',
  scoring: 'La partida está en conteo',
  'not-scoring': 'La partida no está en conteo',
}

export function rejectMessage(reason: RejectReason): string {
  return REJECT_TEXT[reason]
}

/** Resultado en estilo SGF RE ('B+2.0', 'W+R', 'B+T', 'Draw') → frase para el jugador. */
export function resultText(result: string): string {
  if (result === 'Draw') return 'Empate'
  const m = /^([BW])\+(.+)$/.exec(result)
  if (!m) return result
  const winner = m[1] === 'B' ? 'Negro' : 'Blanco'
  const how = m[2]!
  if (how === 'R') return `${winner} gana por rendición`
  if (how === 'T') return `${winner} gana por tiempo`
  return `${winner} gana por ${how.replace('.', ',')} puntos`
}
