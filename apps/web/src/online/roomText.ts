// Textos en español de la pantalla de partida online (motivos de rechazo y resultado).
import type { RejectReason, ScoreBreakdown, SideScore } from '@tengen/go-rules'

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
  scoring: 'Estamos contando: marcá las muertas, aceptá o seguí jugando',
  'not-scoring': 'Eso solo se puede durante el conteo',
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
  if (how === 'F') return `${winner} gana por abandono`
  if (how === 'T') return `${winner} gana por tiempo`
  return `${winner} gana por ${how.replace('.', ',')} puntos`
}

const num = (n: number): string => String(n).replace('.', ',')

function sideLine(name: string, side: SideScore, rules: ScoreBreakdown['rules']): string {
  const parts: string[] = []
  if (rules === 'chinese') {
    parts.push(`${side.stones} ${side.stones === 1 ? 'piedra' : 'piedras'}`)
    parts.push(`${side.territory} territorio`)
  } else {
    parts.push(`${side.territory} territorio`)
    parts.push(`${side.prisoners} ${side.prisoners === 1 ? 'prisionero' : 'prisioneros'}`)
  }
  if (side.komi !== 0) parts.push(`${num(side.komi)} komi`)
  return `${name}: ${parts.join(' + ')} = ${num(side.total)}`
}

/** Desglose del conteo, una línea por lado (chinas: piedras + territorio; japonesas: territorio + prisioneros). */
export function scoreLines(score: ScoreBreakdown): { black: string; white: string } {
  return {
    black: sideLine('Negro', score.black, score.rules),
    white: sideLine('Blanco', score.white, score.rules),
  }
}
