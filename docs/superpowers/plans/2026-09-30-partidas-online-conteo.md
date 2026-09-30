# Partidas online: reglas y fase de conteo — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** elegir reglas (chinas/japonesas) en la partida online y terminarla con una fase de marcar muertas que ambos aceptan, contando según la regla elegida y mostrando el desglose.

**Architecture:** se extiende el log de eventos de la sala (`packages/go-rules/src/room.ts`) con la fase `scoring` y tres intenciones nuevas; el conteo es una función pura nueva (`scoring.ts`) que usan el servidor (resultado autoritativo) y el cliente (conteo en vivo). El Durable Object solo agrega la alarm de 5 min; la UI agrega el modo conteo.

**Tech Stack:** TypeScript, `@sabaki/go-board`, `@sabaki/shudan` (`BoundedGoban`: `dimmedVertices`, `paintMap`), Cloudflare Durable Objects, Preact, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-partidas-online-conteo-design.md` (extiende `2026-09-30-partidas-online-design.md`).

## Global Constraints

- Reglas: `'chinese' | 'japanese'` (tipo `Rules` de `@tengen/engine/types`); log sin `rules` ⇒ `'chinese'`.
- Komi por defecto: 7 chinas, 6,5 japonesas (lógica existente de `NewGameForm`).
- Conteo tras dos pases consecutivos **desde el último `resumed` (o `started`)**.
- Relojes pausados en `scoring`; `flagDeadline` = `undefined` en `scoring`.
- `SCORING_TIMEOUT_MS = 5 * 60 * 1000`, reiniciado por `scoring`, `dead-toggled` y `accepted`.
- Al vencer: un solo aceptado ⇒ gana ese, `B+F`/`W+F`; ninguno ⇒ `resumed{by:'timeout'}`.
- Chinas: total = piedras + territorio (+komi Blanco), prisioneros = 0. Japonesas: total = territorio + prisioneros (capturas + muertas del rival) (+komi Blanco).
- Partida real `tengen-online-2026-09-30.sgf`: `W+1.5` chinas, `W+0.5` japonesas.
- `go-rules` solo `import type` de `@tengen/engine/types` (el worker no debe arrastrar onnxruntime).
- Español en UI/commits; identificadores en inglés. Commits nuevos, stage por nombre, trailer Co-Authored-By/Claude-Session.

## Review Focus

1. **Pase después de "Seguir jugando":** un solo pase NO vuelve a abrir el conteo; hacen falta dos nuevos (test en Task 2).
2. **Marcar después de que el rival aceptó:** borra ambas aceptaciones y reinicia los 5 min — nadie gana por abandono con marcas que el otro no vio (test en Task 2).
3. **Reconectar en pleno conteo:** el cliente muestra las mismas muertas, aceptaciones y cuenta regresiva (test en Task 5).
4. **Rendirse durante el conteo:** se permite y termina `X+R` (test en Task 2).
5. **Sala creada antes del deploy (sin `rules`):** se juega y cuenta como china; el SGF dice `RU[Chinese]` (tests en Task 2 y Task 4).

---

### Task 1: conteo puro (`scoreGame`, `ownershipMap`) + resultado por abandono

**Files:**
- Create: `packages/go-rules/src/scoring.ts`, `packages/go-rules/tests/scoring.test.ts`
- Modify: `packages/go-rules/src/index.ts` (`export * from './scoring'`)

**Interfaces:**
- Produces (exacto):

```ts
import type { BoardSize, Move, Rules } from '@tengen/engine/types'
export interface Vertex { x: number; y: number }
export interface SideScore { stones: number; territory: number; prisoners: number; komi: number; total: number }
export interface ScoreBreakdown { rules: Rules; black: SideScore; white: SideScore; result: string }
export interface ScoreInput { boardSize: BoardSize; handicap: number; moves: Move[]; dead: Vertex[]; rules: Rules; komi: number }
export function chainAt(boardSize: BoardSize, handicap: number, moves: Move[], v: Vertex): Vertex[] // cadena del mismo color que contiene v; [] si v está vacío
export function scoreGame(input: ScoreInput): ScoreBreakdown
export function ownershipMap(input: Omit<ScoreInput, 'rules' | 'komi'>): (-1 | 0 | 1)[][] // [y][x]: 1 negro, -1 blanco, 0 dame; piedras vivas y territorio, muertas cuentan para el rival
```

- [ ] **Step 1: tests (fallan)** en `scoring.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Move } from '@tengen/engine/types'
import { chainAt, ownershipMap, scoreGame } from '../src/scoring'

