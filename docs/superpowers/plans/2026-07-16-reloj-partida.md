# Reloj de Partida (tiempo principal + byoyomi) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un reloj de partida (tiempo principal + byoyomi japonés, opcional) a Modo Jugar, donde tanto el jugador humano como la IA lo respetan — la IA con gestión de tiempo adaptativa (corta antes por convergencia, extiende una vez en posiciones difíciles) reusando el `maxTimeMs` que el MCTS ya soporta.

**Architecture:** Módulo de dominio puro `ClockConfig`/`ClockState`/`applyElapsed` en `packages/engine` (reusable, en el futuro, por el Durable Object de PvP). Política de gestión de tiempo de la IA (`timeManagementPolicy.ts`) SEPARADA del reloj de dominio — pura, sin lectura de reloj real, testeada con fixtures. `LocalEngine.genMove` corre en chunks (reusa el patrón ya existente de `analyze()`) cuando se le pasa un reloj; sin reloj, comportamiento byte-idéntico al actual. El reloj vive en `GameTree.meta.clock` (mismo patrón mutable que `meta.result`), se persiste en el SGF vía propiedades estándar (`TM`/`BL`/`WL`/`OB`/`OW`) + 2 propias (`TGBP`/`TGBT`), y `PlayView.tsx` lo tickea, muestra y aplica como derrota por tiempo.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Vitest, Preact. Sin dependencias nuevas.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-16-reloj-partida-design.md` (aprobada).
- El reloj es **opcional** (`GameConfig.clock?: ClockConfig`) — ausente = comportamiento actual, byte-idéntico, en todos los call sites (`LocalEngine.genMove`, `EngineManager.genMove`, `GameTree.meta`, SGF).
- Solo **tiempo principal + byoyomi japonés** en v1 — nada de Fischer/incremento ni byoyomi canadiense.
- **Ambos** (humano e IA) respetan el reloj — la IA con gestión de tiempo adaptativa (Opción B del brainstorm), no solo un tope duro.
- El módulo de dominio del reloj vive en **`packages/engine`**, no en `apps/web` — para que el futuro Durable Object de PvP lo reuse.
- `timeManagementPolicy.ts` es una función **pura** — nunca lee el reloj real (`Date.now()`/`performance.now()`); el lector de reloj se inyecta (mismo patrón que `evaluatorFactory` en `LocalEngine`).
- Modo Analizar **no** tiene reloj — cero cambios en `AnalyzeView.tsx`/`analysis/*`.
- Propiedades SGF: estándar donde existen (`TM`, `BL`, `WL`, `OB`, `OW`); dos propias con prefijo `TG` solo para la config de byoyomi (`TGBP`, `TGBT`) — mismo criterio que `analysis/sgfAnalysisCodec.ts`.
- `game/sgf.ts` **no** importa nada de reloj — todo pasa por el gancho genérico `getExtraData`/`onNodeData` que ya existe.
- Sin tests de componente Preact (convención ya establecida) — los cambios en `NewGameForm.tsx`/`PlayView.tsx` se verifican manualmente en navegador (Task 13).

---

### Task 1: Tipos del reloj + módulo puro `applyElapsed`

**Files:**
- Modify: `packages/engine/src/types.ts`
- Create: `packages/engine/src/clock/clock.ts`
- Create: `packages/engine/tests/clock.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- Produces: `ClockConfig`, `ClockState` (types.ts, reexportados vía `index.ts`'s `export * from './types'`), `applyElapsed(state: ClockState, config: ClockConfig, elapsedMs: number): { state: ClockState; timedOut: boolean }`, `initialClockState(config: ClockConfig): ClockState` (ambas exportadas desde `clock/clock.ts` y desde `index.ts`).
- Consumes: nada (módulo hoja, sin dependencias internas más allá de sus propios tipos).

- [ ] **Step 1: Agregar `ClockConfig`/`ClockState` a `types.ts`**

En `packages/engine/src/types.ts`, insertar DESPUÉS de `export type Analysis = {...}` y ANTES de `export type CancelFn = () => void`:

```ts
/** Ajustes fijos del reloj de una partida (tiempo principal + byoyomi japonés). Ausente en
 *  `GameConfig.clock` = partida sin reloj (comportamiento de siempre). */
export interface ClockConfig {
  /** 0 = "byoyomi desde la primera jugada" (válido). */
  mainTimeMs: number
  /** 0 = sin byoyomi (solo tiempo principal — agotarlo es derrota inmediata). */
  byoyomiPeriods: number
  byoyomiPeriodMs: number
}

/** Estado vivo del reloj de UN color en un momento dado. */
export interface ClockState {
  mainTimeRemainingMs: number
  byoyomiPeriodsRemaining: number
  inByoyomi: boolean
}
```

Luego, reemplazar la firma de `genMove` en `Engine`:

```ts
export interface Engine {
  init(config: { network: NetworkId; boardSize: BoardSize }): Promise<void>
  genMove(pos: Position, opts: { level: RankLevel }): Promise<Move>
```

por:

```ts
export interface Engine {
  init(config: { network: NetworkId; boardSize: BoardSize }): Promise<void>
  /** `clock` opcional (Fase reloj, 2026-07-16): presupuesto de tiempo de ESTE color para esta
   *  jugada. Ausente = comportamiento de siempre (visits puras, techo de seguridad fijo). */
  genMove(pos: Position, opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } }): Promise<Move>
```

- [ ] **Step 2: Crear `packages/engine/src/clock/clock.ts`**

```ts
// Reloj de partida (tiempo principal + byoyomi japonés) — módulo de dominio puro, sin dependencias
// de browser ni de red. Vive en packages/engine (no en apps/web) para que el futuro Durable Object
// de PvP lo reuse sin reescribir esta semántica — ver spec 2026-07-16-reloj-partida-design.md.
//
// Semántica de byoyomi japonés: mientras mainTimeRemainingMs > 0, cada jugada descuenta del pozo
// principal. Al agotarse, entra en byoyomi: cada jugada dispone de byoyomiPeriodMs. Si se juega
// DENTRO del período, se recicla completo (nunca se acumula ni se pierde). Si se EXCEDE, se
// consumen tantos períodos completos como quepan en el tiempo transcurrido — regla GENERAL, no un
// caso especial de "un período": es la misma fórmula que ejercita la extensión de la IA a 2
// períodos (ver packages/engine/src/search/timeManagementPolicy.ts).
import type { ClockConfig, ClockState } from '../types'

export interface ApplyElapsedResult {
  state: ClockState
  timedOut: boolean
}

/**
 * Estado inicial del reloj de un color al arrancar la partida, derivado de la config. Si
 * `mainTimeMs === 0`, arranca directo en byoyomi (partida "byoyomi desde la primera jugada").
 */
export function initialClockState(config: ClockConfig): ClockState {
  return {
    mainTimeRemainingMs: config.mainTimeMs,
    byoyomiPeriodsRemaining: config.byoyomiPeriods,
    inByoyomi: config.mainTimeMs <= 0,
  }
}

/**
 * Aplica `elapsedMs` transcurridos jugando UNA jugada al reloj de un color. No muta `state`:
 * devuelve el estado siguiente. `timedOut: true` si se consumieron más períodos de byoyomi de los
 * que quedaban (agotó el reloj) — o si no hay byoyomi configurado y el tiempo principal ya se agotó.
 */
export function applyElapsed(state: ClockState, config: ClockConfig, elapsedMs: number): ApplyElapsedResult {
  if (!state.inByoyomi) {
    const remaining = state.mainTimeRemainingMs - elapsedMs
    if (remaining > 0) {
      return { state: { ...state, mainTimeRemainingMs: remaining }, timedOut: false }
    }
    // Tiempo principal agotado en esta jugada: el excedente (-remaining) se resuelve como tiempo
    // YA transcurrido en byoyomi — arranca en él con lo que sobró de exceso.
    return applyElapsed(
      { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: state.byoyomiPeriodsRemaining, inByoyomi: true },
      config,
      -remaining,
    )
  }

  if (config.byoyomiPeriods === 0 || config.byoyomiPeriodMs <= 0) {
    // Sin byoyomi configurado ("solo tiempo principal"): cualquier tiempo en este estado es tiempo
    // de más → derrota inmediata por tiempo.
    return { state, timedOut: true }
  }

  const periodsConsumed = Math.floor(elapsedMs / config.byoyomiPeriodMs)
  if (periodsConsumed >= state.byoyomiPeriodsRemaining) {
    return { state: { ...state, byoyomiPeriodsRemaining: 0 }, timedOut: true }
  }
  return {
    state: {
      mainTimeRemainingMs: 0,
      byoyomiPeriodsRemaining: state.byoyomiPeriodsRemaining - periodsConsumed,
      inByoyomi: true,
    },
    timedOut: false,
  }
}
```

- [ ] **Step 3: Escribir `packages/engine/tests/clock.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { applyElapsed, initialClockState } from '../src/clock/clock'
import type { ClockConfig, ClockState } from '../src/types'

const CONFIG: ClockConfig = { mainTimeMs: 60_000, byoyomiPeriods: 3, byoyomiPeriodMs: 10_000 }

describe('initialClockState', () => {
  it('con tiempo principal > 0, arranca fuera de byoyomi', () => {
    expect(initialClockState(CONFIG)).toEqual({
      mainTimeRemainingMs: 60_000,
      byoyomiPeriodsRemaining: 3,
      inByoyomi: false,
    })
  })

  it('con mainTimeMs=0, arranca directo en byoyomi', () => {
    const config: ClockConfig = { mainTimeMs: 0, byoyomiPeriods: 3, byoyomiPeriodMs: 10_000 }
    expect(initialClockState(config)).toEqual({
      mainTimeRemainingMs: 0,
      byoyomiPeriodsRemaining: 3,
      inByoyomi: true,
    })
  })
})

describe('applyElapsed — tiempo principal', () => {
  it('descuenta del pozo principal si no se agota', () => {
    const state: ClockState = { mainTimeRemainingMs: 60_000, byoyomiPeriodsRemaining: 3, inByoyomi: false }
    const { state: next, timedOut } = applyElapsed(state, CONFIG, 20_000)
    expect(timedOut).toBe(false)
    expect(next).toEqual({ mainTimeRemainingMs: 40_000, byoyomiPeriodsRemaining: 3, inByoyomi: false })
  })

  it('al agotarse exactamente, entra en byoyomi sin consumir período', () => {
    const state: ClockState = { mainTimeRemainingMs: 10_000, byoyomiPeriodsRemaining: 3, inByoyomi: false }
    const { state: next, timedOut } = applyElapsed(state, CONFIG, 10_000)
    expect(timedOut).toBe(false)
    expect(next).toEqual({ mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true })
  })

  it('si el excedente ya excede un período completo de byoyomi, lo consume', () => {
    const state: ClockState = { mainTimeRemainingMs: 10_000, byoyomiPeriodsRemaining: 3, inByoyomi: false }
    // 10s de tiempo principal + 15s de más → 15s "usados" en byoyomi → 1 período de 10s consumido.
    const { state: next, timedOut } = applyElapsed(state, CONFIG, 25_000)
    expect(timedOut).toBe(false)
    expect(next).toEqual({ mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 2, inByoyomi: true })
  })
})

