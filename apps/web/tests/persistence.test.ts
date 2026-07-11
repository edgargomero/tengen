import type { Move, RankLevel } from '@tengen/engine'
import { describe, expect, it } from 'vitest'
import { isGameOverByTwoPasses } from '../src/game/endgame'
import { GameTree } from '../src/game/gameTree'
import { type StorageLike, clearGame, loadGame, saveGame } from '../src/game/persistence'

const B = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const W = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })

const KATA_OPPONENT: RankLevel = { kind: 'kata', visits: 200 }
const HUMAN_OPPONENT: RankLevel = { kind: 'human', rank: '5k' }

/** Mock in-memory de StorageLike (localStorage no existe en Node). */
function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('persistence — save/load round-trip', () => {
  it('reconstruye un árbol equivalente: metadata, jugadas, cursor y opponent (kata)', () => {
    const t = new GameTree({ boardSize: 19, komi: 0.5, rules: 'japanese', handicap: 2 })
    t.addMove(W(15, 15))
    t.addMove(B(3, 3))
    t.toRoot()
    const variation = t.addMove(W(2, 2)) // variación; el cursor queda aquí
    expect(t.current).toBe(variation)

    const storage = memStorage()
    saveGame(storage, KATA_OPPONENT, t)
    const loaded = loadGame(storage)

    expect(loaded).not.toBeNull()
    expect(loaded!.opponent).toEqual(KATA_OPPONENT)
    expect(loaded!.tree.meta).toEqual({ boardSize: 19, komi: 0.5, rules: 'japanese', handicap: 2 })
    // línea principal preservada (primeros hijos)
    expect(loaded!.tree.mainLine().map((n) => n.move)).toEqual([W(15, 15), B(3, 3)])
    // la variación (segundo hijo de la raíz) también
    expect(loaded!.tree.root.children).toHaveLength(2)
    // el cursor se restauró por path de índices (segundo hijo de la raíz)
    expect(loaded!.tree.current.move).toEqual(W(2, 2))
    expect(loaded!.tree.pathTo(loaded!.tree.current)).toEqual([1])
  })

  it('preserva el opponent Human SL (kind human + rank)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(4, 4))
    const storage = memStorage()
    saveGame(storage, HUMAN_OPPONENT, t)
    const loaded = loadGame(storage)
    expect(loaded).not.toBeNull()
    expect(loaded!.opponent).toEqual(HUMAN_OPPONENT)
  })

  it('preserva un cursor en la raíz', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(4, 4))
    t.toRoot()
    const storage = memStorage()
    saveGame(storage, KATA_OPPONENT, t)
    const loaded = loadGame(storage)
    expect(loaded!.tree.current).toBe(loaded!.tree.root)
  })

  // FIX 2 (fix wave post-Fase 2): cuando `analyzeToScore` falla, `finishTurn` persiste `meta.result='Void'`
  // (un RE válido de SGF) para que memoria y storage no diverjan. Al restaurar, `meta.result` presente
  // hace nacer `endedRef` en true → la partida NO revive. Este test fija ese contrato en el canal de
  // persistencia (round-trip de `meta.result` vía el `RE` del SGF) + que los dos pases finales
  // sobreviven (el input que `boot()` inspecciona con `isGameOverByTwoPasses`).
  it("preserva meta.result='Void' y los dos pases finales de una partida terminada (FIX 2)", () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(4, 4))
    t.addMove({ color: 'white', vertex: 'pass' })
    t.addMove({ color: 'black', vertex: 'pass' })
    t.meta.result = 'Void'
    const storage = memStorage()
    saveGame(storage, KATA_OPPONENT, t)
    const loaded = loadGame(storage)
    expect(loaded).not.toBeNull()
    expect(loaded!.tree.meta.result).toBe('Void')
    expect(isGameOverByTwoPasses(loaded!.tree.movesTo())).toBe(true)
  })
})

describe('persistence — casos de fallo (nunca lanza, devuelve null)', () => {
  it('storage vacío → null', () => {
    expect(loadGame(memStorage())).toBeNull()
  })

  it('JSON corrupto → null', () => {
    const storage = memStorage()
    storage.map.set('tengen:game:v1', '{no es json válido')
    expect(loadGame(storage)).toBeNull()
  })

  it('JSON válido pero con forma equivocada → null', () => {
    const storage = memStorage()
    storage.map.set('tengen:game:v1', JSON.stringify({ foo: 'bar' }))
    expect(loadGame(storage)).toBeNull()
  })

  it('storage.getItem lanza (modo privado / storage bloqueado) → null, no propaga', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new DOMException('storage blocked', 'SecurityError')
      },
      setItem: () => {},
      removeItem: () => {},
    }
    expect(() => loadGame(storage)).not.toThrow()
    expect(loadGame(storage)).toBeNull()
  })

  it('payload viejo v1 sin `opponent` (Task 2) → null (R3: el guard nuevo lo rechaza)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(4, 4))
    const storage = memStorage()
    // Forma exacta del payload de Task 2: sin `opponent`.
    storage.map.set('tengen:game:v1', JSON.stringify({ sgf: 'no importa', cursorPath: [] }))
    expect(loadGame(storage)).toBeNull()
  })

  it('opponent ausente → null', () => {
    const storage = memStorage()
    storage.map.set('tengen:game:v1', JSON.stringify({ sgf: '(;GM[1])', cursorPath: [] }))
    expect(loadGame(storage)).toBeNull()
  })

  it('opponent con kind desconocido → null', () => {
    const storage = memStorage()
    storage.map.set(
      'tengen:game:v1',
      JSON.stringify({ opponent: { kind: 'bogus' }, sgf: '(;GM[1])', cursorPath: [] }),
    )
    expect(loadGame(storage)).toBeNull()
  })

  it('opponent kind=human sin rank (forma inválida) → null', () => {
    const storage = memStorage()
    storage.map.set(
      'tengen:game:v1',
      JSON.stringify({ opponent: { kind: 'human' }, sgf: '(;GM[1])', cursorPath: [] }),
    )
    expect(loadGame(storage)).toBeNull()
  })

  it('opponent kind=kata sin visits (forma inválida) → null', () => {
    const storage = memStorage()
    storage.map.set(
      'tengen:game:v1',
      JSON.stringify({ opponent: { kind: 'kata' }, sgf: '(;GM[1])', cursorPath: [] }),
    )
    expect(loadGame(storage)).toBeNull()
  })
})

describe('persistence — clearGame', () => {
  it('borra la partida guardada (loadGame posterior → null)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(4, 4))
    const storage = memStorage()
    saveGame(storage, KATA_OPPONENT, t)
    expect(loadGame(storage)).not.toBeNull()
    clearGame(storage)
    expect(loadGame(storage)).toBeNull()
  })
})