// Partida real de producción (sala guafwC_XKSW9pC3vhod6Sw), sin muertas.
const REAL = 'gc cg gg cc de ef fe dd ee ce ec df eh ff gf dh db cb da ca ed dc eb fg fh ei fi ci di eg gh ei - di - -'
function sgfMoves(s: string): Move[] {
  return s.split(' ').map((c, i) => ({
    color: i % 2 === 0 ? 'black' : 'white',
    vertex: c === '-' ? 'pass' : { x: c.charCodeAt(0) - 97, y: c.charCodeAt(1) - 97 },
  }))
}

describe('scoreGame', () => {
  it('partida real, chinas: 43 vs 38 + 6,5 → W+1.5', () => {
    const s = scoreGame({ boardSize: 9, handicap: 0, moves: sgfMoves(REAL), dead: [], rules: 'chinese', komi: 6.5 })
    expect(s.black).toEqual({ stones: 15, territory: 28, prisoners: 0, komi: 0, total: 43 })
    expect(s.white).toEqual({ stones: 16, territory: 22, prisoners: 0, komi: 6.5, total: 44.5 })
    expect(s.result).toBe('W+1.5')
  })
  it('partida real, japonesas: 28+1 vs 22+1+6,5 → W+0.5', () => {
    const s = scoreGame({ boardSize: 9, handicap: 0, moves: sgfMoves(REAL), dead: [], rules: 'japanese', komi: 6.5 })
    expect(s.black.total).toBe(29)
    expect(s.white.total).toBe(29.5)
    expect(s.result).toBe('W+0.5')
  })
})
```

  Agregar un caso con muertas: armar en 9×9 un muro negro en la columna x=4 (y=0..8) y un muro blanco en x=5 (y=0..8) y una piedra blanca en (1,1) dentro del lado negro; con `dead: [{x:1,y:1}]`:
  - chinas: negro = 9 piedras + 36 territorio (la muerta pasa a territorio) = 45; blanco = 9 + 27 = 36 (+komi).
  - japonesas: negro = 36 territorio + 1 prisionero (la muerta) = 37; blanco = 27 + 0 (+komi).
  - sin marcarla (`dead: []`): la región izquierda linda con ambos colores → dame (negro 9 + 0 territorio).
  (Construir las jugadas alternando colores y usando pases para que cada color juegue su muro; verificar con `chainAt` que `(1,1)` devuelve `[{x:1,y:1}]` y que un punto vacío devuelve `[]`.)
  - `ownershipMap` del caso con la muerta marcada: `[1][1] === 1` y `[0][8] === -1`.

Run: `npm test -w @tengen/go-rules -- scoring` → FAIL (módulo inexistente).

- [ ] **Step 2: implementar** `scoring.ts`:

```ts
import type { BoardSize, Move, Rules } from '@tengen/engine/types'
import { boardFromMoves, capturesOf, signMapOf, type SetupStones } from './rules'
import { countArea } from './territory'
import { formatResult } from './endgame'

// (interfaces de arriba)

const key = (v: Vertex) => `${v.x},${v.y}`

export function chainAt(boardSize: BoardSize, handicap: number, moves: Move[], v: Vertex): Vertex[] {
  const board = boardFromMoves(boardSize, handicap, moves)
  if (!board.has([v.x, v.y]) || board.get([v.x, v.y]) === 0) return []
  return board.getChain([v.x, v.y]).map(([x, y]) => ({ x, y }))
}

