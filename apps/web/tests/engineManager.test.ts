import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineManager, WorkerCrashError } from '../src/engine/engineManager'
import type { ManagedEngine, ManagedEngineFactory } from '../src/engine/engineManager'
import type {
  Analysis,
  BoardSize,
  CancelFn,
  ClockConfig,
  ClockState,
  Engine,
  Move,
  NetworkId,
  Position,
  RankLevel,
} from '@tengen/engine'

// ─────────────────────────────────────────────────────────────────────────────
// Tests Node del motor persistente. `EngineManager` no referencia `Worker` (la
// construcción del Worker vive en workerManagedEngine.ts, browser-only), así que
// aquí lo probamos con un `ManagedEngineFactory` mock 100% programable. Foco:
// concurrencia serial, recuperación de crash (race-contra-crash + reintento) y
// timeout de analyzeToScore. Sin sleeps reales: los tests de timeout usan fake
// timers. La disciplina de "no unhandled rejection" con promesas que nunca
// resuelven se verifica por salida limpia del runner.
// ─────────────────────────────────────────────────────────────────────────────

const POS: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }
const LEVEL: RankLevel = { kind: 'kata', visits: 100 }

function mkMove(x: number, y: number): Move {
  return { color: 'black', vertex: { x, y } }
}
function mkAnalysis(visits: number): Analysis {
  return { winrate: 0.5, scoreLead: 0, scoreStdev: 1, visits, moves: [] }
}

/** Motor falso programable. Los impls por-instancia se fijan vía el callback `program` de la harness. */
class FakeEngine implements Engine {
  initCalls: Array<{ network: NetworkId; boardSize: BoardSize }> = []
  genMoveCalls = 0
  analyzeCalls = 0
  stopCalls = 0
  /** Programable por instancia. Por defecto lanza (obliga al test a programarlo cuando lo usa). */
  genMoveImpl: (
    pos: Position,
    opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } },
  ) => Promise<Move> = () => {
    throw new Error('FakeEngine: genMoveImpl no programado')
  }
  /** Chunks que `analyze` emite SÍNCRONAMENTE al invocarse (útil con fake timers). */
  analyzeChunks: Analysis[] = []
  analyzeCancelled = false
  /** Si se programa, `analyze` invoca el 4º parámetro (`onError`, canal de error POR-LLAMADA del
   *  motor — distinto del crash del Worker) SÍNCRONAMENTE con este valor, tras emitir los chunks. */
  analyzeErrorToFire: unknown | undefined = undefined

  async init(config: { network: NetworkId; boardSize: BoardSize }): Promise<void> {
    this.initCalls.push(config)
  }
  genMove(pos: Position, opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } }): Promise<Move> {
    this.genMoveCalls++
    return this.genMoveImpl(pos, opts)
  }
  analyze(_pos: Position, _opts: { visits: number }, onUpdate: (a: Analysis) => void, onError?: (e: unknown) => void): CancelFn {
    this.analyzeCalls++
    for (const chunk of this.analyzeChunks) onUpdate(chunk)
    if (this.analyzeErrorToFire !== undefined) onError?.(this.analyzeErrorToFire)
    return () => {
      this.analyzeCancelled = true
    }
  }
  stop(): void {
    this.stopCalls++
  }
}

type Instance = {
  engine: FakeEngine
  terminated: boolean
  /** Dispara el `onError` que registró el EngineManager (simula el evento 'error' del Worker). */
  fireError: (e: unknown) => void
}

/** Construye una factory mock + la lista de instancias creadas (una por rebuild). */
function makeHarness(program?: (engine: FakeEngine, index: number) => void): {
  factory: ManagedEngineFactory
  instances: Instance[]
} {
  const instances: Instance[] = []
  const factory: ManagedEngineFactory = (): ManagedEngine => {
    const engine = new FakeEngine()
    program?.(engine, instances.length)
    let errCb: ((e: unknown) => void) | undefined
    const inst: Instance = {
      engine,
      terminated: false,
      fireError: (e) => {
        if (errCb) errCb(e)
      },
    }
    instances.push(inst)
    return {
      engine,
      terminate: () => {
        inst.terminated = true
      },
      onError: (cb) => {
        errCb = cb
      },
    }
  }
  return { factory, instances }
}