describe('applyElapsed — byoyomi', () => {
  const IN_BYOYOMI: ClockState = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true }

  it('jugar dentro del período lo recicla completo (no consume ninguno)', () => {
    const { state: next, timedOut } = applyElapsed(IN_BYOYOMI, CONFIG, 7_000)
    expect(timedOut).toBe(false)
    expect(next).toEqual({ mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true })
  })

  it('exceder el período consume exactamente uno', () => {
    const { state: next, timedOut } = applyElapsed(IN_BYOYOMI, CONFIG, 15_000)
    expect(timedOut).toBe(false)
    expect(next.byoyomiPeriodsRemaining).toBe(2)
  })

  it('exceder por más de un período consume varios (regla general, no un caso especial)', () => {
    const { state: next, timedOut } = applyElapsed(IN_BYOYOMI, CONFIG, 25_000) // 2 períodos de 10s
    expect(timedOut).toBe(false)
    expect(next.byoyomiPeriodsRemaining).toBe(1)
  })

  it('consumir más períodos de los que quedan → timedOut', () => {
    const { timedOut } = applyElapsed(IN_BYOYOMI, CONFIG, 999_000)
    expect(timedOut).toBe(true)
  })

  it('perder el último período → timedOut', () => {
    const lastPeriod: ClockState = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 1, inByoyomi: true }
    const { timedOut } = applyElapsed(lastPeriod, CONFIG, 15_000)
    expect(timedOut).toBe(true)
  })

  it('sin byoyomi configurado, cualquier tiempo en byoyomi es timeout', () => {
    const noByoyomi: ClockConfig = { mainTimeMs: 60_000, byoyomiPeriods: 0, byoyomiPeriodMs: 0 }
    const state: ClockState = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 0, inByoyomi: true }
    expect(applyElapsed(state, noByoyomi, 1).timedOut).toBe(true)
  })
})
```

- [ ] **Step 4: Correr los tests nuevos**

Run: `npm test -w @tengen/engine -- clock.test.ts`
Expected: 10 tests passing.

- [ ] **Step 5: Exportar `applyElapsed`/`initialClockState` desde `index.ts`**

En `packages/engine/src/index.ts`, agregar una línea (el resto del archivo queda igual):

```ts
export { applyElapsed, initialClockState } from './clock/clock'
```

- [ ] **Step 6: Typecheck + build del paquete**

Run: `npx -w @tengen/engine tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/types.ts packages/engine/src/clock/clock.ts packages/engine/tests/clock.test.ts packages/engine/src/index.ts
git commit -m "feat(engine): módulo puro de reloj (ClockConfig/ClockState/applyElapsed)"
```

---

### Task 2: Política de gestión de tiempo de la IA (`timeManagementPolicy.ts`)

**Files:**
- Create: `packages/engine/src/search/timeManagementPolicy.ts`
- Create: `packages/engine/tests/timeManagementPolicy.test.ts`

**Interfaces:**
- Consumes: `ClockConfig`, `ClockState` (Task 1, `../types`).
- Produces: `computeBaseBudgetMs(config: ClockConfig, state: ClockState): number`, `timeManagementPolicy(input: TimeManagementInput): TimeManagementDecision` (con `TimeManagementInput`/`TimeManagementDecision` exportados). Task 3 consume ambas.

- [ ] **Step 1: Crear `packages/engine/src/search/timeManagementPolicy.ts`**

```ts
// Política de gestión de tiempo de la IA bajo reloj (Opción B del brainstorm: gestión adaptativa —
// corta antes por convergencia, extiende una vez en posiciones difíciles). Función PURA — nunca lee
// el reloj real (ni Date.now() ni performance.now()): recibe datos ya calculados y devuelve una
// decisión. Esto es DELIBERADO (spec 2026-07-16-reloj-partida-design.md §Determinismo y testing):
// separa "decidir" (determinista, testeable con fixtures escritos a mano) de "leer el reloj" (no
// determinista entre máquinas). NO agregar ninguna lectura de reloj real acá — el lector se inyecta
// en el caller (packages/engine/src/engine.ts), mismo patrón que `evaluatorFactory` en `LocalEngine`.
import type { ClockConfig, ClockState } from '../types'

/** Jugadas restantes asumidas para repartir el tiempo principal — constante FIJA y GLOBAL, no varía
 *  por tamaño de tablero ni por fase de la partida (v1, punto de partida no definitivo — ver spec
 *  §Fuera de alcance). Se autocorrige porque `mainTimeRemainingMs` decrece con el juego. */
const MOVES_LEFT_ESTIMATE = 40
const MIN_BUDGET_MS = 1000
/** Margen de seguridad en byoyomi: no confiar en que un chunk termine justo en el límite del período. */
const BYOYOMI_SAFETY_FACTOR = 0.85
/** ±2%: cuánto puede variar la participación de visitas de la jugada top entre 2 chunks para
 *  considerarla "convergida". */
const CONVERGENCE_VISIT_SHARE_DELTA = 0.02
/** No cortar por convergencia antes de usar al menos 25% del presupuesto — evita cortes prematuros
 *  con muy poca info. */
const CONVERGENCE_MIN_BUDGET_FRACTION = 0.25
/** Diferencia de winrate (escala 0-1) entre las 2 mejores jugadas por debajo de la cual se
 *  considera "posición difícil" y amerita extender el presupuesto. */
const VALUE_GAP_EPSILON = 0.05
const EXTENSION_MULTIPLIER = 1.5

/** Presupuesto base (ms) para la jugada actual, antes de convergencia/extensión. */
export function computeBaseBudgetMs(config: ClockConfig, state: ClockState): number {
  if (state.inByoyomi) return config.byoyomiPeriodMs * BYOYOMI_SAFETY_FACTOR
  return Math.max(state.mainTimeRemainingMs / MOVES_LEFT_ESTIMATE, MIN_BUDGET_MS)
}

export interface TimeManagementInput {
  /** Tiempo transcurrido desde que arrancó la búsqueda de ESTA jugada. */
  elapsedMsSoFar: number
  /** Presupuesto vigente (puede haber sido extendido una vez — ver `alreadyExtended`). */
  budgetMs: number
  /** Participación (0-1) de la jugada con más visitas, un valor por chunk transcurrido, en orden. */
  visitShareHistory: number[]
  /** Diferencia de winrate entre las 2 mejores jugadas en el chunk actual (1 si hay <2 candidatas). */
  valueGap: number
  /** true si esta jugada ya recibió una extensión (nunca se concede una segunda). */
  alreadyExtended: boolean
}

export type TimeManagementDecision = 'stop' | 'continue' | { extendTo: number }

export function timeManagementPolicy(input: TimeManagementInput): TimeManagementDecision {
  const { elapsedMsSoFar, budgetMs, visitShareHistory, valueGap, alreadyExtended } = input

  if (elapsedMsSoFar < budgetMs) {
    const enoughHistory = visitShareHistory.length >= 2
    const usedEnoughBudget = elapsedMsSoFar >= budgetMs * CONVERGENCE_MIN_BUDGET_FRACTION
    if (enoughHistory && usedEnoughBudget) {
      const last = visitShareHistory[visitShareHistory.length - 1]!
      const prev = visitShareHistory[visitShareHistory.length - 2]!
      if (Math.abs(last - prev) <= CONVERGENCE_VISIT_SHARE_DELTA) return 'stop'
    }
    return 'continue'
  }

  if (!alreadyExtended && valueGap < VALUE_GAP_EPSILON) {
    return { extendTo: budgetMs * EXTENSION_MULTIPLIER }
  }
  return 'stop'
}
```

- [ ] **Step 2: Escribir `packages/engine/tests/timeManagementPolicy.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { computeBaseBudgetMs, timeManagementPolicy } from '../src/search/timeManagementPolicy'
import type { ClockConfig, ClockState } from '../src/types'

const CONFIG: ClockConfig = { mainTimeMs: 40_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }

describe('computeBaseBudgetMs', () => {
  it('en tiempo principal: remaining / 40', () => {
    const state: ClockState = { mainTimeRemainingMs: 40_000, byoyomiPeriodsRemaining: 5, inByoyomi: false }
    expect(computeBaseBudgetMs(CONFIG, state)).toBe(1000) // 40000/40
  })

  it('respeta el piso mínimo de 1000ms', () => {
    const state: ClockState = { mainTimeRemainingMs: 4_000, byoyomiPeriodsRemaining: 5, inByoyomi: false }
    expect(computeBaseBudgetMs(CONFIG, state)).toBe(1000) // 4000/40=100, pero el piso es 1000
  })

  it('en byoyomi: período × 0.85', () => {
    const state: ClockState = { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 5, inByoyomi: true }
    expect(computeBaseBudgetMs(CONFIG, state)).toBe(25_500) // 30000*0.85
  })
})

describe('timeManagementPolicy — dentro del presupuesto', () => {
  it('continúa si aún no llegó al presupuesto y no hay suficiente historial', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 500,
      budgetMs: 1000,
      visitShareHistory: [0.9],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('continue')
  })

  it('corta por convergencia: participación estable ±2% tras usar ≥25% del presupuesto', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 300,
      budgetMs: 1000,
      visitShareHistory: [0.8, 0.81],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('stop')
  })

  it('NO corta por convergencia si el presupuesto usado es menor al 25%', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 100,
      budgetMs: 1000,
      visitShareHistory: [0.8, 0.81],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('continue')
  })

  it('NO corta por convergencia si la participación varió más de ±2%', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 300,
      budgetMs: 1000,
      visitShareHistory: [0.7, 0.85],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('continue')
  })
})

describe('timeManagementPolicy — al agotar el presupuesto', () => {
  it('extiende ×1.5 si las 2 mejores jugadas están muy cerca en value', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 1000,
      budgetMs: 1000,
      visitShareHistory: [0.6, 0.6],
      valueGap: 0.01,
      alreadyExtended: false,
    })
    expect(decision).toEqual({ extendTo: 1500 })
  })

  it('corta si el gap ya es grande (posición no reñida)', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 1000,
      budgetMs: 1000,
      visitShareHistory: [0.9, 0.9],
      valueGap: 0.5,
      alreadyExtended: false,
    })
    expect(decision).toBe('stop')
  })

  it('nunca concede una segunda extensión', () => {
    const decision = timeManagementPolicy({
      elapsedMsSoFar: 1500,
      budgetMs: 1500,
      visitShareHistory: [0.6, 0.6],
      valueGap: 0.01,
      alreadyExtended: true,
    })
    expect(decision).toBe('stop')
  })
})
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -w @tengen/engine -- timeManagementPolicy.test.ts`
Expected: 9 tests passing.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/search/timeManagementPolicy.ts packages/engine/tests/timeManagementPolicy.test.ts
git commit -m "feat(engine): política pura de gestión de tiempo de la IA bajo reloj"
```

---

### Task 3: `LocalEngine.genMove` con reloj opcional (chunking + política)

**Files:**
- Modify: `packages/engine/src/engine.ts`
- Modify: `packages/engine/tests/engine.test.ts`

**Interfaces:**
- Consumes: `ClockConfig`/`ClockState` (Task 1), `computeBaseBudgetMs`/`timeManagementPolicy` (Task 2).
- Produces: `LocalEngine.genMove(pos, { level, clock? })` — `clock` opcional; `LocalEngine`'s constructor acepta `deps.now?: () => number` (inyectable, mismo patrón que `evaluatorFactory`).

- [ ] **Step 1: Constructor — agregar `now` inyectable**

En `packages/engine/src/engine.ts`, reemplazar:

```ts
export class LocalEngine implements Engine {
  private readonly evaluatorFactory: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>
  private readonly rng: () => number
  private evaluator: NNEvaluator | undefined
  private boardSize: BoardSize | undefined
  private activeToken: CancelToken | undefined

  constructor(deps?: {
    evaluatorFactory?: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>
    seed?: number
  }) {
    this.evaluatorFactory = deps?.evaluatorFactory ?? defaultEvaluatorFactory
    // RNG persistente: avanza entre `genMove` humanos → una partida reproducible por `seed`.
    this.rng = mulberry32(deps?.seed ?? 1)
  }
```

por:

