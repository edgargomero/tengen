// SGF de una partida online terminada: reusa el exporter de Jugar (mismo árbol, mismo codec de
// reloj que `game/persistence.ts`). Las reglas salen de la config de la sala (chinas si no declara).
import type { StoneColor } from '@tengen/engine/types'
import { effectiveRules, type RoomState } from '@tengen/go-rules'
import { GameTree } from '../game/gameTree'
import { exportSgf } from '../game/sgf'
import { flaggedColor } from './roomText'
import { encodeClockConfig, encodeClockState } from '../game/sgfClockCodec'

/** El que cayó por tiempo se guarda en cero (su valor del log es el de su jugada anterior). */
function clocksForSgf(clocks: NonNullable<RoomState['clocks']>, flagged: StoneColor | null): NonNullable<RoomState['clocks']> {
  if (!flagged) return clocks
  return { ...clocks, [flagged]: { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 0, inByoyomi: true } }
}

export function roomToSgf(state: RoomState): string {
  const { boardSize, komi, handicap, clock } = state.config
  const tree = new GameTree({
    boardSize,
    komi,
    rules: effectiveRules(state.config),
    handicap,
    humanColor: 'black',
    ...(state.result !== undefined ? { result: state.result } : {}),
    ...(clock && state.clocks ? { clock: { config: clock, state: clocksForSgf(state.clocks, flaggedColor(state)) } } : {}),
  })
  for (const move of state.moves) tree.addMove(move)
  const meta = tree.meta.clock
  if (!meta) return exportSgf(tree)
  return exportSgf(tree, (node) => {
    const extra: Record<string, string[]> = {}
    if (node === tree.root) Object.assign(extra, encodeClockConfig(meta.config))
    if (node === tree.current) Object.assign(extra, encodeClockState(meta.state))
    return Object.keys(extra).length ? extra : undefined
  })
}