/** Vacía la cola de microtareas (deja avanzar reconcile no-op + enganche de raceOp). */
async function flush(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('EngineManager.ensureReady', () => {
  it('idempotente: dos ensureReady con la misma config → 1 build, 1 init', async () => {
    const { factory, instances } = makeHarness()
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    await mgr.ensureReady('b18', 9)

    expect(instances).toHaveLength(1)
    expect(instances[0]!.engine.initCalls).toEqual([{ network: 'b18', boardSize: 9 }])
  })

  it('rebuild al cambiar boardSize: termina el 1º, re-init con el nuevo tamaño', async () => {
    const { factory, instances } = makeHarness()
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    await mgr.ensureReady('b18', 13)

    expect(instances).toHaveLength(2)
    expect(instances[0]!.terminated).toBe(true)
    expect(instances[1]!.engine.initCalls).toEqual([{ network: 'b18', boardSize: 13 }])
  })

  it('rebuild al cambiar network: termina el 1º, re-init con la nueva red', async () => {
    const { factory, instances } = makeHarness()
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    await mgr.ensureReady('humanv0', 9)

    expect(instances).toHaveLength(2)
    expect(instances[0]!.terminated).toBe(true)
    expect(instances[1]!.engine.initCalls).toEqual([{ network: 'humanv0', boardSize: 9 }])
  })
})

describe('EngineManager.genMove', () => {
  it('normal: delega y devuelve el Move del engine', async () => {
    const move = mkMove(3, 5)
    const { factory, instances } = makeHarness((engine) => {
      engine.genMoveImpl = async () => move
    })
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    const result = await mgr.genMove(POS, LEVEL)

    expect(result).toEqual(move)
    expect(instances).toHaveLength(1)
    expect(instances[0]!.engine.genMoveCalls).toBe(1)
  })

  it('error determinista (engine vivo): propaga sin reintentar (no rebuild)', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.genMoveImpl = () => Promise.reject(new Error('genMove human requiere meta'))
    })
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    await expect(mgr.genMove(POS, LEVEL)).rejects.toThrow('genMove human requiere meta')

    // NO reconstruye: la factory sigue en 1 build; el engine no se marcó muerto.
    expect(instances).toHaveLength(1)
    expect(instances[0]!.terminated).toBe(false)
  })

  it('crash en vuelo → rebuild + reintento único devuelve el 2º Move', async () => {
    const move2 = mkMove(2, 2)
    const { factory, instances } = makeHarness((engine, i) => {
      // 1ª instancia: genMove NUNCA resuelve (simula worker vivo pero luego muerto).
      // 2ª instancia: devuelve move2.
      engine.genMoveImpl = i === 0 ? () => new Promise<Move>(() => {}) : async () => move2
    })
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    const p = mgr.genMove(POS, LEVEL)
    await flush() // deja que reconcile no-op complete y raceOp enganche en la instancia 0
    instances[0]!.fireError(new Error('worker murió'))

    await expect(p).resolves.toEqual(move2)
    expect(instances).toHaveLength(2)
    expect(instances[0]!.terminated).toBe(true)
    // La op en vuelo SÍ arrancó en la instancia crasheada (prueba la ruta race, no la de rebuild idle).
    expect(instances[0]!.engine.genMoveCalls).toBe(1)
    expect(instances[1]!.engine.genMoveCalls).toBe(1)
  })

  it('crash en ambos intentos → rechaza (exactamente 1 reintento, sin bucle infinito)', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.genMoveImpl = () => new Promise<Move>(() => {}) // todas cuelgan
    })
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    const p = mgr.genMove(POS, LEVEL)
    await flush()
    instances[0]!.fireError(new Error('crash 1'))
    await flush()
    instances[1]!.fireError(new Error('crash 2'))

    await expect(p).rejects.toBeInstanceOf(WorkerCrashError)
    expect(instances).toHaveLength(2) // build0 + build1: un solo reintento
  })

  it('pasa el reloj opcional tal cual al engine.genMove', async () => {
    let receivedClock: { config: ClockConfig; state: ClockState } | undefined
    const move = mkMove(3, 5)
    const { factory } = makeHarness((engine) => {
      engine.genMoveImpl = async (_pos, opts) => {
        receivedClock = opts.clock
        return move
      }
    })
    const mgr = new EngineManager(factory)
    await mgr.ensureReady('b18', 9)

    const clock: { config: ClockConfig; state: ClockState } = {
      config: { mainTimeMs: 60_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 },
      state: { mainTimeRemainingMs: 60_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
    }
    await mgr.genMove(POS, LEVEL, clock)
    expect(receivedClock).toEqual(clock)
  })

  it('sin reloj (comportamiento de siempre): el engine recibe clock undefined', async () => {
    let receivedClock: unknown = 'no-asignado-todavia'
    const { factory } = makeHarness((engine) => {
      engine.genMoveImpl = async (_pos, opts) => {
        receivedClock = opts.clock
        return mkMove(1, 1)
      }
    })
    const mgr = new EngineManager(factory)
    await mgr.ensureReady('b18', 9)
    await mgr.genMove(POS, LEVEL)
    expect(receivedClock).toBeUndefined()
  })
})