```ts
export class LocalEngine implements Engine {
  private readonly evaluatorFactory: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>
  private readonly rng: () => number
  /** Lector de reloj inyectable (Fase reloj, 2026-07-16) — mismo patrón que `evaluatorFactory`: en
   *  producción `performance.now()`, en tests un contador falso determinista. NUNCA leído desde
   *  `timeManagementPolicy` (función pura) — solo desde `runWithClock`, más abajo. */
  private readonly now: () => number
  private evaluator: NNEvaluator | undefined
  private boardSize: BoardSize | undefined
  private activeToken: CancelToken | undefined

  constructor(deps?: {
    evaluatorFactory?: (net: NetworkId, boardSize: BoardSize) => Promise<NNEvaluator>
    seed?: number
    now?: () => number
  }) {
    this.evaluatorFactory = deps?.evaluatorFactory ?? defaultEvaluatorFactory
    // RNG persistente: avanza entre `genMove` humanos → una partida reproducible por `seed`.
    this.rng = mulberry32(deps?.seed ?? 1)
    this.now = deps?.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  }
```

- [ ] **Step 2: `genMove` — ramificar cuando hay reloj**

Reemplazar:

```ts
  async genMove(pos: Position, opts: { level: RankLevel }): Promise<Move> {
    const token: CancelToken = { cancelled: false }
    this.activeToken = token
    const evaluator = this.requireInit(pos)

    if (opts.level.kind === 'kata') {
      const state = buildGameState(pos)
      const search = await createSearch({ evaluator, state })
      await search.run({
        visits: opts.level.visits,
        maxTimeMs: 600_000,
        batchSize: 8,
        shouldAbort: () => token.cancelled,
      })
      const a = search.getAnalysis({ topK: 1, analysisPvLen: 0 })
      const best = a.moves.find((m) => m.order === 0)
      if (best === undefined) return { color: state.currentPlayer, vertex: 'pass' }
      return { color: state.currentPlayer, vertex: best.x < 0 ? 'pass' : { x: best.x, y: best.y } }
    }
```

por:

```ts
  async genMove(
    pos: Position,
    opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } },
  ): Promise<Move> {
    const token: CancelToken = { cancelled: false }
    this.activeToken = token
    const evaluator = this.requireInit(pos)

    if (opts.level.kind === 'kata') {
      const state = buildGameState(pos)
      const search = await createSearch({ evaluator, state })
      if (opts.clock === undefined) {
        // Sin reloj: comportamiento byte-idéntico al de siempre.
        await search.run({
          visits: opts.level.visits,
          maxTimeMs: 600_000,
          batchSize: 8,
          shouldAbort: () => token.cancelled,
        })
      } else {
        await this.runWithClock(search, opts.level.visits, opts.clock, () => token.cancelled)
      }
      const a = search.getAnalysis({ topK: 1, analysisPvLen: 0 })
      const best = a.moves.find((m) => m.order === 0)
      if (best === undefined) return { color: state.currentPlayer, vertex: 'pass' }
      return { color: state.currentPlayer, vertex: best.x < 0 ? 'pass' : { x: best.x, y: best.y } }
    }
```

(El resto del método — rama `human` — queda sin cambios.)

- [ ] **Step 3: Agregar el método privado `runWithClock`**

Insertar, DESPUÉS del cierre del método `genMove` (antes de `// onError (4º parámetro...` / el método `analyze`):

```ts
  /**
   * Búsqueda kata con presupuesto de tiempo derivado del reloj (Opción B, spec
   * 2026-07-16-reloj-partida-design.md). Corre en CHUNKS (mismo patrón que `analyze()`, arriba),
   * consultando `timeManagementPolicy` tras cada uno: puede cortar antes (convergencia), seguir, o
   * extender el presupuesto UNA vez (posición difícil). El `maxTimeMs` de CADA chunk ya refleja el
   * tiempo restante del presupuesto vigente (no solo el corte entre-chunks): así el techo interno
   * que `MctsSearch.run` ya calcula (`analyzeMcts.ts:1750`) protege incluso DENTRO de un chunk ante
   * una inferencia lenta, no solo entre chunks.
   *
   * CHUNK=32 (mismo valor que `analyze()`): punto de partida razonable, no una constante sagrada —
   * si la verificación manual (Task 13 del plan) muestra cortes poco responsivos bajo WebGPU real,
   * ajustar a un valor menor es un cambio de una línea, sin tocar el resto de este método.
   */
  private async runWithClock(
    search: Awaited<ReturnType<typeof createSearch>>,
    visitsCap: number,
    clock: { config: ClockConfig; state: ClockState },
    shouldAbort: () => boolean,
  ): Promise<void> {
    const CHUNK = 32
    let budgetMs = computeBaseBudgetMs(clock.config, clock.state)
    let extended = false
    let target = 0
    const visitShareHistory: number[] = []
    const startedAt = this.now()

    while (target < visitsCap && !shouldAbort()) {
      const elapsedBeforeChunk = this.now() - startedAt
      target = Math.min(target + CHUNK, visitsCap)
      await search.run({
        visits: target,
        maxTimeMs: Math.max(budgetMs - elapsedBeforeChunk, 50),
        batchSize: 8,
        shouldAbort,
      })
      if (shouldAbort()) return

      const a = search.getAnalysis({ topK: 2, analysisPvLen: 0 })
      const top = a.moves.find((m) => m.order === 0)
      const second = a.moves.find((m) => m.order === 1)
      const totalVisits = a.moves.reduce((sum, m) => sum + m.visits, 0)
      visitShareHistory.push(top && totalVisits > 0 ? top.visits / totalVisits : 0)
      const valueGap = top && second ? Math.abs(top.winRate - second.winRate) : 1

      const decision = timeManagementPolicy({
        elapsedMsSoFar: this.now() - startedAt,
        budgetMs,
        visitShareHistory,
        valueGap,
        alreadyExtended: extended,
      })
      if (decision === 'stop') return
      if (decision !== 'continue') {
        extended = true
        budgetMs = decision.extendTo
      }
    }
  }
```

- [ ] **Step 4: Imports**

En la cabecera de `packages/engine/src/engine.ts`, reemplazar:

```ts
import type {
  Analysis,
  BoardSize,
  CancelFn,
  Engine,
  Move,
  NetworkId,
  Position,
  RankLevel,
  Vertex,
} from './types'
```

por:

```ts
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
  Vertex,
} from './types'
import { computeBaseBudgetMs, timeManagementPolicy } from './search/timeManagementPolicy'
```

- [ ] **Step 5: Extender `packages/engine/tests/engine.test.ts`**

Agregar, dentro de `describe('LocalEngine', ...)`, dos tests nuevos:

```ts
  it('genMove con reloj: sigue devolviendo una jugada legal', async () => {
    const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N) })
    await eng.init({ network: 'b18', boardSize: 9 })
    const clock = {
      config: { mainTimeMs: 60_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 },
      state: { mainTimeRemainingMs: 60_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
    }
    const move = await eng.genMove(
      { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] },
      { level: { kind: 'kata', visits: 100 }, clock },
    )
    expect(move.color).toBe('black')
  })

  it('genMove con reloj chico: corta MUY antes del techo de visitas (el tiempo manda, no las visitas)', async () => {
    let nowCalls = 0
    let fakeNow = 0
    const now = () => {
      nowCalls++
      fakeNow += 50
      return fakeNow
    }
    const eng = new LocalEngine({ evaluatorFactory: async (_n, N) => makeMock(N), now })
    await eng.init({ network: 'b18', boardSize: 9 })
    const clock = {
      // base budget = 4000/40 = 100ms; con 50ms "reales" por consulta de `now`, el presupuesto (sin
      // convergencia/extensión) se agota en pocas vueltas.
      config: { mainTimeMs: 4000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 },
      state: { mainTimeRemainingMs: 4000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
    }
    await eng.genMove(
      { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] },
      { level: { kind: 'kata', visits: 100_000 }, clock },
    )
    // Agotar 100000 visitas a CHUNK=32 tomaría ~3125 vueltas (~6250+ llamadas a `now`). Si el corte
    // por tiempo funciona, esto termina en un puñado de vueltas.
    expect(nowCalls).toBeLessThan(50)
  })
```

- [ ] **Step 6: Correr los tests**

Run: `npm test -w @tengen/engine -- engine.test.ts`
Expected: todos los tests existentes + los 2 nuevos, en verde.

- [ ] **Step 7: Typecheck**

Run: `npx -w @tengen/engine tsc --noEmit`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add packages/engine/src/engine.ts packages/engine/tests/engine.test.ts
git commit -m "feat(engine): LocalEngine.genMove respeta un reloj opcional (chunking + política adaptativa)"
```

---

### Task 4: Worker protocol/handler/client — pasar el reloj a través del boundary

**Files:**
- Modify: `packages/engine/src/worker/protocol.ts`
- Modify: `packages/engine/src/worker/handler.ts`
- Modify: `packages/engine/src/worker/client.ts`
- Modify: `packages/engine/tests/worker.test.ts`

**Interfaces:**
- Consumes: `ClockConfig`/`ClockState` (Task 1), `Engine.genMove` con `clock?` (Task 3).
- Produces: `WorkerEngine.genMove(pos, { level, clock? })` — misma firma pública que `Engine.genMove`, el reloj viaja por `postMessage` (structured-clone, sin serialización nueva).

- [ ] **Step 1: `protocol.ts` — el mensaje `genMove` lleva `clock` opcional**

Reemplazar:

```ts
import type { Analysis, BoardSize, Move, NetworkId, Position, RankLevel } from '../types'
```

por:

```ts
import type { Analysis, BoardSize, ClockConfig, ClockState, Move, NetworkId, Position, RankLevel } from '../types'
```

Reemplazar:

```ts
export type WorkerRequest =
  | { type: 'init'; id: number; network: NetworkId; boardSize: BoardSize }
  | { type: 'genMove'; id: number; pos: Position; level: RankLevel }
  | { type: 'analyze'; id: number; pos: Position; visits: number }
  | { type: 'stop'; id: number; targetId: number }
  | { type: 'stopAll'; id: number }
```

por:

```ts
export type WorkerRequest =
  | { type: 'init'; id: number; network: NetworkId; boardSize: BoardSize }
  | { type: 'genMove'; id: number; pos: Position; level: RankLevel; clock?: { config: ClockConfig; state: ClockState } }
  | { type: 'analyze'; id: number; pos: Position; visits: number }
  | { type: 'stop'; id: number; targetId: number }
  | { type: 'stopAll'; id: number }
```

- [ ] **Step 2: `handler.ts` — `handleGenMove` pasa `clock` al engine**

Reemplazar:

```ts
  const handleGenMove = async (req: Extract<WorkerRequest, { type: 'genMove' }>): Promise<void> => {
    try {
      const move = await engine.genMove(req.pos, { level: req.level })
      post({ type: 'move', id: req.id, move })
    } catch (e) {
      post({ type: 'error', id: req.id, message: errorMessage(e) })
    }
  }
```

por:

```ts
  const handleGenMove = async (req: Extract<WorkerRequest, { type: 'genMove' }>): Promise<void> => {
    try {
      const move = await engine.genMove(req.pos, { level: req.level, clock: req.clock })
      post({ type: 'move', id: req.id, move })
    } catch (e) {
      post({ type: 'error', id: req.id, message: errorMessage(e) })
    }
  }
```

- [ ] **Step 3: `client.ts` — `WorkerEngine.genMove` acepta y postea `clock`**

Reemplazar:

```ts
import type { Analysis, BoardSize, CancelFn, Engine, Move, NetworkId, Position, RankLevel } from '../types'
```

por:

```ts
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
} from '../types'
```

Reemplazar:

```ts
  genMove(pos: Position, opts: { level: RankLevel }): Promise<Move> {
    const id = this.nextId++
    return new Promise<Move>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.post({ type: 'genMove', id, pos, level: opts.level })
    })
  }
```

por:

```ts
  genMove(pos: Position, opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } }): Promise<Move> {
    const id = this.nextId++
    return new Promise<Move>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.post({ type: 'genMove', id, pos, level: opts.level, clock: opts.clock })
    })
  }
