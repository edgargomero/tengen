// Fase Aprender T4: máquina de estados PURA de un ejercicio de tsumego. Sin motor adentro: ante
// una jugada fuera del árbol de solución devuelve 'fuera-de-arbol' y es la VISTA la que decide
// llamar a la refutación del motor (learn/engineRefutation.ts) y cerrar con fail().
//
// El árbol del Exercise se materializa como GameTree (setup + initialTurn del alumno) y un Map
// GameNode → ExerciseNode. Ese Map es también el límite del ejercicio: una variación creada por un
// intento fuera-de-arbol queda en el GameTree (el tablero la muestra) pero NO entra al Map, así que
// reintentarla sigue siendo fuera-de-arbol — el árbol de solución no se contamina.
import type { Move, StoneColor } from '@tengen/engine'
import { GameTree, type GameNode } from '../game/gameTree'
import { validateMove } from '../game/rules'
import type { Exercise, ExerciseNode } from './exercise'

export type SessionState = 'esperando' | 'respondiendo' | 'resuelto' | 'fallado'

export type AttemptResult =
  | { kind: 'ilegal'; reason: 'ko' | 'suicide' | 'overwrite' }
  | { kind: 'fuera-de-arbol'; move: Move }
  | { kind: 'fallo-en-arbol'; refutation?: Move; comment?: string }
  | { kind: 'avanza'; reply: Move; comment?: string }
  | { kind: 'resuelto'; reply?: Move; comment?: string }

export interface ExerciseSession {
  readonly exercise: Exercise
  /** GameTree vivo (setup + initialTurn): la vista lo pinta y el motor recibe su positionAt(). */
  readonly tree: GameTree
  readonly state: SessionState
  /** Intento del alumno en `vertex`. Solo válido en estado 'esperando' (si no, lanza). */
  attempt(vertex: { x: number; y: number }): AttemptResult
  /** Cierra un 'fuera-de-arbol' como fallado (lo llama la vista tras mostrar la refutación). */
  fail(): void
  /** Vuelve al setup limpio (estado 'esperando'). */
  reintentar(): void
  /** Línea principal de la solución (primera rama correcta del alumno, resistencia principal). */
  solution(): Move[]
}

export function createExerciseSession(exercise: Exercise): ExerciseSession {
  const tree = new GameTree({
    boardSize: exercise.boardSize,
    komi: 7.5, // irrelevante para el veredicto (la refutación compara scoreLead ANTES vs DESPUÉS)
    rules: 'chinese',
    handicap: 0,
    humanColor: exercise.toPlay,
    setup: exercise.setup,
    initialTurn: exercise.toPlay,
  })

  // Materializa el árbol de solución y el Map que delimita "qué es del ejercicio".
  const info = new Map<GameNode, ExerciseNode>()
  info.set(tree.root, exercise.tree)
  const materialize = (exerciseNode: ExerciseNode, parent: GameNode): void => {
    for (const child of exerciseNode.children) {
      if (!child.move) continue // exerciseIssues ya lo reporta; acá se ignora en defensa
      const gameNode = tree.appendChild(parent, child.move)
      info.set(gameNode, child)
      materialize(child, gameNode)
    }
  }
  materialize(exercise.tree, tree.root)

  let state: SessionState = 'esperando'

  const attempt = (vertex: { x: number; y: number }): AttemptResult => {
    if (state !== 'esperando') {
      throw new Error(`attempt() en estado '${state}' (solo válido en 'esperando')`)
    }
    const verdict = validateMove(tree.boardAt(), exercise.toPlay, vertex)
    if (!verdict.legal) {
      return { kind: 'ilegal', reason: verdict.reason ?? 'overwrite' }
    }
    const move: Move = { color: exercise.toPlay, vertex }
    const child = tree.findChild(tree.current, move)
    const childInfo = child ? info.get(child) : undefined

    if (!child || !childInfo) {
      // Fuera del árbol de solución: la jugada entra al GameTree (el tablero la muestra y
      // positionAt() se la da al motor) pero no al Map — sigue sin ser "del ejercicio".
      tree.addMove(move)
      state = 'respondiendo'
      return { kind: 'fuera-de-arbol', move }
    }

    tree.addMove(move) // navega al hijo existente (findChild adentro): no duplica
    if (childInfo.correct === false) {
      // Refutación del propio árbol: se muestra el castigo (primera respuesta del rival, si hay).
      const refutationNode = child.children[0]
      const refutation = refutationNode?.move
      if (refutation) tree.addMove(refutation)
      state = 'fallado'
      return {
        kind: 'fallo-en-arbol',
        ...(refutation ? { refutation } : {}),
        ...(childInfo.comment !== undefined ? { comment: childInfo.comment } : {}),
      }
    }

    // Jugada correcta: sin continuación → resuelto; con continuación → responde el rival
    // (resistencia principal = children[0]).
    if (child.children.length === 0) {
      state = 'resuelto'
      return { kind: 'resuelto', ...(childInfo.comment !== undefined ? { comment: childInfo.comment } : {}) }
    }
    const replyGameNode = child.children[0]!
    const replyInfo = info.get(replyGameNode)
    const reply = replyGameNode.move!
    tree.addMove(reply)
    if (replyGameNode.children.length === 0) {
      // La línea guionada termina en jugada del rival: el alumno ya jugó todo lo correcto.
      state = 'resuelto'
      return { kind: 'resuelto', reply, ...(replyInfo?.comment !== undefined ? { comment: replyInfo.comment } : {}) }
    }
    return { kind: 'avanza', reply, ...(replyInfo?.comment !== undefined ? { comment: replyInfo.comment } : {}) }
  }

  const solution = (): Move[] => {
    const line: Move[] = []
    let node: ExerciseNode = exercise.tree
    let studentTurn = true
    for (;;) {
      const next: ExerciseNode | undefined = studentTurn
        ? node.children.find((c) => c.correct === true)
        : node.children[0]
      if (!next?.move) return line
      line.push(next.move)
      node = next
      studentTurn = !studentTurn
    }
  }

  return {
    exercise,
    tree,
    get state() {
      return state
    },
    attempt,
    fail() {
      state = 'fallado'
    },
    reintentar() {
      tree.toRoot()
      state = 'esperando'
    },
    solution,
  }
}