describe('EngineManager.analyzeToScore', () => {
  it('resuelve cuando visits >= target y cancela el análisis', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.analyzeChunks = [mkAnalysis(32), mkAnalysis(64), mkAnalysis(100)]
    })
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    const result = await mgr.analyzeToScore(POS, 100)

    expect(result.visits).toBe(100)
    expect(instances[0]!.engine.analyzeCancelled).toBe(true)
  })

  it('timeout con fallback: resuelve con el último Analysis recibido', async () => {
    vi.useFakeTimers()
    const { factory, instances } = makeHarness((engine) => {
      engine.analyzeChunks = [mkAnalysis(64)] // nunca alcanza 100
    })
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    const p = mgr.analyzeToScore(POS, 100, 5000)
    await vi.advanceTimersByTimeAsync(5000)

    const result = await p
    expect(result.visits).toBe(64)
    expect(instances[0]!.engine.analyzeCancelled).toBe(true) // el timeout cancela el análisis
  })

  it('timeout sin datos: rechaza si nunca llegó ningún Analysis', async () => {
    vi.useFakeTimers()
    const { factory } = makeHarness((engine) => {
      engine.analyzeChunks = [] // no emite nada
    })
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    const p = mgr.analyzeToScore(POS, 100, 5000)
    const expectation = expect(p).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(5000)
    await expectation
  })
})

