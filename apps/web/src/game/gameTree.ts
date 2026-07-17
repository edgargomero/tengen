// Árbol de jugadas con variaciones para el "Modo Jugar" (Fase 2). Dominio puro, corre en Node.
//
// Forma del árbol (mutable con cursor):
//   - Nodos `{ id, move, parent, children }`. La RAÍZ (`move === null`, `parent === null`) es el
//     punto de partida TRAS el handicap: NO es una jugada. Sus descendientes sí son jugadas.
//   - `meta` (en el árbol, no en un nodo) lleva `{ boardSize, komi, rules, handicap, result? }`.
//   - Un `cursor` (`current`) apunta al nodo "actual"; la navegación lo muta. Elegí mutable-con-cursor
//     (no inmutable) porque la UI de Task 4/5 navega y añade jugadas de forma incremental; las
//     operaciones siguen siendo deterministas y testeables (los ids son estables y monótonos).
//
// INVARIANTE DE HANDICAP (cruza con sgf.ts y el motor): las piedras de handicap NUNCA son nodos
// de jugada ni entran en `moves[]`. Viven solo en `meta.handicap` (número de piedras); rules.ts
// las coloca a partir de `handicapVertices`. Con handicap≥2 la primera jugada real es de Blanco,
// pero eso lo decide el caller (vía `currentTurn`): el árbol solo almacena lo que se le añade.
import type { BoardSize, ClockConfig, ClockState, Move, Position, Rules, StoneColor, Vertex } from '@tengen/engine'
import { initialClockState } from '@tengen/engine'
import type GoBoard from '@sabaki/go-board'
import type { GameConfig } from './gameConfig'
import { boardFromMoves, currentTurn } from './rules'

/** Metadata de la partida (subconjunto de GameConfig relevante al árbol + SGF; sin `opponent`). */
export interface GameTreeMeta {
  boardSize: BoardSize
  komi: number
  rules: Rules
  handicap: number
  /** Resultado en formato SGF RE (p.ej. "B+Resign", "W+7.5"). Presente solo si la partida terminó. */
  result?: string
  /** Reloj de la partida: config fija + estado vivo por color. Ausente = "sin reloj" (de siempre).
   *  Mutable en el lugar (`tree.meta.clock.state.black = ...`), mismo patrón que `result` — lo muta
   *  `PlayView.tsx` tras cada jugada; se persiste en el SGF vía `game/sgfClockCodec.ts` (Task 7). */
  clock?: { config: ClockConfig; state: { black: ClockState; white: ClockState } }
}

/** Nodo del árbol. La raíz tiene `move === null` y `parent === null`. */
export interface GameNode {
  readonly id: number
  /** La jugada que llega a este nodo. `null` SOLO en la raíz. */
  readonly move: Move | null
  readonly parent: GameNode | null
  readonly children: GameNode[]
}

/** ¿Son la misma jugada? (mismo color y mismo vértice; el pase se compara aparte). */
function sameMove(a: Move, b: Move): boolean {
  if (a.color !== b.color) return false
  return sameVertex(a.vertex, b.vertex)
}

function sameVertex(a: Vertex, b: Vertex): boolean {
  if (a === 'pass' || b === 'pass') return a === b
  return a.x === b.x && a.y === b.y
}

export class GameTree {
  readonly meta: GameTreeMeta
  readonly root: GameNode
  /** Cursor: el nodo "actual". Lo mutan los métodos de navegación (no reasignar a mano). */
  current: GameNode
  private nextId = 1 // la raíz es 0

  constructor(meta: GameTreeMeta) {
    this.meta = { ...meta }
    this.root = { id: 0, move: null, parent: null, children: [] }
    this.current = this.root
  }

  /** Crea un árbol a partir de una GameConfig (descarta `opponent`, que no pertenece al árbol). Si
   *  la config trae reloj, arranca AMBOS colores con el mismo estado inicial derivado de esa config. */
  static fromConfig(config: GameConfig): GameTree {
    return new GameTree({
      boardSize: config.boardSize,
      komi: config.komi,
      rules: config.rules,
      handicap: config.handicap,
      ...(config.clock !== undefined
        ? {
            clock: {
              config: config.clock,
              state: { black: initialClockState(config.clock), white: initialClockState(config.clock) },
            },
          }
        : {}),
    })
  }

  /**
   * Añade una jugada DESDE el cursor. Si ya existe un hijo con la MISMA jugada (color+vértice),
   * navega a él (no duplica); si diverge, crea un hijo nuevo (variación). En ambos casos el cursor
   * queda en el nodo resultante, que se devuelve. NO valida reglas ni turno (eso es del caller).
   */
  addMove(move: Move): GameNode {
    const existing = this.current.children.find((c) => c.move !== null && sameMove(c.move, move))
    if (existing) {
      this.current = existing
      return existing
    }
    const node = this.appendChild(this.current, move)
    this.current = node
    return node
  }