```

- [ ] **Step 4: Agregar un test de round-trip con reloj a `packages/engine/tests/worker.test.ts`**

Dentro de `describe('WorkerEngine round-trip (canal mock, sin Worker real)', ...)`, agregar:

```ts
  it('genMove con reloj: el round-trip no rompe y devuelve una jugada legal', async () => {
    const we = connect(async (_n, N) => makeMock(N))
    await we.init({ network: 'b18', boardSize: 9 })
    const clock = {
      config: { mainTimeMs: 60_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 },
      state: { mainTimeRemainingMs: 60_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
    }
    const move = await we.genMove(EMPTY_9, { level: { kind: 'kata', visits: 100 }, clock })
    expect(move.color).toBe('black')
  })
```

- [ ] **Step 5: Correr los tests**

Run: `npm test -w @tengen/engine -- worker.test.ts`
Expected: todos los tests existentes + el nuevo, en verde.

- [ ] **Step 6: Typecheck + suite completa del paquete**

Run: `npx -w @tengen/engine tsc --noEmit && npm test -w @tengen/engine`
Expected: sin errores; todos los tests en verde.

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/worker/protocol.ts packages/engine/src/worker/handler.ts packages/engine/src/worker/client.ts packages/engine/tests/worker.test.ts
git commit -m "feat(engine): el Worker pasa el reloj opcional a través de genMove"
```

---

### Task 5: `GameConfig.clock` + validación

**Files:**
- Modify: `apps/web/src/game/gameConfig.ts`
- Modify: `apps/web/tests/gameConfig.test.ts`

**Interfaces:**
- Consumes: `ClockConfig` (`@tengen/engine`, Task 1).
- Produces: `GameConfig.clock?: ClockConfig`; `validateConfig` valida `clock` si está presente (lanza con mensaje claro; nunca normaliza silenciosamente valores de reloj inválidos, a diferencia del clamp de visits).

- [ ] **Step 1: Agregar el campo a `GameConfig`**

Reemplazar:

```ts
import type { BoardSize, NetworkId, RankLevel, Rules } from '@tengen/engine'

export interface GameConfig {
  boardSize: BoardSize
  komi: number
  rules: Rules
  /** 0 = sin handicap; 2..9 = piedras (solo 19×19). 1 se normaliza a 0 (solo komi, sin piedra). */
  handicap: number
  opponent: RankLevel
}
```

por:

```ts
import type { BoardSize, ClockConfig, NetworkId, RankLevel, Rules } from '@tengen/engine'

export interface GameConfig {
  boardSize: BoardSize
  komi: number
  rules: Rules
  /** 0 = sin handicap; 2..9 = piedras (solo 19×19). 1 se normaliza a 0 (solo komi, sin piedra). */
  handicap: number
  opponent: RankLevel
  /** Reloj de partida (tiempo principal + byoyomi japonés), opcional — ausente = "sin reloj" (el
   *  comportamiento de siempre). Ver spec 2026-07-16-reloj-partida-design.md. */
  clock?: ClockConfig
}
```

- [ ] **Step 2: Validar `clock` en `validateConfig`**

Reemplazar:

```ts
  // Task 13a: el motor asume visits >= 1; clampamos en vez de lanzar (normalización silenciosa).
  const opponent: RankLevel =
    c.opponent.kind === 'kata' && c.opponent.visits < 1
      ? { kind: 'kata', visits: 1 }
      : c.opponent

  return { boardSize: c.boardSize, komi: c.komi, rules: c.rules, handicap, opponent }
}
```

por:

```ts
  // Task 13a: el motor asume visits >= 1; clampamos en vez de lanzar (normalización silenciosa).
  const opponent: RankLevel =
    c.opponent.kind === 'kata' && c.opponent.visits < 1
      ? { kind: 'kata', visits: 1 }
      : c.opponent

  // Reloj (Fase reloj, 2026-07-16): a diferencia de visits, un reloj mal configurado NO se
  // normaliza en silencio — es una decisión explícita del usuario en el formulario, un valor
  // inválido ahí es un bug de UI, no algo a "arreglar" silenciosamente.
  if (c.clock !== undefined) {
    const { mainTimeMs, byoyomiPeriods, byoyomiPeriodMs } = c.clock
    if (!Number.isFinite(mainTimeMs) || mainTimeMs < 0) {
      throw new Error(`clock.mainTimeMs debe ser finito y >= 0 (recibido: ${mainTimeMs})`)
    }
    if (!Number.isInteger(byoyomiPeriods) || byoyomiPeriods < 0) {
      throw new Error(`clock.byoyomiPeriods debe ser un entero >= 0 (recibido: ${byoyomiPeriods})`)
    }
    if (!Number.isFinite(byoyomiPeriodMs) || byoyomiPeriodMs < 0) {
      throw new Error(`clock.byoyomiPeriodMs debe ser finito y >= 0 (recibido: ${byoyomiPeriodMs})`)
    }
    if (mainTimeMs === 0 && byoyomiPeriods === 0) {
      throw new Error('clock: mainTimeMs=0 y byoyomiPeriods=0 juntos perderían la partida al instante')
    }
  }

  return {
    boardSize: c.boardSize,
    komi: c.komi,
    rules: c.rules,
    handicap,
    opponent,
    ...(c.clock !== undefined ? { clock: c.clock } : {}),
  }
}
```

- [ ] **Step 3: Extender `apps/web/tests/gameConfig.test.ts`**

Agregar, al final del archivo:

```ts
describe('validateConfig — reloj (opcional)', () => {
  it('sin clock, el resultado no incluye la clave', () => {
    const out = validateConfig(base())
    expect(out.clock).toBeUndefined()
  })

  it('clock válido se conserva tal cual', () => {
    const clock = { mainTimeMs: 600_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    const out = validateConfig(base({ clock }))
    expect(out.clock).toEqual(clock)
  })

  it('mainTimeMs negativo lanza', () => {
    expect(() =>
      validateConfig(base({ clock: { mainTimeMs: -1, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 } })),
    ).toThrow(/mainTimeMs/)
  })

  it('byoyomiPeriods no entero lanza', () => {
    expect(() =>
      validateConfig(base({ clock: { mainTimeMs: 600_000, byoyomiPeriods: 2.5, byoyomiPeriodMs: 30_000 } })),
    ).toThrow(/byoyomiPeriods/)
  })

  it('mainTimeMs=0 y byoyomiPeriods=0 juntos lanza (perdería al instante)', () => {
    expect(() =>
      validateConfig(base({ clock: { mainTimeMs: 0, byoyomiPeriods: 0, byoyomiPeriodMs: 0 } })),
    ).toThrow()
  })

  it('mainTimeMs=0 con byoyomi configurado es válido (byoyomi desde el arranque)', () => {
    const clock = { mainTimeMs: 0, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    expect(validateConfig(base({ clock })).clock).toEqual(clock)
  })

  it('byoyomiPeriods=0 con mainTimeMs>0 es válido (solo tiempo principal, sin red de seguridad)', () => {
    const clock = { mainTimeMs: 600_000, byoyomiPeriods: 0, byoyomiPeriodMs: 0 }
    expect(validateConfig(base({ clock })).clock).toEqual(clock)
  })
})
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -w @tengen/web -- gameConfig.test.ts`
Expected: todos los tests existentes + los 7 nuevos, en verde.

- [ ] **Step 5: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/game/gameConfig.ts apps/web/tests/gameConfig.test.ts
git commit -m "feat(web): GameConfig.clock opcional + validación"
```

---

### Task 6: `GameTreeMeta.clock` + inicialización en `fromConfig`

**Files:**
- Modify: `apps/web/src/game/gameTree.ts`
- Modify: `apps/web/tests/gameTree.test.ts`

**Interfaces:**
- Consumes: `ClockConfig`/`ClockState`/`initialClockState` (`@tengen/engine`, Task 1), `GameConfig.clock` (Task 5).
- Produces: `GameTreeMeta.clock?: { config: ClockConfig; state: { black: ClockState; white: ClockState } }` — mutable en el lugar (mismo patrón que `meta.result`), consumido por Task 7 (codec SGF) y Task 12 (`PlayView.tsx`).

- [ ] **Step 1: Agregar `clock` a `GameTreeMeta`**

Reemplazar:

```ts
import type { BoardSize, Move, Position, Rules, StoneColor, Vertex } from '@tengen/engine'
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
}
```

por:

```ts
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
```

- [ ] **Step 2: `fromConfig` inicializa el reloj si la config lo trae**

Reemplazar:

```ts
  /** Crea un árbol a partir de una GameConfig (descarta `opponent`, que no pertenece al árbol). */
  static fromConfig(config: GameConfig): GameTree {
    return new GameTree({
      boardSize: config.boardSize,
      komi: config.komi,
      rules: config.rules,
      handicap: config.handicap,
    })
  }