function liveSetup(input: Omit<ScoreInput, 'rules' | 'komi'>) {
  const board = boardFromMoves(input.boardSize, input.handicap, input.moves)
  const dead = new Set(input.dead.map(key))
  const setup: SetupStones = { black: [], white: [] }
  let deadBlack = 0
  let deadWhite = 0
  signMapOf(board).forEach((row, y) =>
    row.forEach((sign, x) => {
      if (sign === 0) return
      const isDead = dead.has(key({ x, y }))
      if (sign === 1) isDead ? deadBlack++ : setup.black.push({ x, y })
      else isDead ? deadWhite++ : setup.white.push({ x, y })
    }),
  )
  return { board, setup, deadBlack, deadWhite }
}

export function scoreGame(input: ScoreInput): ScoreBreakdown {
  const { board, setup, deadBlack, deadWhite } = liveSetup(input)
  const area = countArea(input.boardSize, setup)
  const caps = capturesOf(board)
  const side = (stones: number, areaN: number, prisoners: number, komi: number): SideScore => {
    const territory = areaN - stones
    const total = input.rules === 'chinese' ? stones + territory + komi : territory + prisoners + komi
    return { stones, territory, prisoners: input.rules === 'chinese' ? 0 : prisoners, komi, total }
  }
  const black = side(setup.black.length, area.black, caps.black + deadWhite, 0)
  const white = side(setup.white.length, area.white, caps.white + deadBlack, input.komi)
  return { rules: input.rules, black, white, result: formatResult(black.total - white.total) }
}
```

  `ownershipMap`: con el `setup` vivo, `boardFromMoves(boardSize, 0, [], setup)` y el mismo flood-fill de `countArea` (región vacía que linda con un solo color); devolver `(-1|0|1)[][]` indexado `[y][x]`. Si hace falta, extraer el flood-fill de `territory.ts` a una función interna compartida para no duplicarlo (sin cambiar el comportamiento de `countArea`; sus tests existentes deben seguir pasando).

- [ ] **Step 3:** `npm test -w @tengen/go-rules && npm run typecheck` → PASS.
- [ ] **Step 4:** commit `feat(online): conteo por reglas chinas y japonesas con muertas (scoreGame)`.

---

### Task 2: fase `scoring` en la sala (`room.ts`)

**Files:**
- Modify: `packages/go-rules/src/room.ts`, `packages/go-rules/tests/room.test.ts`

**Interfaces:**
- Consumes: Task 1 (`scoreGame`, `chainAt`, `ScoreBreakdown`, `Vertex`).
- Produces (cambios exactos sobre los tipos actuales):

```ts
import type { Rules } from '@tengen/engine/types'
export interface RoomConfig { /* …actual… */ rules?: Rules }
export const SCORING_TIMEOUT_MS = 5 * 60 * 1000
export type RoomEvent =
  | /* …actuales… */
  | { seq: number; at: number; type: 'scoring' }
  | { seq: number; at: number; type: 'dead-toggled'; color: StoneColor; x: number; y: number }
  | { seq: number; at: number; type: 'accepted'; color: StoneColor }
  | { seq: number; at: number; type: 'resumed'; by: StoneColor | 'timeout' }
  | { seq: number; at: number; type: 'ended'; result: string; score?: ScoreBreakdown }
export type Intent =
  | /* …actuales… */
  | { type: 'toggle-dead'; x: number; y: number; seq: number }
  | { type: 'accept'; seq: number }
  | { type: 'resume'; seq: number }