describe('EngineManager.analyze', () => {
  it('reenvía cada onUpdate del motor mock (streaming: no solo el último)', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.analyzeChunks = [mkAnalysis(32), mkAnalysis(64), mkAnalysis(100)]
    })
    const mgr = new EngineManager(factory)
    await mgr.ensureReady('b18', 9)

    const updates: Analysis[] = []
    mgr.analyze(POS, 100, (a) => updates.push(a))
    await flush()

    expect(updates.map((a) => a.visits)).toEqual([32, 64, 100])
    expect(instances[0]!.engine.analyzeCalls).toBe(1)
  })

  it('cancelar vía el CancelFn devuelto detiene los onUpdate futuros e invoca el CancelFn real del motor', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.analyzeChunks = [mkAnalysis(32), mkAnalysis(64), mkAnalysis(100)]
    })
    const mgr = new EngineManager(factory)
    await mgr.ensureReady('b18', 9)

    const updates: Analysis[] = []
    const cancel = mgr.analyze(POS, 100, (a) => {
      updates.push(a)
      if (updates.length === 1) cancel() // cancela desde dentro del primer onUpdate
    })
    await flush()

    // Solo el primer chunk llegó al caller (los demás se filtraron tras cancelar), y el CancelFn
    // real del motor sí se invocó (no es solo un no-op local).
    expect(updates.map((a) => a.visits)).toEqual([32])
    expect(instances[0]!.engine.analyzeCancelled).toBe(true)
  })

  it('un crash del worker durante un analyze en curso invoca onError (no deja la operación colgada)', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.analyzeChunks = [] // el mock no completa por sí solo: el análisis queda "en curso"
    })
    const mgr = new EngineManager(factory)
    await mgr.ensureReady('b18', 9)

    const errors: unknown[] = []
    mgr.analyze(POS, 100, () => {}, (e) => errors.push(e))
    await flush() // deja que reconcile (no-op) resuelva y engine.analyze arranque
    instances[0]!.fireError(new Error('worker murió'))
    await flush()

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(WorkerCrashError)
  })

  it('un error determinista por-llamada del motor (4º parámetro de engine.analyze, distinto de un crash) se reenvía a onError', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.analyzeChunks = [mkAnalysis(32)]
      engine.analyzeErrorToFire = new Error('motor: red sin meta_input para Human SL')
    })
    const mgr = new EngineManager(factory)
    await mgr.ensureReady('b18', 9)

    const errors: unknown[] = []
    mgr.analyze(POS, 100, () => {}, (e) => errors.push(e))
    await flush()

    expect(instances[0]!.engine.analyzeCalls).toBe(1)
    expect(errors).toEqual([new Error('motor: red sin meta_input para Human SL')])
  })

  it('cancelar suprime el error determinista por-llamada si llega DESPUÉS de cancelar (el caller ya se fue)', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.analyzeChunks = [mkAnalysis(32)] // el mock emite este chunk y RECIÉN DESPUÉS dispara el error
      engine.analyzeErrorToFire = new Error('tardío, tras cancelar')
    })
    const mgr = new EngineManager(factory)
    await mgr.ensureReady('b18', 9)

    const errors: unknown[] = []
    // Cancela desde DENTRO del primer (único) onUpdate: para cuando el mock dispara `analyzeErrorToFire`
    // (después de agotar `analyzeChunks`, mismo tick), `cancelled` ya es true.
    const cancel = mgr.analyze(POS, 100, () => cancel(), (e) => errors.push(e))
    await flush()

    expect(instances[0]!.engine.analyzeCalls).toBe(1)
    expect(errors).toHaveLength(0)
  })

  it('cancelar INMEDIATAMENTE (antes de que reconcile() resuelva) evita invocar engine.analyze y no deja listener de crash huérfano', async () => {
    const { factory, instances } = makeHarness((engine) => {
      engine.analyzeChunks = [mkAnalysis(50)]
    })
    const mgr = new EngineManager(factory)
    await mgr.ensureReady('b18', 9)

    const errors: unknown[] = []
    const cancel = mgr.analyze(POS, 100, () => {}, (e) => errors.push(e))
    cancel() // síncrono: reconcile() todavía no resolvió (su promesa se asienta en un microtask)

    await flush()
    expect(instances[0]!.engine.analyzeCalls).toBe(0)

    // Un crash DESPUÉS de la cancelación temprana no debe reportarse: el caller ya se fue y este
    // analyze nunca llegó a registrar un listener de crash.
    instances[0]!.fireError(new Error('crash tardío, tras cancelación temprana'))
    await flush()
    expect(errors).toHaveLength(0)
  })
})

describe('EngineManager.dispose', () => {
  it('termina el managed engine actual', async () => {
    const { factory, instances } = makeHarness()
    const mgr = new EngineManager(factory)

    await mgr.ensureReady('b18', 9)
    mgr.dispose()

    expect(instances[0]!.terminated).toBe(true)
  })
})