  /**
   * Crea SIEMPRE un hijo nuevo con `move` bajo `parent`, sin dedup ni tocar el cursor. Primitiva
   * de bajo nivel que usa `importSgf` para reconstruir estructura arbitraria (incl. variaciones).
   */
  appendChild(parent: GameNode, move: Move): GameNode {
    const node: GameNode = { id: this.nextId++, move, parent, children: [] }
    parent.children.push(node)
    return node
  }

  // ── Navegación (mutan el cursor; devuelven si hubo movimiento) ──────────────────────────────

  /** Al padre. false si el cursor está en la raíz. */
  toParent(): boolean {
    if (!this.current.parent) return false
    this.current = this.current.parent
    return true
  }

  /** A un hijo por índice (default 0 = línea principal). false si no existe ese hijo. */
  toChild(index = 0): boolean {
    const child = this.current.children[index]
    if (!child) return false
    this.current = child
    return true
  }

  /** A la raíz. */
  toRoot(): void {
    this.current = this.root
  }

  // ── Consultas de estructura ─────────────────────────────────────────────────────────────────

  /** Nodos-jugada del camino de primeros-hijos desde la raíz (raíz EXCLUIDA; [] si no hay jugadas). */
  mainLine(): GameNode[] {
    const line: GameNode[] = []
    let node = this.root.children[0]
    while (node) {
      line.push(node)
      node = node.children[0]
    }
    return line
  }

  /** Índices de hijo desde la raíz hasta `node` (la raíz → []). Robusto para persistir el cursor. */
  pathTo(node: GameNode): number[] {
    const path: number[] = []
    let n: GameNode = node
    while (n.parent) {
      path.unshift(n.parent.children.indexOf(n))
      n = n.parent
    }
    return path
  }

  /** Nodo al final de un path de índices de hijo (inverso de `pathTo`). null si el path es inválido. */
  nodeAtPath(path: number[]): GameNode | null {
    let node: GameNode = this.root
    for (const index of path) {
      const child = node.children[index]
      if (!child) return null
      node = child
    }
    return node
  }

  /** Mueve el cursor al nodo de `path`. false (y no muta el cursor) si el path es inválido. */
  navigateToPath(path: number[]): boolean {
    const node = this.nodeAtPath(path)
    if (!node) return false
    this.current = node
    return true
  }

  // ── Derivación de la Position del motor (pieza de correctitud central) ──────────────────────

  /** Jugadas del camino raíz→cursor, en orden (excluye la raíz, que no tiene jugada). */
  movesTo(cursor: GameNode = this.current): Move[] {
    const moves: Move[] = []
    let n: GameNode | null = cursor
    while (n && n.move) {
      moves.push(n.move)
      n = n.parent
    }
    moves.reverse()
    return moves
  }

  /**
   * Position que se le pasa al motor: metadata + jugadas del camino raíz→cursor. `handicap` viene
   * de `meta` (las piedras NO están en `moves`). Con handicap≥2, `moves[0]` es de Blanco.
   */
  positionAt(cursor: GameNode = this.current): Position {
    return {
      boardSize: this.meta.boardSize,
      komi: this.meta.komi,
      rules: this.meta.rules,
      handicap: this.meta.handicap,
      moves: this.movesTo(cursor),
    }
  }

  // ── Helpers de display (delegan en rules.ts) ────────────────────────────────────────────────

  /** GoBoard de display en el cursor (incluye las piedras de handicap). Reusa `boardFromMoves`. */
  boardAt(cursor: GameNode = this.current): GoBoard {
    return boardFromMoves(this.meta.boardSize, this.meta.handicap, this.movesTo(cursor))
  }

  /** Color al que le toca jugar en el cursor. Reusa `currentTurn` (respeta el handicap). */
  currentTurnAt(cursor: GameNode = this.current): StoneColor {
    return currentTurn(this.meta.handicap, this.movesTo(cursor))
  }

  // ── Frente de la partida "viva" (Fase 2, Task 5: modo exploración) ─────────────────────────

  /**
   * true si el cursor está en el TIP de la línea principal (el último nodo de `mainLine()`, o la
   * raíz si aún no hay jugadas) — el frente de la partida que humano/IA siguen jugando en vivo.
   *
   * NO es lo mismo que "el cursor está en una hoja" (`current.children.length === 0`): un nodo de
   * variación recién creado TAMBIÉN es una hoja (aún no tiene hijos), pero nunca es el tip vivo
   * (las variaciones se appendean SIEMPRE como hijos no-primeros — ver `appendChild`/`addMove` — así
   * que jamás entran en `mainLine()`). Confundir "hoja" con "tip vivo" deja que, tras la PRIMERA
   * jugada de una variación, el siguiente clic se trate otra vez como partida en vivo (dispara la
   * IA o se ignora en silencio) — el caller (`PlayView.isExploring`) usa este método en vez de esa
   * heurística de hoja, precisamente para no reintroducir ese bug.
   */
  isAtLiveTip(): boolean {
    const liveTip = this.mainLine().at(-1) ?? this.root
    return this.current === liveTip
  }
}