export type RejectReason = /* …actuales… */ | 'scoring' | 'not-scoring'
export interface RoomState {
  /* …actual… */
  phase: 'waiting' | 'playing' | 'scoring' | 'ended'
  rules: Rules                         // config.rules ?? 'chinese'
  dead: Vertex[]                       // muertas marcadas (solo en scoring)
  accepted: Record<StoneColor, boolean>
  scoringSince?: number                // at del último scoring/dead-toggled/accepted
  movesAtResume: number                // moves.length al último started/resumed
  score?: ScoreBreakdown               // del ended por conteo
}
export function scoringDeadline(state: RoomState): number | undefined
export function effectiveRules(config: RoomConfig): Rules
```

Reglas:
- `project`: `started` → `movesAtResume = 0`. `scoring` → `phase:'scoring'`, `dead:[]`, `accepted:{black:false,white:false}`, `scoringSince=at`, `toPlay` indefinido. `dead-toggled` → alterna la cadena `chainAt(...)` en `dead` (si TODAS sus piedras están en `dead` las quita; si no, agrega las que falten), resetea `accepted`, `scoringSince=at`. `accepted` → `accepted[color]=true`, `scoringSince=at`. `resumed` → `phase:'playing'`, `dead:[]`, `accepted` en falso, `scoringSince` indefinido, `turnStartedAt=at`, `movesAtResume = moves.length`. `ended` → además `score = ev.score`. `toPlay = currentTurn(...)` solo si `phase === 'playing'`.
- `validateIntentLocally`: lista blanca de los 6 tipos (otro → `illegal`); `waiting` → `not-started`; `ended` → `game-over`; `seq` → `stale`; en `playing`: `toggle-dead`/`accept`/`resume` → `not-scoring`; en `scoring`: `move`/`pass` → `scoring`; `toggle-dead` fuera de rango o sobre punto vacío → `illegal`; `accept` si `accepted[color]` ya es `true` → `illegal`; `resign` válido en `playing` y `scoring` sin chequeo de turno.
- `reduce`: en `playing`, tras el `move`/`pass`, si `isGameOverByTwoPasses(moves.slice(state.movesAtResume))` → emite `scoring` (seq+1) en vez de `ended`. En `scoring`: `toggle-dead` → `[dead-toggled{color,x,y}]`; `accept` → `[accepted{color}]` y, si el otro color ya había aceptado, además `ended{result: score.result, score}` con `scoreGame({ boardSize, handicap, moves, dead, rules: state.rules, komi })`; `resume` → `[resumed{by: color}]`; `resign` → como hoy.
- `flagDeadline`: `undefined` salvo `phase === 'playing'` (ya es así; verificar).
- `scoringDeadline(state)` = `phase === 'scoring' && scoringSince !== undefined ? scoringSince + SCORING_TIMEOUT_MS : undefined`.
- `onAlarm(events, now)`: `playing` → igual que hoy. `scoring` y `now ≥ scoringDeadline`: exactamente un color aceptado → `[ended{result: (aceptado === 'black' ? 'B' : 'W') + '+F'}]`; ninguno → `[resumed{by:'timeout'}]`. Si no vence → `[]`.

- [ ] **Step 1: tests (fallan)** en `room.test.ts` (reusar los helpers existentes del archivo para crear sala, unir guest e intenciones):
  1. dos pases → evento `scoring` (no `ended`); `project`: `phase:'scoring'`, `flagDeadline` `undefined`.
  2. `toggle-dead` sobre una piedra → `dead` contiene su cadena entera; segundo toggle la quita; sobre vacío → `illegal`.
  3. **Review Focus 2:** negro acepta, blanco marca → `accepted` ambos en falso y `scoringDeadline` = `at` del toggle + 5 min.
  4. ambos aceptan (sin muertas, partida real con komi 6,5 y `rules:'japanese'`) → `ended` con `result 'W+0.5'` y `score.white.total === 29.5`; con `rules` ausente → `'W+1.5'` (**Review Focus 5**).
  5. `accept` repetido → `illegal`; `move` en `scoring` → `scoring`; `accept` en `playing` → `not-scoring`.
  6. `resume` → `phase:'playing'`, `dead` vacío, `toPlay` = `currentTurn`, y con reloj `turnStartedAt` = `at` del `resumed` (el reloj del que juega no descontó el tiempo del conteo).
  7. **Review Focus 1:** tras `resume`, UN pase → sigue `playing`; el segundo pase consecutivo → `scoring`.
  8. **Review Focus 4:** `resign` en `scoring` → `ended 'B+R'` si se rinde Blanco.
  9. `onAlarm` en `scoring`: antes del plazo → `[]`; vencido con solo Negro aceptado → `ended 'B+F'`; vencido sin aceptados → `resumed{by:'timeout'}`.
- [ ] **Step 2:** implementar. **Step 3:** `npm test -w @tengen/go-rules && npm run typecheck` → PASS (typecheck de worker y web también compila contra los tipos nuevos; si el `switch` de algún consumidor deja de ser exhaustivo, ajustarlo sin cambiar comportamiento).
- [ ] **Step 4:** commit `feat(online): fase de conteo con muertas, aceptación y reanudación en la sala`.

---

### Task 3: Durable Object — alarm de conteo y `rules` en la creación

**Files:**
- Modify: `apps/worker/src/online/gameRoom.ts`, `apps/worker/src/online/rooms.ts`, `apps/worker/tests/gameRoom.test.ts`

**Interfaces:**
- Consumes: Task 2 (`scoringDeadline`, `onAlarm`, fase `scoring`, `RoomConfig.rules`).

- [ ] **Step 1: tests (fallan)** en `gameRoom.test.ts` (patrón existente: `SELF.fetch`, `runInDurableObject`, `runDurableObjectAlarm`; para vencer plazos, retroceder los `at` guardados — ruling R5 de la etapa 1):
  1. `POST /api/rooms` con `rules:'japanese'` → 201; con `rules:'aga'` → 400; sin `rules` → 201.
  2. dos pases por WebSocket → todos reciben `scoring`; la alarm queda en `scoringSince + 5 min`.
  3. conteo con solo el creador aceptado, `at` retrocedidos 6 min, `runDurableObjectAlarm` → difunde `ended` con `result` `'<color del creador>+F'`, y la alarm pasa a +30 días.
  4. conteo sin aceptados vencido → difunde `resumed{by:'timeout'}`; con reloj, la alarm vuelve a `flagDeadline`.
- [ ] **Step 2: implementar:**
  - `rooms.ts`: `rules` opcional; si viene debe ser `'chinese'` o `'japanese'`, si no → `null` (400). Se guarda en el `RoomConfig`.
  - `gameRoom.ts` `reschedule`: `scoring` → `scoringDeadline(state)`. `alarm()`: tratar `scoring` igual que `playing` (llamar `onAlarm`, persistir, difundir con `serverNow`, reprogramar).
- [ ] **Step 3:** `npm test -w @tengen/worker && npm run typecheck` → PASS.
- [ ] **Step 4:** commit `feat(online): alarm de 5 minutos del conteo y reglas en la creación de sala`.

---

### Task 4: formulario, textos y SGF con reglas

**Files:**
- Modify: `apps/web/src/ui/NewGameForm.tsx`, `apps/web/tests/NewGameForm.test.tsx`, `apps/web/src/online/roomText.ts`, `apps/web/src/online/roomSgf.ts`
- Create: `apps/web/tests/roomText.test.ts` (si no existe un test de estos textos)

**Interfaces:**
- Consumes: Task 2 (tipos). Produces: `resultText(result)` con `F`; `rejectMessage` con `scoring`/`not-scoring`; `scoreLines(score: ScoreBreakdown): { black: string; white: string }`.

- [ ] **Step 1: tests (fallan):**
  - `NewGameForm` en modo online muestra el grupo **Reglas**; "Empezar" llama `onStartOnline` con `rules` (`'japanese'` si se eligió) y komi 6,5 por defecto en japonesas; el resumen plegado incluye "japonesas"/"chinas".
  - `resultText('B+F')` → `'Negro gana por abandono'`; `rejectMessage('scoring')` → `'Estamos contando: marcá las muertas, aceptá o seguí jugando'`; `rejectMessage('not-scoring')` → `'Eso solo se puede durante el conteo'`.
  - `scoreLines` japonesas (partida real) → `{ black: 'Negro: 28 territorio + 1 prisionero = 29', white: 'Blanco: 22 territorio + 1 prisionero + 6,5 komi = 29,5' }`; chinas → `{ black: 'Negro: 15 piedras + 28 territorio = 43', white: 'Blanco: 16 piedras + 22 territorio + 6,5 komi = 44,5' }` (singular/plural correcto: "1 prisionero", "2 prisioneros"; decimales con coma).
  - `roomToSgf` de una sala `rules:'japanese'` contiene `RU[Japanese]`; sin `rules` → `RU[Chinese]`.
- [ ] **Step 2:** implementar (en `NewGameForm`, quitar la exclusión de reglas del modo online y agregar `rules` al `RoomConfig` emitido; en `roomSgf`, `rules: effectiveRules(state.config)`).
- [ ] **Step 3:** `npm test -w @tengen/web && npm run typecheck` → PASS. **Step 4:** commit `feat(online): reglas elegibles, textos de conteo y RU en el SGF`.

---

### Task 5: modo conteo en `OnlineGameView`

**Files:**
- Modify: `apps/web/src/ui/OnlineGameView.tsx`, `apps/web/tests/OnlineGameView.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 (`scoreGame`, `ownershipMap`, `scoringDeadline`, `scoreLines`, textos). Estado de conexión existente (`conn.serverOffsetMs`, `send`).