```

por:

```ts
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
```

- [ ] **Step 3: Extender `apps/web/tests/gameTree.test.ts`**

Agregar, al final del archivo:

```ts
describe('GameTree — fromConfig con reloj', () => {
  it('sin clock en la config, meta.clock queda ausente', () => {
    const t = GameTree.fromConfig({
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      opponent: { kind: 'kata', visits: 100 },
    })
    expect(t.meta.clock).toBeUndefined()
  })

  it('con clock, inicializa el mismo estado para ambos colores', () => {
    const clock = { mainTimeMs: 600_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    const t = GameTree.fromConfig({
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      opponent: { kind: 'kata', visits: 100 },
      clock,
    })
    expect(t.meta.clock).toEqual({
      config: clock,
      state: {
        black: { mainTimeRemainingMs: 600_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
        white: { mainTimeRemainingMs: 600_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
      },
    })
  })

  it('con mainTimeMs=0 (byoyomi desde el arranque), inicializa inByoyomi=true', () => {
    const clock = { mainTimeMs: 0, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    const t = GameTree.fromConfig({
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      opponent: { kind: 'kata', visits: 100 },
      clock,
    })
    expect(t.meta.clock?.state.black.inByoyomi).toBe(true)
    expect(t.meta.clock?.state.white.inByoyomi).toBe(true)
  })
})
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -w @tengen/web -- gameTree.test.ts`
Expected: todos los tests existentes (sin cambios en su comportamiento — `meta.clock` ausente no afecta los `toEqual` existentes) + los 3 nuevos, en verde.

- [ ] **Step 5: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/game/gameTree.ts apps/web/tests/gameTree.test.ts
git commit -m "feat(web): GameTreeMeta.clock + inicialización en fromConfig"
```

---

### Task 7: Codec SGF del reloj (`sgfClockCodec.ts`)

**Files:**
- Create: `apps/web/src/game/sgfClockCodec.ts`
- Create: `apps/web/tests/sgfClockCodec.test.ts`

**Interfaces:**
- Consumes: `ClockConfig`/`ClockState` (`@tengen/engine`, Task 1).
- Produces: `encodeClockConfig`, `decodeClockConfig`, `encodeClockState`, `decodeClockState` — consumidos por Task 8 (`persistence.ts`).

- [ ] **Step 1: Crear `apps/web/src/game/sgfClockCodec.ts`**

```ts
// Convierte el reloj de una partida (config fija + estado vivo por color) a/desde propiedades
// SGF — puente entre `game/sgf.ts` (dominio puro, no sabe qué es un "reloj") y
// `GameTree.meta.clock` (game/gameTree.ts). Usa propiedades ESTÁNDAR de SGF (FF[4]) donde existen
// (TM, BL, WL, OB, OW); solo agrega dos propias (prefijo TG, mismo criterio que
// `analysis/sgfAnalysisCodec.ts`) para la config de byoyomi, que el estándar solo cubre como texto
// libre (OT) sin estructura parseable.
//
// La config (TM/TGBP/TGBT) va en la RAÍZ; el estado vivo (BL/WL/OB/OW) va en el nodo ACTUAL al
// momento de guardar — en Modo Jugar el cursor vivo siempre está en el tip de la partida (ver
// `GameTree.isAtLiveTip`), así que no hace falta reconstruir el reloj navegando variaciones (fuera
// de alcance, ver spec 2026-07-16-reloj-partida-design.md §Alcance).
import type { ClockConfig, ClockState } from '@tengen/engine'

const MAIN_TIME_PROP = 'TM'
const BYOYOMI_PERIODS_PROP = 'TGBP'
const BYOYOMI_PERIOD_SECONDS_PROP = 'TGBT'
const BLACK_TIME_LEFT_PROP = 'BL'
const WHITE_TIME_LEFT_PROP = 'WL'
const BLACK_PERIODS_LEFT_PROP = 'OB'
const WHITE_PERIODS_LEFT_PROP = 'OW'

/** Config de reloj (raíz) → propiedades SGF. */
export function encodeClockConfig(config: ClockConfig): Record<string, string[]> {
  return {
    [MAIN_TIME_PROP]: [String(Math.round(config.mainTimeMs / 1000))],
    [BYOYOMI_PERIODS_PROP]: [String(config.byoyomiPeriods)],
    [BYOYOMI_PERIOD_SECONDS_PROP]: [String(Math.round(config.byoyomiPeriodMs / 1000))],
  }
}

/** Propiedades SGF (de la raíz) → config de reloj. `null` si faltan o son inválidas (nunca lanza). */
export function decodeClockConfig(data: Record<string, string[]>): ClockConfig | null {
  const mainTimeSec = parseFloat(data[MAIN_TIME_PROP]?.[0] ?? '')
  const periods = parseInt(data[BYOYOMI_PERIODS_PROP]?.[0] ?? '', 10)
  const periodSec = parseFloat(data[BYOYOMI_PERIOD_SECONDS_PROP]?.[0] ?? '')
  if (!Number.isFinite(mainTimeSec) || !Number.isFinite(periods) || !Number.isFinite(periodSec)) return null
  if (mainTimeSec < 0 || periods < 0 || periodSec < 0) return null
  return { mainTimeMs: mainTimeSec * 1000, byoyomiPeriods: periods, byoyomiPeriodMs: periodSec * 1000 }
}

/** Estado vivo del reloj (nodo actual) → propiedades SGF. */
export function encodeClockState(state: { black: ClockState; white: ClockState }): Record<string, string[]> {
  return {
    [BLACK_TIME_LEFT_PROP]: [(state.black.mainTimeRemainingMs / 1000).toFixed(1)],
    [WHITE_TIME_LEFT_PROP]: [(state.white.mainTimeRemainingMs / 1000).toFixed(1)],
    [BLACK_PERIODS_LEFT_PROP]: [String(state.black.byoyomiPeriodsRemaining)],
    [WHITE_PERIODS_LEFT_PROP]: [String(state.white.byoyomiPeriodsRemaining)],
  }
}

/**
 * Propiedades SGF → estado vivo del reloj. `null` si faltan o son inválidas (nunca lanza).
 * `inByoyomi` se DERIVA (`mainTimeRemainingMs <= 0`) — no es una propiedad separada: una vez que el
 * tiempo principal llega a 0 siempre se está en byoyomi, no hay estado intermedio ambiguo.
 */
export function decodeClockState(data: Record<string, string[]>): { black: ClockState; white: ClockState } | null {
  const blackMainSec = parseFloat(data[BLACK_TIME_LEFT_PROP]?.[0] ?? '')
  const whiteMainSec = parseFloat(data[WHITE_TIME_LEFT_PROP]?.[0] ?? '')
  const blackPeriods = parseInt(data[BLACK_PERIODS_LEFT_PROP]?.[0] ?? '', 10)
  const whitePeriods = parseInt(data[WHITE_PERIODS_LEFT_PROP]?.[0] ?? '', 10)
  if (![blackMainSec, whiteMainSec, blackPeriods, whitePeriods].every((n) => Number.isFinite(n))) return null
  if (blackMainSec < 0 || whiteMainSec < 0 || blackPeriods < 0 || whitePeriods < 0) return null
  return {
    black: {
      mainTimeRemainingMs: blackMainSec * 1000,
      byoyomiPeriodsRemaining: blackPeriods,
      inByoyomi: blackMainSec <= 0,
    },
    white: {
      mainTimeRemainingMs: whiteMainSec * 1000,
      byoyomiPeriodsRemaining: whitePeriods,
      inByoyomi: whiteMainSec <= 0,
    },
  }
}
```

- [ ] **Step 2: Crear `apps/web/tests/sgfClockCodec.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { ClockConfig, ClockState } from '@tengen/engine'
import {
  decodeClockConfig,
  decodeClockState,
  encodeClockConfig,
  encodeClockState,
} from '../src/game/sgfClockCodec'

const CONFIG: ClockConfig = { mainTimeMs: 600_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
const STATE: { black: ClockState; white: ClockState } = {
  black: { mainTimeRemainingMs: 123_400, byoyomiPeriodsRemaining: 5, inByoyomi: false },
  white: { mainTimeRemainingMs: 0, byoyomiPeriodsRemaining: 3, inByoyomi: true },
}

describe('sgfClockCodec — round-trip', () => {
  it('config: encode→decode reconstruye exactamente', () => {
    expect(decodeClockConfig(encodeClockConfig(CONFIG))).toEqual(CONFIG)
  })

  it('estado: encode→decode reconstruye (inByoyomi derivado correctamente)', () => {
    expect(decodeClockState(encodeClockState(STATE))).toEqual(STATE)
  })
})

describe('sgfClockCodec — datos corruptos o incompletos → null, nunca lanza', () => {
  it('config sin TGBT → null', () => {
    expect(decodeClockConfig({ TM: ['600'], TGBP: ['5'] })).toBeNull()
  })

  it('estado sin OW → null', () => {
    expect(decodeClockState({ BL: ['10.0'], WL: ['5.0'], OB: ['3'] })).toBeNull()
  })

  it('config con valores negativos → null', () => {
    expect(decodeClockConfig({ TM: ['-5'], TGBP: ['5'], TGBT: ['30'] })).toBeNull()
  })

  it('estado con texto no numérico → null', () => {
    expect(decodeClockState({ BL: ['x'], WL: ['5.0'], OB: ['3'], OW: ['3'] })).toBeNull()
  })

  it('objeto vacío → null en ambos', () => {
    expect(decodeClockConfig({})).toBeNull()
    expect(decodeClockState({})).toBeNull()
  })
})
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -w @tengen/web -- sgfClockCodec.test.ts`
Expected: 7 tests passing.

- [ ] **Step 4: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/game/sgfClockCodec.ts apps/web/tests/sgfClockCodec.test.ts
git commit -m "feat(web): codec SGF del reloj (TM/BL/WL/OB/OW + TGBP/TGBT)"
```

---

### Task 8: Wiring de persistencia — `saveGame`/`loadGame` usan el codec

**Files:**
- Modify: `apps/web/src/game/persistence.ts`
- Modify: `apps/web/tests/persistence.test.ts`

**Interfaces:**
- Consumes: `encodeClockConfig`/`decodeClockConfig`/`encodeClockState`/`decodeClockState` (Task 7).
- Produces: `saveGame`/`loadGame` — **firmas públicas sin cambios** (el reloj vive en `tree.meta.clock`, ya disponible en el propio árbol — a diferencia del análisis, que necesitó un parámetro nuevo por venir de un store externo).

- [ ] **Step 1: `saveGame` persiste el reloj si la partida lo tiene**

Reemplazar:

```ts
import type { RankLevel } from '@tengen/engine'
import { GameTree } from './gameTree'
import { exportSgf, importSgf } from './sgf'
```

por:

```ts
import type { RankLevel } from '@tengen/engine'
import { GameTree } from './gameTree'
import { exportSgf, importSgf } from './sgf'
import { decodeClockConfig, decodeClockState, encodeClockConfig, encodeClockState } from './sgfClockCodec'
```

Reemplazar:

```ts
export function saveGame(
  storage: StorageLike,
  opponent: RankLevel,
  tree: GameTree,
  cloudId?: string,
): void {
  const payload: PersistedGame = {
    opponent,
    sgf: exportSgf(tree),
    cursorPath: tree.pathTo(tree.current),
    ...(cloudId !== undefined ? { cloudId } : {}),
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(payload))
}
```

por:

```ts
export function saveGame(
  storage: StorageLike,
  opponent: RankLevel,
  tree: GameTree,
  cloudId?: string,
): void {
  const clock = tree.meta.clock
  // Sin reloj: `exportSgf(tree)` sin segundo argumento, comportamiento IDÉNTICO a antes. Con reloj:
  // config en la raíz, estado vivo en el nodo ACTUAL (el tip, en Modo Jugar — ver sgfClockCodec.ts).
  const sgf = clock
    ? exportSgf(tree, (node) => {
        if (node === tree.root) return encodeClockConfig(clock.config)
        if (node === tree.current) return encodeClockState(clock.state)
        return undefined
      })
    : exportSgf(tree)
  const payload: PersistedGame = {
    opponent,
    sgf,
    cursorPath: tree.pathTo(tree.current),
    ...(cloudId !== undefined ? { cloudId } : {}),
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(payload))
}
```

- [ ] **Step 2: `loadGame` reconstruye `tree.meta.clock` si el SGF lo trae**

Reemplazar:

```ts
export function loadGame(
  storage: StorageLike,
): { opponent: RankLevel; tree: GameTree; cloudId?: string } | null {
  try {
    // getItem DENTRO del try: en modo privado / storage bloqueado, `storage.getItem` puede lanzar
    // (p.ej. SecurityError). Ese fallo debe resolverse igual que un JSON corrupto: `null`.
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPersistedGame(parsed)) return null
    const tree = importSgf(parsed.sgf)
    tree.navigateToPath(parsed.cursorPath) // si es inválido, no muta el cursor (queda en la raíz)
    return {
      opponent: parsed.opponent,
      tree,
      ...(parsed.cloudId !== undefined ? { cloudId: parsed.cloudId } : {}),
    }
  } catch {
    return null
  }
}
```

por:

```ts
export function loadGame(
  storage: StorageLike,
): { opponent: RankLevel; tree: GameTree; cloudId?: string } | null {
  try {
    // getItem DENTRO del try: en modo privado / storage bloqueado, `storage.getItem` puede lanzar
    // (p.ej. SecurityError). Ese fallo debe resolverse igual que un JSON corrupto: `null`.
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isPersistedGame(parsed)) return null

    // Intenta decodificar en CADA nodo (barato, y `decode*` devuelve null sin ruido si las
    // propiedades no están) — se queda con el último resultado no-nulo de cada uno. En la práctica
    // hay a lo sumo un nodo con cada tipo de dato (raíz para la config, el tip para el estado).
    let clockConfig: ReturnType<typeof decodeClockConfig> = null
    let clockState: ReturnType<typeof decodeClockState> = null
    const tree = importSgf(parsed.sgf, (_node, data) => {
      clockConfig = decodeClockConfig(data) ?? clockConfig
      clockState = decodeClockState(data) ?? clockState
    })
    if (clockConfig && clockState) tree.meta.clock = { config: clockConfig, state: clockState }

    tree.navigateToPath(parsed.cursorPath) // si es inválido, no muta el cursor (queda en la raíz)
    return {
      opponent: parsed.opponent,
      tree,
      ...(parsed.cloudId !== undefined ? { cloudId: parsed.cloudId } : {}),
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Extender `apps/web/tests/persistence.test.ts`**

Agregar, al final del archivo:

```ts
describe('persistence — reloj', () => {
  it('round-trip: config y estado vivo del reloj se preservan', () => {
    const clock = { mainTimeMs: 600_000, byoyomiPeriods: 5, byoyomiPeriodMs: 30_000 }
    const t = new GameTree({
      boardSize: 9,
      komi: 7,
      rules: 'chinese',
      handicap: 0,
      clock: {
        config: clock,
        state: {
          black: { mainTimeRemainingMs: 500_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
          white: { mainTimeRemainingMs: 600_000, byoyomiPeriodsRemaining: 5, inByoyomi: false },
        },
      },
    })
    t.addMove(B(2, 2))

    const storage = memStorage()
    saveGame(storage, KATA_OPPONENT, t)
    const loaded = loadGame(storage)

    expect(loaded).not.toBeNull()
    expect(loaded!.tree.meta.clock).toEqual(t.meta.clock)
  })

  it('sin reloj configurado, meta.clock sigue ausente tras el round-trip (compat)', () => {
    const t = new GameTree({ boardSize: 9, komi: 7, rules: 'chinese', handicap: 0 })
    t.addMove(B(2, 2))

    const storage = memStorage()
    saveGame(storage, KATA_OPPONENT, t)
    const loaded = loadGame(storage)

    expect(loaded!.tree.meta.clock).toBeUndefined()
  })
})
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -w @tengen/web -- persistence.test.ts`
Expected: todos los tests existentes + los 2 nuevos, en verde.

- [ ] **Step 5: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/game/persistence.ts apps/web/tests/persistence.test.ts
git commit -m "feat(web): saveGame/loadGame persisten el reloj vía sgfClockCodec"
```

---

### Task 9: `EngineManager.genMove` acepta reloj opcional

**Files:**
- Modify: `apps/web/src/engine/engineManager.ts`
- Modify: `apps/web/tests/engineManager.test.ts`

**Interfaces:**
- Consumes: `ClockConfig`/`ClockState` (`@tengen/engine`, Task 1).
- Produces: `EngineManager.genMove(pos, level, clock?)` — tercer parámetro opcional, reenviado tal cual a `engine.genMove(pos, {level, clock})`.

- [ ] **Step 1: `engineManager.ts` — tercer parámetro opcional**

Reemplazar:

```ts
import type { Analysis, BoardSize, CancelFn, Engine, Move, NetworkId, Position, RankLevel } from '@tengen/engine'
```

por:

```ts
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
```

Reemplazar:

```ts
  /**
   * Reconcilia y genera una jugada en race-contra-crash. Si falla con el engine VIVO (error
   * determinista) propaga sin reintentar. Si falló por CRASH, reconstruye y reintenta UNA vez; si el
   * reintento vuelve a fallar, propaga (sin bucle infinito).
   */
  async genMove(pos: Position, level: RankLevel): Promise<Move> {
    await this.reconcile()
    try {
      return await this.raceOp((engine) => engine.genMove(pos, { level }))
    } catch (e) {
      if (!(e instanceof WorkerCrashError)) throw e // engine vivo → error determinista → propaga
      // Crash: reconcile reconstruye (alive===false) y reintentamos exactamente una vez. Si el
      // reintento vuelve a crashear/fallar, su rechazo se propaga (no lo capturamos de nuevo).
      await this.reconcile()
      return await this.raceOp((engine) => engine.genMove(pos, { level }))
    }
  }
```

por:

```ts
  /**
   * Reconcilia y genera una jugada en race-contra-crash. Si falla con el engine VIVO (error
   * determinista) propaga sin reintentar. Si falló por CRASH, reconstruye y reintenta UNA vez; si el
   * reintento vuelve a fallar, propaga (sin bucle infinito). `clock` opcional (Fase reloj,
   * 2026-07-16): se reenvía tal cual al engine; ausente = comportamiento de siempre.
   */
  async genMove(
    pos: Position,
    level: RankLevel,
    clock?: { config: ClockConfig; state: ClockState },
  ): Promise<Move> {
    await this.reconcile()
    try {
      return await this.raceOp((engine) => engine.genMove(pos, { level, clock }))
    } catch (e) {
      if (!(e instanceof WorkerCrashError)) throw e // engine vivo → error determinista → propaga
      // Crash: reconcile reconstruye (alive===false) y reintentamos exactamente una vez. Si el
      // reintento vuelve a crashear/fallar, su rechazo se propaga (no lo capturamos de nuevo).
      await this.reconcile()
      return await this.raceOp((engine) => engine.genMove(pos, { level, clock }))
    }
  }
```

- [ ] **Step 2: Extender `FakeEngine` (test harness) para aceptar `clock` en `genMoveImpl`**

En `apps/web/tests/engineManager.test.ts`, reemplazar:

```ts
import type { Analysis, BoardSize, CancelFn, Engine, Move, NetworkId, Position, RankLevel } from '@tengen/engine'
```

por:

```ts
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
```

Reemplazar:

```ts
  /** Programable por instancia. Por defecto lanza (obliga al test a programarlo cuando lo usa). */
  genMoveImpl: (pos: Position, opts: { level: RankLevel }) => Promise<Move> = () => {
    throw new Error('FakeEngine: genMoveImpl no programado')
  }
```

por:

```ts
  /** Programable por instancia. Por defecto lanza (obliga al test a programarlo cuando lo usa). */
  genMoveImpl: (
    pos: Position,
    opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } },
  ) => Promise<Move> = () => {
    throw new Error('FakeEngine: genMoveImpl no programado')
  }
```

Reemplazar:

```ts
  genMove(pos: Position, opts: { level: RankLevel }): Promise<Move> {
    this.genMoveCalls++
    return this.genMoveImpl(pos, opts)
  }
```

por:

```ts
  genMove(pos: Position, opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } }): Promise<Move> {
    this.genMoveCalls++
    return this.genMoveImpl(pos, opts)
  }
```

- [ ] **Step 3: Agregar tests de reloj a `describe('EngineManager.genMove', ...)`**

```ts
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
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -w @tengen/web -- engineManager.test.ts`
Expected: todos los tests existentes + los 2 nuevos, en verde.

- [ ] **Step 5: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/engine/engineManager.ts apps/web/tests/engineManager.test.ts
git commit -m "feat(web): EngineManager.genMove reenvía un reloj opcional"
```

---

### Task 10: `formatResult` — derrota por tiempo

**Files:**
- Modify: `apps/web/src/game/endgame.ts`
- Modify: `apps/web/tests/endgame.test.ts`

**Interfaces:**
- Produces: `formatResult(scoreLead: number, resign?: StoneColor, timeout?: StoneColor): string` — tercer parámetro opcional, mismo criterio que `resign` (quien se queda sin tiempo PIERDE).

- [ ] **Step 1: Agregar el parámetro `timeout`**

Reemplazar:

```ts
/**
 * Resultado en formato estilo SGF RE ("B+7.5", "W+3.5", "Draw", "B+R", "W+R").
 *
 * - Con `resign`: `resign` es el color que SE RINDE; gana el OPUESTO. `formatResult(_, 'black')`
 *   → 'W+R' (Negro se rinde, gana Blanco). El `scoreLead` se ignora en este caso.
 * - Sin `resign`: `scoreLead` es la estimación de score en perspectiva de Negro (komi incluido,
 *   tal como lo entrega `Analysis.scoreLead`). >0 → gana Negro; <0 → gana Blanco; ===0 → 'Draw'.
 *   La diferencia se redondea a 1 decimal.
 */
export function formatResult(scoreLead: number, resign?: StoneColor): string {
  if (resign) return resign === 'black' ? 'W+R' : 'B+R'
  if (scoreLead === 0) return 'Draw'
  return scoreLead > 0 ? `B+${scoreLead.toFixed(1)}` : `W+${(-scoreLead).toFixed(1)}`
}
```

por:

```ts
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
```

- [ ] **Step 2: Agregar tests a `apps/web/tests/endgame.test.ts`**

Agregar, después de `describe('formatResult — con resign ...', ...)`:

```ts
describe('formatResult — con timeout (timeout = quien SE QUEDÓ SIN TIEMPO)', () => {
  it('Negro se queda sin tiempo → gana Blanco (W+T)', () => {
    expect(formatResult(0, undefined, 'black')).toBe('W+T')
  })

  it('Blanco se queda sin tiempo → gana Negro (B+T)', () => {
    expect(formatResult(0, undefined, 'white')).toBe('B+T')
  })

  it('timeout tiene prioridad sobre resign si ambos se pasan', () => {
    expect(formatResult(0, 'white', 'black')).toBe('W+T')
  })
})
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -w @tengen/web -- endgame.test.ts`
Expected: todos los tests existentes + los 3 nuevos, en verde.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/game/endgame.ts apps/web/tests/endgame.test.ts
git commit -m "feat(web): formatResult admite derrota por tiempo (B+T/W+T)"
```

---

### Task 11: `NewGameForm.tsx` — campos de reloj

**Files:**
- Modify: `apps/web/src/ui/NewGameForm.tsx`

**Interfaces:**
- Consumes: `GameConfig.clock` (Task 5), `validateConfig` (sin cambios de firma).
- Produces: `onStart(config)` recibe `config.clock` cuando el toggle "Sin reloj" está DESACTIVADO (default: reloj activado). Sin tests de componente (convención) — verificación manual en Task 13.

- [ ] **Step 1: Estado + default por tamaño de tablero**

Reemplazar:

```ts
// Komi por defecto según reglas (chino 7, japonés 6.5). Se re-aplica al cambiar de reglas
// SOLO si el usuario no tocó el campo de komi a mano (ver `komiTouched`).
function defaultKomi(rules: Rules): number {
  return rules === 'chinese' ? 7 : 6.5
}

export function NewGameForm({ onStart, onBack }: NewGameFormProps) {
  // Tamaño por defecto: 9×9 (partida más corta y rápida — mejor primera experiencia jugable que
  // 19×19; además el usuario puede subir de tamaño cuando quiera).
  const [boardSize, setBoardSize] = useState<BoardSize>(9)
  const [opponentKind, setOpponentKind] = useState<'human' | 'kata'>('kata')
  const [humanRank, setHumanRank] = useState<HumanRank>('5k')
  const [kataVisits, setKataVisits] = useState<number>(200)
  const [rules, setRules] = useState<Rules>('chinese')
  const [komi, setKomi] = useState<number>(defaultKomi('chinese'))
  const [komiTouched, setKomiTouched] = useState(false)
  const [handicap, setHandicap] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handicapAllowed = boardSize === 19

  function handleRulesChange(next: Rules): void {
    setRules(next)
    if (!komiTouched) setKomi(defaultKomi(next))
  }

  function handleBoardSizeChange(next: BoardSize): void {
    setBoardSize(next)
    if (next !== 19) setHandicap(0) // M-4: handicap>1 solo en 19×19 (el motor lo rechazaría igual)
  }
```

por:

```ts
// Komi por defecto según reglas (chino 7, japonés 6.5). Se re-aplica al cambiar de reglas
// SOLO si el usuario no tocó el campo de komi a mano (ver `komiTouched`).
function defaultKomi(rules: Rules): number {
  return rules === 'chinese' ? 7 : 6.5
}

// Tiempo principal sugerido por tamaño de tablero (minutos) — mismo orden de magnitud que KGS
// (spec 2026-07-16-reloj-partida-design.md §UI). El byoyomi (5×30s) NO varía por tamaño.
function defaultMainTimeMin(size: BoardSize): number {
  if (size === 9) return 10
  if (size === 13) return 20
  return 30
}
const DEFAULT_BYOYOMI_PERIODS = 5
const DEFAULT_BYOYOMI_SECONDS = 30

export function NewGameForm({ onStart, onBack }: NewGameFormProps) {
  // Tamaño por defecto: 9×9 (partida más corta y rápida — mejor primera experiencia jugable que
  // 19×19; además el usuario puede subir de tamaño cuando quiera).
  const [boardSize, setBoardSize] = useState<BoardSize>(9)
  const [opponentKind, setOpponentKind] = useState<'human' | 'kata'>('kata')
  const [humanRank, setHumanRank] = useState<HumanRank>('5k')
  const [kataVisits, setKataVisits] = useState<number>(200)
  const [rules, setRules] = useState<Rules>('chinese')
  const [komi, setKomi] = useState<number>(defaultKomi('chinese'))
  const [komiTouched, setKomiTouched] = useState(false)
  const [handicap, setHandicap] = useState(0)
  // Reloj (Fase reloj, 2026-07-16): activado por defecto con valores sugeridos, con un toggle "Sin
  // reloj". `clockTouched` seguido del mismo patrón que `komiTouched`: no pisar un valor de tiempo
  // principal que el usuario ya tocó a mano al cambiar de tamaño de tablero.
  const [clockEnabled, setClockEnabled] = useState(true)
  const [mainTimeMin, setMainTimeMin] = useState<number>(defaultMainTimeMin(9))
  const [clockTouched, setClockTouched] = useState(false)
  const [byoyomiPeriods, setByoyomiPeriods] = useState<number>(DEFAULT_BYOYOMI_PERIODS)
  const [byoyomiSeconds, setByoyomiSeconds] = useState<number>(DEFAULT_BYOYOMI_SECONDS)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handicapAllowed = boardSize === 19

  function handleRulesChange(next: Rules): void {
    setRules(next)
    if (!komiTouched) setKomi(defaultKomi(next))
  }

  function handleBoardSizeChange(next: BoardSize): void {
    setBoardSize(next)
    if (next !== 19) setHandicap(0) // M-4: handicap>1 solo en 19×19 (el motor lo rechazaría igual)
    if (!clockTouched) setMainTimeMin(defaultMainTimeMin(next))
  }
```

- [ ] **Step 2: `handleSubmit` arma `config.clock`**

Reemplazar:

```ts
  function handleSubmit(evt: Event): void {
    evt.preventDefault()
    setErrorMsg(null)
    const opponent: RankLevel =
      opponentKind === 'human' ? { kind: 'human', rank: humanRank } : { kind: 'kata', visits: kataVisits }
    const config: GameConfig = { boardSize, komi, rules, handicap, opponent }
    try {
      onStart(validateConfig(config))
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }
```

por:

```ts
  function handleSubmit(evt: Event): void {
    evt.preventDefault()
    setErrorMsg(null)
    const opponent: RankLevel =
      opponentKind === 'human' ? { kind: 'human', rank: humanRank } : { kind: 'kata', visits: kataVisits }
    const config: GameConfig = {
      boardSize,
      komi,
      rules,
      handicap,
      opponent,
      ...(clockEnabled
        ? {
            clock: {
              mainTimeMs: mainTimeMin * 60_000,
              byoyomiPeriods,
              byoyomiPeriodMs: byoyomiSeconds * 1000,
            },
          }
        : {}),
    }
    try {
      onStart(validateConfig(config))
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }
```

- [ ] **Step 3: Campos del formulario**

Reemplazar el `<div class="field-group">` de Reglas/Komi/Handicap (el segundo `field-group` del JSX):

```tsx
      <div class="field-group">
        <label class="field">
          Reglas
          <select value={rules} onChange={(e) => handleRulesChange((e.target as HTMLSelectElement).value as Rules)}>
            <option value="chinese">Chinas</option>
            <option value="japanese">Japonesas</option>
          </select>
        </label>

        <label class="field">
          Komi
          <input
            type="number"
            step="0.5"
            value={komi}
            onChange={(e) => {
              setKomiTouched(true)
              setKomi(Number((e.target as HTMLInputElement).value))
            }}
          />
        </label>

        <label class="field">
          Handicap
          <select
            value={handicap}
            disabled={!handicapAllowed}
            onChange={(e) => setHandicap(Number((e.target as HTMLSelectElement).value))}
          >
            {(handicapAllowed ? HANDICAP_OPTIONS_19 : [0]).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Sin handicap' : `${n} piedras`}
              </option>
            ))}
          </select>
          {!handicapAllowed && <span class="field-hint">Solo disponible en 19×19</span>}
        </label>
      </div>

      {errorMsg && <p class="form-error">{errorMsg}</p>}
```

por:

```tsx
      <div class="field-group">
        <label class="field">
          Reglas
          <select value={rules} onChange={(e) => handleRulesChange((e.target as HTMLSelectElement).value as Rules)}>
            <option value="chinese">Chinas</option>
            <option value="japanese">Japonesas</option>
          </select>
        </label>

        <label class="field">
          Komi
          <input
            type="number"
            step="0.5"
            value={komi}
            onChange={(e) => {
              setKomiTouched(true)
              setKomi(Number((e.target as HTMLInputElement).value))
            }}
          />
        </label>

        <label class="field">
          Handicap
          <select
            value={handicap}
            disabled={!handicapAllowed}
            onChange={(e) => setHandicap(Number((e.target as HTMLSelectElement).value))}
          >
            {(handicapAllowed ? HANDICAP_OPTIONS_19 : [0]).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Sin handicap' : `${n} piedras`}
              </option>
            ))}
          </select>
          {!handicapAllowed && <span class="field-hint">Solo disponible en 19×19</span>}
        </label>
      </div>

      <div class="field-group">
        <label class="radio-option">
          <input
            type="checkbox"
            checked={!clockEnabled}
            onChange={(e) => setClockEnabled(!(e.target as HTMLInputElement).checked)}
          />
          Sin reloj
        </label>

        {clockEnabled && (
          <>
            <label class="field">
              Tiempo principal (minutos)
              <input
                type="number"
                min="0"
                step="1"
                value={mainTimeMin}
                onChange={(e) => {
                  setClockTouched(true)
                  setMainTimeMin(Number((e.target as HTMLInputElement).value))
                }}
              />
            </label>

            <label class="field">
              Byoyomi: períodos
              <input
                type="number"
                min="0"
                step="1"
                value={byoyomiPeriods}
                onChange={(e) => setByoyomiPeriods(Number((e.target as HTMLInputElement).value))}
              />
            </label>

            <label class="field">
              Byoyomi: segundos por período
              <input
                type="number"
                min="1"
                step="5"
                value={byoyomiSeconds}
                onChange={(e) => setByoyomiSeconds(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          </>
        )}
      </div>

      {errorMsg && <p class="form-error">{errorMsg}</p>}
```

- [ ] **Step 4: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/NewGameForm.tsx
git commit -m "feat(web): NewGameForm — campos de reloj (tiempo principal + byoyomi) con toggle Sin reloj"
```

---

### Task 12: `PlayView.tsx` — reloj en vivo (ticking, timeout, medición de la IA, restauración)

**Files:**
- Modify: `apps/web/src/ui/PlayView.tsx`

**Interfaces:**
- Consumes: `applyElapsed` (`@tengen/engine`, Task 1), `manager.genMove(pos, level, clock?)` (Task 9), `formatResult(scoreLead, resign?, timeout?)` (Task 10), `tree.meta.clock` (Task 6).
- Produces: reloj visible por color, cuenta regresiva en vivo, derrota por tiempo, la IA recibe su presupuesto y consume su reloj según el tiempo real que usó. Sin tests de componente — verificación manual en Task 13.

- [ ] **Step 1: Imports**

Reemplazar:

```ts
import { useEffect, useRef, useState } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import type { GhostStone, Marker } from '@sabaki/shudan'
import type { BoardSize, Move, NetworkId, RankLevel } from '@tengen/engine'
```

por:

```ts
import { useEffect, useRef, useState } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import type { GhostStone, Marker } from '@sabaki/shudan'
import { applyElapsed } from '@tengen/engine'
import type { BoardSize, ClockConfig, ClockState, Move, NetworkId, RankLevel } from '@tengen/engine'
```

- [ ] **Step 2: Helper de formato de tiempo (fuera del componente)**

Insertar, después de `formatDateForFilename` (antes del comentario `/** Envuelve la pantalla de juego en ModelGate...`):

```ts
/** `mm:ss`, siempre 2 dígitos en ambos campos (`5:07` se ve como `05:07`). */
function formatClockMs(ms: number): string {
  const totalSeconds = Math.max(Math.ceil(ms / 1000), 0)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
```

- [ ] **Step 3: Refs/estado nuevo + helpers de reloj**

Reemplazar:

```ts
  const [hoveredVertex, setHoveredVertex] = useState<[number, number] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const boardBounds = useBoundedBoardSize(boardRef)
```

por:

```ts
  const [hoveredVertex, setHoveredVertex] = useState<[number, number] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const boardBounds = useBoundedBoardSize(boardRef)
  // Reloj (Fase reloj, 2026-07-16): `turnStartedAtRef` marca cuándo arrancó el turno EN VIVO
  // actual — se resetea tras cada jugada aplicada a la partida viva (nunca en modo exploración, que
  // no consume reloj). Al restaurar (localStorage/Mis partidas), arranca fresco en el momento del
  // montaje: cerrar la pestaña y reabrir NO penaliza al jugador que estaba por mover (limitación
  // aceptada y documentada en la spec — Fase A es 100% client-side, sin autoridad de servidor).
  const turnStartedAtRef = useRef(Date.now())
  // true recién cuando `boot()` confirma el motor listo (Step 4, más abajo) — mismo patrón por-ref
  // que `staleRef`/`endedRef` (nunca `useState`, para no capturarlo obsoleto dentro del `setInterval`
  // del ticker de Step 5). Sin esto, el reloj arrancaría a descontar tiempo desde el MONTAJE del
  // componente, comiéndose el tiempo de "Preparando motor…" (bug encontrado en la autorevisión).
  const bootedRef = useRef(false)
  // Fuerza el repintado del reloj cada ~250ms (el valor en sí no se lee nunca — mismo patrón que el
  // `bump()` del árbol, pero separado: este NO representa una mutación del árbol).
  const [, setClockTick] = useState(0)

  /** No-op si la partida no tiene reloj. Muta `tree.meta.clock.state[color]` IN-PLACE (mismo patrón
   *  que `tree.meta.result`) y devuelve si ese color se quedó sin tiempo. */
  function consumeClock(color: 'black' | 'white', elapsedMs: number): boolean {
    const clock = tree.meta.clock
    if (!clock) return false
    const { state: next, timedOut } = applyElapsed(clock.state[color], clock.config, elapsedMs)
    clock.state[color] = next
    return timedOut
  }

  /** Presupuesto a pasarle a `manager.genMove` para el color dado. `undefined` sin reloj. */
  function clockOptsFor(color: 'black' | 'white'): { config: ClockConfig; state: ClockState } | undefined {
    const clock = tree.meta.clock
    if (!clock) return undefined
    return { config: clock.config, state: clock.state[color] }
  }

  /** Marca la partida terminada por tiempo (mismo canal que resign/score: `endedRef`, `tree.meta.result`,
   *  `persist()`, `cloud.finish()`) — factoriza el remate repetido en los 3 call sites que pueden
   *  detectar un timeout (clic humano, pase humano, jugada de la IA) + el ticker de abajo. */
  function declareTimeout(color: 'black' | 'white'): void {
    endedRef.current = true
    const resultStr = formatResult(0, undefined, color)
    tree.meta.result = resultStr
    setResult(resultStr)
    setBusy(false)
    persist()
    cloud.finish()
  }

  /** Cuánto le queda al color dado AHORA MISMO, para mostrar (no muta nada): si es su turno, la
   *  partida sigue viva Y el cursor está en el tip (no explorando), descuenta el tiempo transcurrido
   *  desde `turnStartedAtRef` en vivo; si no, muestra el último snapshot guardado. `turnStartedAtRef`
   *  NUNCA se resetea en modo exploración (ver `handleVertexClick`/`handlePass`), así que sin este
   *  chequeo `isExploring()` navegar variaciones mostraría una cuenta regresiva contra un timestamp
   *  obsoleto — bug encontrado en la autorevisión del plan, no en el spec. Mientras está en byoyomi,
   *  cuenta regresiva del período vigente (no del pozo principal, que ya quedó en 0). */
  function displayedClock(color: 'black' | 'white'): { ms: number; periodsRemaining: number; inByoyomi: boolean } {
    const clock = tree.meta.clock!
    const state = clock.state[color]
    const isLiveTurn = bootedRef.current && result === null && !isExploring() && tree.currentTurnAt() === color
    const elapsed = isLiveTurn ? Date.now() - turnStartedAtRef.current : 0
    const ms = state.inByoyomi
      ? Math.max(clock.config.byoyomiPeriodMs - elapsed, 0)
      : Math.max(state.mainTimeRemainingMs - elapsed, 0)
    return { ms, periodsRemaining: state.byoyomiPeriodsRemaining, inByoyomi: state.inByoyomi }
  }
```

- [ ] **Step 4: `boot()` — marcar el reloj "listo" recién cuando el motor arranca**

`turnStartedAtRef`/`bootedRef` (Step 3) arrancan en su valor inicial desde el MONTAJE del
componente, pero el motor tarda un poco en estar listo (`ensureReady`, ya asíncrono hoy). Sin este
paso, el reloj del humano empezaría a descontarse durante "Preparando motor…", antes de que el
jugador pueda siquiera hacer clic. Reemplazar, DENTRO del `useEffect` de arranque existente (función
interna `boot()`):

```ts
        await manager.ensureReady(net, config.boardSize)
        if (staleRef.current) return
        setBooting(false)
```

por:

```ts
        await manager.ensureReady(net, config.boardSize)
        if (staleRef.current) return
        setBooting(false)
        // Reloj (Fase reloj, 2026-07-16): recién ACÁ arranca "de verdad" el turno en vivo — ni un
        // segundo de "Preparando motor…" debe comerse el tiempo del jugador.
        bootedRef.current = true
        turnStartedAtRef.current = Date.now()
```

(Ambas líneas nuevas son no-op si la partida no tiene reloj — `consumeClock`/`displayedClock`/el
ticker ya chequean `tree.meta.clock` antes de leer estos refs.)

- [ ] **Step 5: Ticker de reloj — nuevo `useEffect`, en paralelo al `useEffect` de arranque existente**

Insertar, DESPUÉS del `useEffect` de arranque (el que termina en `}, [])` justo antes de `function handleVertexClick`):

```ts
  // Ticker del reloj (Fase reloj, 2026-07-16): re-pinta la cuenta regresiva cada ~250ms Y detecta
  // timeout del lado HUMANO (Negro) — el lado de la IA nunca "queda AFK" (su reloj se descuenta al
  // recibir su jugada, en `aiTurn`, no acá). Usa diferencia contra un timestamp ABSOLUTO
  // (`Date.now() - turnStartedAtRef.current`), no conteo de ticks: un tab en background/throttled
  // puede detectar el timeout TARDE, nunca de forma incorrecta-temprana (se autocorrige apenas
  // vuelve a tickear). `bootedRef.current` (Step 4) evita chequear timeout antes de que el motor
  // esté listo.
  useEffect(() => {
    if (tree.meta.clock === undefined) return
    const id = setInterval(() => {
      if (staleRef.current || endedRef.current || !bootedRef.current) return
      if (tree.currentTurnAt() !== 'black' || isExploring()) {
        setClockTick((t) => t + 1)
        return
      }
      const elapsed = Date.now() - turnStartedAtRef.current
      const clock = tree.meta.clock!
      const { timedOut } = applyElapsed(clock.state.black, clock.config, elapsed)
      if (timedOut) {
        declareTimeout('black')
        return
      }
      setClockTick((t) => t + 1)
    }, 250)
    return () => clearInterval(id)
    // Se ejecuta una sola vez: mismo criterio que el useEffect de arranque (una partida = un montaje).
  }, [])
```

- [ ] **Step 6: `handleVertexClick` — consumir el reloj del humano tras su jugada**

Reemplazar:

```ts
    // Partida viva, en el tip: comportamiento de Task 4 intacto (solo Negro humano juega).
    if (turnAtCursor !== 'black') return
    const validation = validateMove(tree.boardAt(), 'black', vertex)
    if (!validation.legal) {
      setIllegalMoveHint(illegalMoveMessage(validation.reason!))
      return
    }
    setIllegalMoveHint(null)
    tree.addMove({ color: 'black', vertex })
    bump()
    persist()
    setBusy(true)
    void finishTurn()
  }
```

por:

```ts
    // Partida viva, en el tip: comportamiento de Task 4 intacto (solo Negro humano juega).
    if (turnAtCursor !== 'black') return
    const validation = validateMove(tree.boardAt(), 'black', vertex)
    if (!validation.legal) {
      setIllegalMoveHint(illegalMoveMessage(validation.reason!))
      return
    }
    setIllegalMoveHint(null)
    const elapsed = Date.now() - turnStartedAtRef.current
    const timedOut = consumeClock('black', elapsed)
    tree.addMove({ color: 'black', vertex })
    bump()
    persist()
    if (timedOut) {
      declareTimeout('black')
      return
    }
    turnStartedAtRef.current = Date.now()
    setBusy(true)
    void finishTurn()
  }
```

- [ ] **Step 7: `handlePass` — mismo tratamiento**

Reemplazar:

```ts
    if (turnAtCursor !== 'black') return
    tree.addMove({ color: 'black', vertex: 'pass' })
    bump()
    persist()
    setBusy(true)
    void finishTurn()
  }
```

por:

```ts
    if (turnAtCursor !== 'black') return
    const elapsed = Date.now() - turnStartedAtRef.current
    const timedOut = consumeClock('black', elapsed)
    tree.addMove({ color: 'black', vertex: 'pass' })
    bump()
    persist()
    if (timedOut) {
      declareTimeout('black')
      return
    }
    turnStartedAtRef.current = Date.now()
    setBusy(true)
    void finishTurn()
  }
```

- [ ] **Step 8: `aiTurn` — pasar el reloj a `genMove` y consumir el de la IA tras medir su tiempo real**

Reemplazar:

```ts
  /** Exactamente UNA jugada de la IA (Blanco) desde el tip actual; NO se auto-repite. */
  async function aiTurn(): Promise<void> {
    setBusy(true)
    try {
      const move = await manager.genMove(tree.positionAt(), config.opponent)
      if (staleRef.current || endedRef.current) return
      tree.addMove(move)
      bump()
      persist()
      await finishTurn()
    } catch (e) {
      if (staleRef.current || endedRef.current) return
      setErrorMsg(`La IA no pudo jugar (${errorMessage(e)}). Puedes iniciar una nueva partida.`)
      setBusy(false)
    }
  }
```

por:

```ts
  /** Exactamente UNA jugada de la IA (Blanco) desde el tip actual; NO se auto-repite. El tiempo que
   *  REALMENTE tomó (medido acá, no reportado por el motor) es lo que se descuenta de su reloj —
   *  "ambos respetan el reloj" (spec 2026-07-16) sin que `genMove` necesite devolver un dato nuevo. */
  async function aiTurn(): Promise<void> {
    setBusy(true)
    const aiTurnStartedAt = Date.now()
    try {
      const move = await manager.genMove(tree.positionAt(), config.opponent, clockOptsFor('white'))
      if (staleRef.current || endedRef.current) return
      const elapsed = Date.now() - aiTurnStartedAt
      const timedOut = consumeClock('white', elapsed)
      tree.addMove(move)
      bump()
      persist()
      if (timedOut) {
        declareTimeout('white')
        return
      }
      turnStartedAtRef.current = Date.now()
      await finishTurn()
    } catch (e) {
      if (staleRef.current || endedRef.current) return
      setErrorMsg(`La IA no pudo jugar (${errorMessage(e)}). Puedes iniciar una nueva partida.`)
      setBusy(false)
    }
  }
```

- [ ] **Step 9: JSX — mostrar el reloj en el panel**

Reemplazar:

```tsx
      <aside class="play-panel">
        <p class="play-opponent">Oponente: {opponentLabel(config.opponent)}</p>
```

por:

```tsx
      <aside class="play-panel">
        {tree.meta.clock && (
          <div class="play-clock">
            <p class={turn === 'black' ? 'play-clock-active' : ''}>
              Negro: {formatClockMs(displayedClock('black').ms)}
              {displayedClock('black').inByoyomi && ` · byoyomi ${displayedClock('black').periodsRemaining}`}
            </p>
            <p class={turn === 'white' ? 'play-clock-active' : ''}>
              Blanco: {formatClockMs(displayedClock('white').ms)}
              {displayedClock('white').inByoyomi && ` · byoyomi ${displayedClock('white').periodsRemaining}`}
            </p>
          </div>
        )}
        <p class="play-opponent">Oponente: {opponentLabel(config.opponent)}</p>
```

- [ ] **Step 10: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/ui/PlayView.tsx
git commit -m "feat(web): PlayView — reloj en vivo, timeout, y la IA consume su presupuesto real"
```

---

### Task 13: CSS del reloj + verificación manual completa

**Files:**
- Modify: `apps/web/src/styles/app.css`

- [ ] **Step 1: Estilos del reloj**

En `apps/web/src/styles/app.css`, agregar (cerca de `.play-turn`/`.play-error`, en la sección "── Pantalla de juego ──"):

```css
.play-clock {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
}

.play-clock p {
  margin: 0;
}

.play-clock-active {
  font-weight: 600;
  color: var(--tengen-accent);
}
```

- [ ] **Step 2: Typecheck + tests + build completos del monorepo**

Run: `npx -w @tengen/engine tsc --noEmit && npm test -w @tengen/engine && npx -w @tengen/web tsc --noEmit && npm test -w @tengen/web && npm run build -w @tengen/web`
Expected: typecheck limpio en ambos paquetes, todos los tests en verde (engine + web), build de producción exitoso.

- [ ] **Step 3: Verificación manual en navegador (Chrome real, dev server local)**

Con `npm run dev -w @tengen/web`, confirmar en los 3 tamaños de tablero:
1. **Partida nueva CON reloj** (default): el toggle "Sin reloj" desactivado deja ver tiempo principal + byoyomi precargados según tamaño; arrancar la partida muestra el reloj en el panel, tickeando solo del lado a quien le toca.
2. **Partida SIN reloj** (toggle activado): comportamiento idéntico al de antes de este plan — sin panel de reloj, sin cambios visuales.
3. **Entrada a byoyomi**: con un tiempo principal corto (p.ej. 10 segundos) confirmar que, al agotarse, el reloj pasa a mostrar el período de byoyomi y el contador de períodos restantes.
4. **Derrota por tiempo del lado humano**: dejar correr el reloj hasta agotar todos los períodos de byoyomi — confirmar que la partida termina con "Resultado: W+T" (o "B+T" si Blanco es quien pierde en algún escenario manual forzado) y que el tablero/controles quedan deshabilitados igual que tras un resign.
5. **La IA respeta su reloj**: con un reloj MUY corto para la IA (tiempo principal bajo), confirmar que las jugadas de la IA llegan notablemente más rápido que con un reloj holgado o sin reloj (aunque sea una impresión cualitativa, no una medición exacta).
6. **Restauración a mitad de partida**: con una partida CON reloj en curso, recargar la página (o cerrar/reabrir la pestaña) — confirmar que la partida se restaura con el reloj en el punto donde quedó (no arrancó de cero, no quedó congelada).
7. **Confirmar CERO regresión** en una partida sin reloj: import/export SGF, exploración de variaciones, árbol de jugadas, todo el flujo de Fase 2/5 intacto.

- [ ] **Step 4: Commit final (si el Step 1 no se commiteó en un paso anterior)**

```bash
git add apps/web/src/styles/app.css
git commit -m "feat(web): estilos del reloj en el panel de Modo Jugar"
```
