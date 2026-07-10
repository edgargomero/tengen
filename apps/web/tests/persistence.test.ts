import type { Move } from '@tengen/engine'
import { describe, expect, it } from 'vitest'
import { GameTree } from '../src/game/gameTree'
import { type StorageLike, clearGame, loadGame, saveGame } from '../src/game/persistence'

const B = (x: number, y: number): Move => ({ color: 'black', vertex: { x, y } })
const W = (x: number, y: number): Move => ({ color: 'white', vertex: { x, y } })

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
  it('reconstruye un árbol equivalente: metadata, jugadas y cursor', () => {
    const t = new GameTree({ boardSize: 19, komi: 0.5, rules: 'japanese', handicap: 2 })
    t.addMove(W(15, 15))
    t.addMove(B(3, 3))
    t.toRoot()
    const variation = t.addMove(W(2, 2)) // variación; el cursor queda aquí
    expect(t.current).toBe(variation)

    const storage = memStorage()
    saveGame(storage, t)
    const loaded = loadGame(storage)

    expect(loaded).not.toBeNull()
    expect(loaded!.meta).toEqual({ boardSize: 19, komi: 0.5, rules: 'japanese', handicap: 2 })
    // línea principal preservada (primeros hijos)
    expect(loaded!.mainLine().map((n) => n.move)).toEqual([W(15, 15), B(3, 3)])
    // la variación (segundo hijo de la raíz) también
    expect(loaded!.root.children).toHaveLength(2)
    // el cursor se restauró por path de índices (segundo hijo de la raíz)
    expect(loaded!.current.move).toEqual(W(2, 2))
    expect(loaded!.pathTo(loaded!.current)).toEqual([1])
  })

  it('preserva un cursor en la raíz', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(4, 4))
    t.toRoot()
    const storage = memStorage()
    saveGame(storage, t)
    const loaded = loadGame(storage)
    expect(loaded!.current).toBe(loaded!.root)
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
})

describe('persistence — clearGame', () => {
  it('borra la partida guardada (loadGame posterior → null)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(4, 4))
    const storage = memStorage()
    saveGame(storage, t)
    expect(loadGame(storage)).not.toBeNull()
    clearGame(storage)
    expect(loadGame(storage)).toBeNull()
  })
})