- [ ] **Step 1: tests (fallan)** (jsdom, FakeSocket existente):
  1. `scoring` recibido → el rail muestra "Conteo", las líneas de `scoreLines` en vivo, botones **Aceptar** y **Seguir jugando**; el tablero recibe `dimmedVertices` con las muertas y un `paintMap` de `ownershipMap`.
  2. clic en una piedra → sale `intent toggle-dead {x,y,seq}`; clic en vacío → no sale nada.
  3. **Aceptar** → sale `accept`; con `accepted` propio el botón queda deshabilitado y dice "Aceptaste, esperando al rival"; con `accepted` del rival → "El rival aceptó".
  4. **Seguir jugando** → sale `resume`.
  5. cuenta regresiva de 5 min desde `scoringDeadline` (corregida con `serverOffsetMs`).
  6. **Review Focus 3:** `welcome` que ya trae `scoring` + `dead-toggled` + `accepted` (reconexión) → mismas muertas, mismo estado de aceptación, misma cuenta regresiva.
  7. espectador en `scoring` → ve conteo y marcas, sin botones.
  8. `ended` con `score` → resultado + las dos líneas de `scoreLines`; `ended` `'W+F'` → "Blanco gana por abandono".
- [ ] **Step 2:** implementar con los átomos/moléculas existentes (sistema `.kntor-design-atomic/system.md`; sin CSS ad-hoc). `dimmedVertices` y `paintMap` son props de `BoundedGoban` de `@sabaki/shudan` (vértices `[x,y]`, `paintMap[y][x]` en −1..1).
- [ ] **Step 3:** `npm test -w @tengen/web && npm run typecheck` → PASS. **Step 4:** commit `feat(online): modo conteo con marcado de muertas, aceptación y desglose`.

---

### Task 6: verificación y deploy

- [ ] **Step 1:** `npm run typecheck && npm test && npm run build -w @tengen/web` → verde.
- [ ] **Step 2:** `wrangler dev` (con `.dev.vars` de prueba, borrado al terminar) y dos orígenes en Chrome: partida japonesa → dos pases → marcar una muerta → el rival ve la marca → aceptar ambos → desglose; otra partida: seguir jugando y volver a contar; esperar 5 min con un solo aceptado → `+F`.
- [ ] **Step 3:** merge a `main` y `wrangler deploy` (confirmado por Edgar para esta etapa).
