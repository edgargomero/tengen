// SGF de una partida online terminada: reusa el exporter de Jugar (mismo árbol, mismo codec de
// reloj que `game/persistence.ts`). Las reglas de la sala son por área → `chinese`.
import type { RoomState } from '@tengen/go-rules'
import { GameTree } from '../game/gameTree'
import { exportSgf } from '../game/sgf'
import { encodeClockConfig, encodeClockState } from '../game/sgfClockCodec'

export function roomToSgf(state: RoomState): string {
  const { boardSize, komi, handicap, clock } = state.config
  const tree = new GameTree({
    boardSize,
    komi,
    rules: 'chinese',
    handicap,
    humanColor: 'black',
    ...(state.result !== undefined ? { result: state.result } : {}),
    ...(clock && state.clocks ? { clock: { config: clock, state: state.clocks } } : {}),
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
