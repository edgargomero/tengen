# Partidas online (etapa 1) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** crear una partida, compartir la URL y jugar en tiempo real humano vs humano (+ espectadores), con reloj autoritativo y conteo por área.

**Architecture:** un Durable Object `GameRoom` por partida (SQLite + WebSocket Hibernation) guarda un log de eventos append-only y es autoritativo en turnos, legalidad y reloj. La lógica es una función pura (`reduce`/`project`) en un paquete compartido `@tengen/go-rules`, que usan el DO y la SPA (el cliente pre-valida con el mismo código). La SPA agrega `/online/:roomId`.

**Tech Stack:** Cloudflare Workers + Durable Objects (Hibernation API), Hono, Preact + preact-router, `@sabaki/go-board`, Vitest (`@cloudflare/vitest-pool-workers` en el worker, jsdom en web).

**Spec:** `docs/superpowers/specs/2026-09-30-partidas-online-design.md`

## Global Constraints

- Servidor autoritativo: el cliente solo envía intenciones `move {x,y,seq}` / `pass {seq}` / `resign {seq}`.
- Una jugada ilegal nunca se juega: el cliente no la envía (y dice por qué); el servidor la rechaza; el log nunca contiene un `move` ilegal. Ko simple + suicidio prohibido vía `validateMove`.
- Reloj con `initialClockState`/`applyElapsed` de `packages/engine/src/clock/clock.ts`; sin compensación de latencia; la desconexión no detiene el reloj.
- Fin por dos pases → `countArea` + komi. Reglas `chinese`, komi por defecto 7.
- Sin cuentas: URL = invitación (roomId aleatorio 128 bits base64url); asiento protegido por `seatToken`; `playerId` anónimo en `localStorage` registrado en `created`/`joined` (preparación etapa 2).
- Tope 50 conexiones por sala; mensaje máximo 1 KB; rate limit de creación con `LIMITER`.
- Sala terminada se borra a los 30 días; sala que nunca empezó, a las 24 h.
- La pantalla online no usa el motor ni `ModelGate` (funciona sin WebGPU).
- Español en UI, commits y docs; identificadores en inglés. Commits nuevos (nunca `--amend`), stage por nombre.

## Review Focus

1. **El celular se duerme en byoyomi y vuelve:** al reconectar, el reloj mostrado sale del `sync` del servidor, no de la cuenta local vieja (test en Task 5).
2. **Doble toque / dos pestañas del mismo jugador:** solo entra una jugada (`seq`); la segunda recibe `rejected: stale` sin romper la UI (tests en Task 2 y Task 5).
3. **El rival nunca entra:** el creador ve la pantalla de espera con el link, no un error ni un loop de reconexión; la sala expira a las 24 h (tests en Task 3 y Task 6).
4. **Un tercero abre el link antes que el amigo:** el amigo queda de espectador y la UI lo dice explícitamente ("Esta partida ya tiene dos jugadores: estás mirando") (test en Task 6).
5. **Partida con handicap:** empieza Blanco y el reloj que corre es el de Blanco (test en Task 2).

---

### Task 1: paquete `@tengen/go-rules` (traslado sin cambio de comportamiento) + subpath `@tengen/engine/clock`

**Files:**
- Create: `packages/go-rules/package.json`, `packages/go-rules/tsconfig.json`, `packages/go-rules/vitest.config.ts`
- Move (con `git mv`): `apps/web/src/game/{rules,coords,territory,endgame}.ts` → `packages/go-rules/src/`; `apps/web/tests/{rules,territory,endgame}.test.ts` → `packages/go-rules/tests/` (el que exista de `endgame`; si su test tiene otro nombre, moverlo igual).
- Create: `packages/go-rules/src/index.ts`
- Modify: todos los importadores de esos módulos en `apps/web/src` y `apps/web/tests` (hoy ~15 archivos: `grep -rln "game/rules\|game/coords\|game/territory\|game/endgame" apps/web`).
- Modify: `apps/web/package.json` (dep `"@tengen/go-rules": "*"`), `packages/engine/package.json` (export `./clock`).

**Interfaces:**
- Produces: `import { boardFromMoves, validateMove, applyMove, currentTurn, handicapVertices, signMapOf, capturesOf, isMoveSequenceLegal, type SetupStones, colorToSign, signToColor, engineToSabakiVertex, sabakiToEngineVertex, countArea, formatResult, isGameOverByTwoPasses } from '@tengen/go-rules'` y `import { initialClockState, applyElapsed } from '@tengen/engine/clock'`.

- [ ] **Step 1:** Crear `packages/go-rules/package.json`:

```json
{
  "name": "@tengen/go-rules",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@sabaki/go-board": "^1.4.3", "@tengen/engine": "*" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^3.0.0" }
}
```

`tsconfig.json`: copiar el de `packages/engine/tsconfig.json` (strict + noUncheckedIndexedAccess) ajustando `include` a `["src", "tests"]`. `vitest.config.ts`: `export default { test: { environment: 'node' } }`.

- [ ] **Step 2:** `git mv` de los 4 módulos y sus tests. Crear `src/index.ts` con `export * from './rules'`, `'./coords'`, `'./territory'`, `'./endgame'`. Dentro del paquete, los imports relativos (`./coords`, `./rules`) no cambian; los tests pasan a importar de `'../src/<modulo>'`.

- [ ] **Step 3:** En `packages/engine/package.json` agregar `"./clock": "./src/clock/clock.ts"` a `exports`. Verificar que `clock.ts` solo importe `../types` (tipos): así el Worker no arrastra onnxruntime.

- [ ] **Step 4:** Reemplazar en `apps/web/src` y `apps/web/tests` cada `from '../game/rules'`, `'./rules'` (dentro de `game/`), `'../src/game/rules'`, etc. — y lo mismo para `coords`, `territory`, `endgame` — por `from '@tengen/go-rules'`. Agregar la dep en `apps/web/package.json` y correr `npm install` en la raíz.

- [ ] **Step 5:** Verificar sin cambios de comportamiento:

Run: `npm run typecheck && npm test -w @tengen/go-rules && npm test -w @tengen/web`
Expected: todo verde; el total de tests web + go-rules = el total previo de web (871) — mismo número de tests, solo repartidos.

- [ ] **Step 6:** Commit: `git add packages/go-rules packages/engine/package.json apps/web package-lock.json` (revisar `git status` antes: nada ajeno) → `refactor: reglas, conteo y fin de partida a @tengen/go-rules; subpath @tengen/engine/clock`.

---

### Task 2: lógica pura de la sala (`reduce` / `project`)

**Files:**
- Create: `packages/go-rules/src/room.ts`, `packages/go-rules/tests/room.test.ts`
- Modify: `packages/go-rules/src/index.ts` (`export * from './room'`)

**Interfaces:**
- Consumes: Task 1 (`boardFromMoves`, `validateMove`, `currentTurn`, `countArea`, `formatResult`, `@tengen/engine/clock`).
- Produces (exacto):

```ts
import type { BoardSize, ClockConfig, ClockState, StoneColor } from '@tengen/engine'

export type SeatRole = 'creator' | 'guest'
export interface RoomConfig {
  boardSize: BoardSize
  komi: number
  handicap: number
  clock?: ClockConfig
  creatorColor: StoneColor | 'nigiri'
}
export type RoomEvent =
  | { seq: number; at: number; type: 'created'; config: RoomConfig; playerId: string }
  | { seq: number; at: number; type: 'joined'; seat: SeatRole; playerId: string }
  | { seq: number; at: number; type: 'started'; creatorColor: StoneColor }
  | { seq: number; at: number; type: 'move'; color: StoneColor; x: number; y: number; clock?: ClockState }
  | { seq: number; at: number; type: 'pass'; color: StoneColor; clock?: ClockState }
  | { seq: number; at: number; type: 'resign'; color: StoneColor }
  | { seq: number; at: number; type: 'timeout'; color: StoneColor }
  | { seq: number; at: number; type: 'ended'; result: string }
export type Intent =
  | { type: 'move'; x: number; y: number; seq: number }
  | { type: 'pass'; seq: number }
  | { type: 'resign'; seq: number }
export type RejectReason = 'stale' | 'not-a-player' | 'not-started' | 'game-over' | 'not-your-turn' | 'illegal' | 'ko' | 'suicide' | 'occupied'
export interface RoomState {
  config: RoomConfig
  phase: 'waiting' | 'playing' | 'ended'
  colors?: Record<SeatRole, StoneColor>
  moves: import('@tengen/engine').Move[]   // jugadas reales (handicap aparte), incluye pases
  toPlay?: StoneColor
  turnStartedAt?: number
  clocks?: Record<StoneColor, ClockState>
  result?: string
  nextSeq: number
}
export function project(events: readonly RoomEvent[]): RoomState
export function reduce(events: readonly RoomEvent[], seat: SeatRole | 'spectator', intent: Intent, now: number): { events: RoomEvent[] } | { rejected: RejectReason }
export function joinSeat(events: readonly RoomEvent[], playerId: string, now: number, rng?: () => number): { seat: SeatRole; events: RoomEvent[] } | null
export function onAlarm(events: readonly RoomEvent[], now: number): RoomEvent[]
export function flagDeadline(state: RoomState): number | undefined
export function createRoom(config: RoomConfig, playerId: string, now: number): RoomEvent[]
export function validateIntentLocally(state: RoomState, seat: SeatRole | 'spectator', intent: Intent): RejectReason | null
```

Reglas de la lógica (el implementador las codifica; cada una con su test):
- `createRoom` → `[created{seq:0}]`. `joinSeat`: si no hay `joined` de guest y el `playerId` no es el del creador → `joined{guest}` + `started`; el `started` resuelve `creatorColor` (si `nigiri`, `rng() < 0.5 ? 'black' : 'white'`; `rng` por defecto `Math.random`). Si el `playerId` es el del creador o ya hay guest → `null` (el llamador decide espectador / reconexión por token).
- `project`: reproduce eventos; `toPlay = currentTurn(handicap, moves)` (handicap ≥ 2 → Blanco primero); `turnStartedAt` = `at` del `started` o del último `move`/`pass`; relojes = `initialClockState` al `started`, luego el `clock` del evento de cada jugada.
- `validateIntentLocally` (compartida con el cliente): `seat === 'spectator'` → `not-a-player`; fase `waiting` → `not-started`; `ended` → `game-over`; `intent.seq !== state.nextSeq` → `stale`; color del asiento ≠ `toPlay` (salvo `resign`, permitido en cualquier turno) → `not-your-turn`; en `move`, `validateMove(boardFromMoves(...), color, {x,y})` → `overwrite`→`occupied`, `ko`→`ko`, `suicide`→`suicide`; fuera de rango → `illegal`.
- `reduce`: primero `validateIntentLocally`; si pasa, con reloj: `applyElapsed(clock, config.clock, now − turnStartedAt)`; si `timedOut` → devuelve `[timeout, ended{result: color==='black' ? 'W+T' : 'B+T'}]` (la jugada NO se registra); si no → el evento `move`/`pass` con el `clock` resultante. Dos `pass` seguidos → además `ended` con `formatResult(black − (white + komi))` usando `countArea(boardSize, setupFromBoard(board))`. `resign` → `[resign, ended{'W+R'|'B+R'}]`.
- `flagDeadline(state)`: sin reloj o no `playing` → `undefined`; si no, `turnStartedAt + (inByoyomi ? byoyomiPeriodsRemaining*byoyomiPeriodMs : mainTimeRemainingMs + byoyomiPeriods*byoyomiPeriodMs)` del color en turno.
- `onAlarm(events, now)`: si `playing` y `now ≥ flagDeadline` → `[timeout, ended]`; si no → `[]` (alarm espuria o temprana).

- [ ] **Step 1: Tests (fallan).** En `room.test.ts`, con `const T0 = 1_000_000` y configs 9×9 komi 7:
  1. `createRoom` + `joinSeat(guest)` → `started`; `project` da `phase:'playing'`, `toPlay:'black'`.
  2. nigiri con `rng = () => 0.1` → creador negro; `() => 0.9` → blanco.
  3. `joinSeat` del mismo `playerId` del creador → `null`; tercer `playerId` tras guest → `null`.
  4. jugada válida del negro → `move` con `seq` correcto; `nextSeq` avanza.
  5. **Review Focus 2:** dos intenciones con el mismo `seq` → la segunda `rejected: 'stale'`.
  6. jugada del color que no está en turno → `not-your-turn`; espectador → `not-a-player`; antes de `started` → `not-started`.
  7. punto ocupado → `occupied`; suicidio → `suicide`; ko simple (armar un ko en 9×9 y retomar de inmediato) → `ko`.
  8. **Review Focus 5:** handicap 2 en 19×19 → `toPlay:'white'`, y con reloj el que se descuenta es el de Blanco.
  9. reloj `{mainTimeMs: 60000, byoyomiPeriods: 3, byoyomiPeriodMs: 30000}`: jugar a los 10 s → main 50 s; jugar pasado el main → `inByoyomi` con 3 períodos; exceder un período → 2 períodos; exceder todo → `timeout` + `ended 'W+T'` y **sin** evento `move`.
  10. `flagDeadline` = instante exacto del agotamiento; `onAlarm` antes → `[]`, en/después → `timeout` + `ended`.
  11. dos pases seguidos → `ended` con el resultado de `countArea` + komi (posición armada con muros para un resultado conocido, p. ej. `B+2.0`).
  12. `resign` fuera de turno → aceptado, `ended 'B+R'` si renuncia Blanco.
  13. tras `ended`, cualquier intención → `game-over`.

Run: `npm test -w @tengen/go-rules -- room` → FAIL (módulo inexistente).

- [ ] **Step 2: Implementar** `room.ts` según las interfaces y reglas de arriba. Helper interno `setupFromBoard(board)` que recorre `signMapOf(board)` y arma `SetupStones`.

- [ ] **Step 3:** Run: `npm test -w @tengen/go-rules && npm run typecheck` → PASS.

- [ ] **Step 4:** Commit `feat(online): lógica pura de la sala (eventos, reloj autoritativo, fin por área)`.

---

### Task 3: Durable Object `GameRoom` + rutas `/api/rooms`

**Files:**
- Create: `apps/worker/src/online/gameRoom.ts`, `apps/worker/src/online/rooms.ts` (router Hono), `apps/worker/tests/gameRoom.test.ts`
- Modify: `apps/worker/src/index.ts` (binding en `Env`, `app.route('/api/rooms', roomsApp)` ANTES del fallback de ASSETS, `export { GameRoom }`), `apps/worker/wrangler.jsonc`, `apps/worker/package.json` (dep `@tengen/go-rules`).

**Interfaces:**
- Consumes: Task 2 completo.
- Produces (protocolo de red, JSON por WebSocket):
  - `POST /api/rooms` body `{ config: RoomConfig, playerId: string }` → `201 { roomId, seatToken }`; `400` config inválida; `429` rate limit.
  - `GET /api/rooms/:id` → `200 { exists: true }` / `404` (el cliente lo consulta antes de conectar).
  - `GET /api/rooms/:id/ws?playerId=&token=&lastSeq=` → `101`; `404` si la sala no existe.
  - Servidor→cliente: `{ t: 'welcome', seat: SeatRole | 'spectator', seatToken?: string, events: RoomEvent[] }` (eventos desde `lastSeq+1`, o todos) · `{ t: 'events', events: RoomEvent[] }` · `{ t: 'rejected', reason: RejectReason }` · `{ t: 'presence', creator: boolean, guest: boolean }`.
  - Cliente→servidor: `{ t: 'intent', intent: Intent }`.

- [ ] **Step 1:** `wrangler.jsonc`: agregar

```jsonc
"durable_objects": { "bindings": [{ "name": "GAME_ROOM", "class_name": "GameRoom" }] },
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameRoom"] }]
```

y en `Env`: `GAME_ROOM: DurableObjectNamespace<GameRoom>`.

- [ ] **Step 2: Tests (fallan)** en `gameRoom.test.ts` con `SELF.fetch` y `runInDurableObject` de `cloudflare:test`:
  1. `POST /api/rooms` → 201 con `roomId` de ≥ 22 chars base64url y `seatToken`; `GET /api/rooms/:id` → 200, y con un id inexistente → 404.
  2. WS del creador con su token → `welcome` con `seat:'creator'` y el evento `created`.
  3. WS de un segundo `playerId` sin token → `welcome` `seat:'guest'` con `seatToken` nuevo; ambos sockets reciben `events` con `joined`+`started`.
  4. tercer `playerId` → `seat:'spectator'`, sin `seatToken`; su `intent` → `rejected: 'not-a-player'`.
  5. jugada válida del que está en turno → ambos (y el espectador) reciben el mismo `move`.
  6. reconexión con token y `lastSeq` → `welcome` solo con los eventos posteriores.
  7. **Review Focus 3:** sala creada sin guest → `runInDurableObject` verifica alarm programada a +24 h; al ejecutarla (`runDurableObjectAlarm`) la sala queda borrada y `GET …/ws` → 404.
  8. con reloj: tras `started` hay alarm en `flagDeadline`; ejecutarla con el tiempo vencido difunde `timeout`+`ended`; tras `ended` la alarm pasa a +30 días.
  9. mensaje > 1 KB o JSON inválido → se ignora (socket sigue abierto); conexión 51 → `close(1013)`.

Run: `npm test -w @tengen/worker -- gameRoom` → FAIL.

- [ ] **Step 3: Implementar `rooms.ts`:** `POST /` valida `config` (boardSize ∈ {9,13,19}; `komi` finito; `handicap` 0 o 2..9 solo en 19×19; `clock` opcional con enteros ≥ 0; `creatorColor` válido) y `playerId` (string 8..64), aplica `c.env.LIMITER.limit({ key: ip })`, genera `roomId = base64url(crypto.getRandomValues(new Uint8Array(16)))`, llama al DO `stub.create(config, playerId)` (RPC) que devuelve el `seatToken`. `GET /:id` responde según `stub.exists()` (RPC: hay `events` en storage). `GET /:id/ws` exige `Upgrade: websocket` y delega `stub.fetch(request)`.

- [ ] **Step 4: Implementar `GameRoom extends DurableObject<Env>`:**
  - Estado persistido con `this.ctx.storage.put/get`: `events: RoomEvent[]`, `tokens: { creator?: string; guest?: string }`, `creatorPlayerId`.
  - `create(config, playerId)`: guarda `createRoom(...)`, token del creador, alarm `now + 24h`.
  - `fetch` (upgrade): resuelve asiento → token válido para `creator`/`guest` = ese asiento; si no, `joinSeat` (nuevo guest → token nuevo, persiste eventos, difunde); si no → espectador. `this.ctx.acceptWebSocket(server)`, `server.serializeAttachment({ seat, playerId })`, envía `welcome`, difunde `presence`. Tope 50 (`this.ctx.getWebSockets().length`).
  - `webSocketMessage(ws, msg)`: descartar si `typeof msg !== 'string' || msg.length > 1024` o JSON inválido; `reduce(events, seat, intent, Date.now())`; si `rejected` → solo a ese socket; si no → persistir, difundir `events` a todos, reprogramar alarm: `flagDeadline(project(events))` si `playing`, `+30 días` si `ended`, o borrar alarm.
  - `alarm()`: si `waiting` y pasó 24 h, o `ended` y pasaron 30 días → `this.ctx.storage.deleteAll()` + cerrar sockets; si `playing` → `onAlarm(...)`, persistir, difundir, reprogramar.
  - `webSocketClose/Error` → difundir `presence`.

- [ ] **Step 5:** Run: `npm test -w @tengen/worker && npm run typecheck` → PASS. Verificar con `npx wrangler deploy --dry-run --outdir /tmp/tengen-dry` (desde `apps/worker`) que el bundle no incluye `onnxruntime` (`grep -c onnxruntime /tmp/tengen-dry/*.js` → 0).

- [ ] **Step 6:** Commit `feat(online): Durable Object GameRoom y rutas /api/rooms`.

---

### Task 4: cliente de sala (identidad + conexión)

**Files:**
- Create: `apps/web/src/online/identity.ts`, `apps/web/src/online/roomClient.ts`, `apps/web/tests/roomClient.test.ts`

**Interfaces:**
- Consumes: protocolo de Task 3; `project`, `validateIntentLocally` de Task 2.
- Produces:

```ts
export function getPlayerId(storage: StorageLike): string          // crea y persiste 'tengen.playerId' si falta
export function getSeatToken(storage: StorageLike, roomId: string): string | undefined   // 'tengen.seat.<roomId>'
export function setSeatToken(storage: StorageLike, roomId: string, token: string): void
export async function createRoom(config: RoomConfig, fetchFn?: FetchLike, storage?: StorageLike): Promise<{ roomId: string }>
export interface RoomConnectionState {
  status: 'connecting' | 'open' | 'reconnecting' | 'not-found'
  seat?: SeatRole | 'spectator'
  events: RoomEvent[]
  lastRejected?: RejectReason
  presence?: { creator: boolean; guest: boolean }
}
export function connectRoom(roomId: string, opts: {
  storage: StorageLike
  onState(s: RoomConnectionState): void
  socketFactory?: (url: string) => WebSocket
  sleep?: (ms: number) => Promise<void>
}): { send(intent: Intent): RejectReason | null; close(): void }
```

- `send` corre `validateIntentLocally(project(events), seat, intent)` y, si hay motivo, lo devuelve SIN enviar (barrera 1 de jugadas ilegales).
- Reconexión: al cerrarse el socket (salvo `close()` explícito o `not-found`), `status:'reconnecting'` y reintento con backoff 0.5 s, 1 s, 2 s, 4 s … tope 10 s, pasando `lastSeq`; al `welcome`, concatena eventos sin duplicar (`seq`).
- Antes de abrir el socket (y antes de cada reintento), `GET /api/rooms/:id` → `404` ⇒ `status:'not-found'`, sin reintentos (un navegador no puede leer el status HTTP de un upgrade de WebSocket fallido).

- [ ] **Step 1: Tests (fallan)** con un `FakeSocket` (clase con `send`, `close`, `emit(msg)`) y `sleep` inmediato:
  1. `getPlayerId` persiste y devuelve el mismo id en la segunda llamada.
  2. `welcome` con `seatToken` → lo guarda; `onState` recibe `status:'open'` y los eventos.
  3. `send` de una jugada en punto ocupado → devuelve `'occupied'` y el socket no recibió nada.
  4. **Review Focus 2:** dos `send` seguidos con el mismo `seq` → los dos salen (el estado local recién cambia al llegar el evento); el servidor responde `rejected: 'stale'` al segundo → `onState` expone `lastRejected:'stale'` y la conexión sigue abierta.
  5. **Review Focus 1:** cierre inesperado → `reconnecting`; reconexión envía `lastSeq` del último evento; el `welcome` trae eventos nuevos con reloj actualizado → el estado proyectado usa ese reloj (no el previo).
  6. `not-found` → sin reintentos.

- [ ] **Step 2:** Implementar. **Step 3:** `npx -w @tengen/web vitest run roomClient` → PASS. **Step 4:** Commit `feat(online): cliente de sala con identidad anónima y reconexión`.

---

### Task 5: "Una persona (online)" en Nueva partida + pantalla de espera

**Files:**
- Modify: `apps/web/src/ui/NewGameForm.tsx`, `apps/web/src/main.tsx` (ruta `/online/:roomId`)
- Create: `apps/web/src/ui/OnlineGameView.tsx` (esqueleto con estados `connecting`/`not-found`/`waiting`), `apps/web/tests/OnlineGameView.test.tsx`
- Modify: `apps/web/tests/NewGameForm.test.tsx`

**Interfaces:**
- Consumes: `createRoom`, `connectRoom` (Task 4).
- Produces: `<OnlineGameView roomId storage? socketFactory? />`; `NewGameForm` prop nueva `onStartOnline(config: RoomConfig): void`.

- [ ] **Step 1: Tests (fallan):**
  - `NewGameForm`: el grupo Oponente tiene una tercera opción "Una persona (online)"; al elegirla se ocultan fuerza y reglas; "Empezar" llama `onStartOnline` con `{ boardSize, komi, handicap, clock?, creatorColor }` (nigiri pasa como `'nigiri'`, sin sortear en el cliente); `rules` no viaja.
  - `OnlineGameView`: con `welcome` de creador y solo `created` → muestra "Esperando rival", el link `https://…/online/<roomId>` y botones Copiar/Compartir (`navigator.share` si existe; si no, solo Copiar); `not-found` → "Esta partida no existe o ya expiró" + botón Nueva partida.
- [ ] **Step 2:** Implementar. En `main.tsx`, `PlayApp` recibe `onStartOnline` que hace `createRoom` y `route('/online/' + roomId)`; errores de red → aviso `.notice--danger` en el formulario. Ruta `<OnlineGameView path="/online/:roomId" />` sin `ModelGate`. Estilos: solo átomos/moléculas existentes (`.card-screen`, `.notice`, `.link-button`, `.primary`, `.hint`).
- [ ] **Step 3:** `npm test -w @tengen/web && npm run typecheck` → PASS. **Step 4:** Commit `feat(online): crear partida online y pantalla de espera con link`.

---

### Task 6: partida en juego, espectador y fin

**Files:**
- Modify: `apps/web/src/ui/OnlineGameView.tsx`, `apps/web/tests/OnlineGameView.test.tsx`, `apps/web/src/styles/app.css` (solo si hace falta, con tokens)

**Interfaces:**
- Consumes: Tasks 2, 4, 5; `BoundedGoban`, `signMapOf`, `boardFromMoves`, `exportSgf` + `sgfClockCodec` existentes; `formatClockMs` si se exporta de `PlayView.tsx` (moverla a `apps/web/src/game/clockFormat.ts` si hace falta compartirla, con su import actualizado en `PlayView`).

- [ ] **Step 1: Tests (fallan)** (jsdom, socket falso):
  1. `started` → tablero visible (template `.study-shell`/`.study-board`/`.study-rail`), rail con "Negro (vos)"/"Blanco (rival)", relojes, capturas y turno.
  2. clic en tu turno → sale `intent move` con el `seq` correcto; la piedra aparece recién al llegar el evento `move` (no optimista).
  3. clic en punto ocupado / suicidio / ko → no sale nada y el rail muestra el motivo en español ("Ese punto está ocupado", "Esa jugada sería suicidio", "Ko: no podés retomar enseguida").
  4. `rejected` del servidor → aviso breve en el rail; el tablero no cambia.
  5. Pasar y Rendirse envían sus intenciones; Rendirse pide confirmación en la misma pantalla (sin `confirm()` del navegador).
  6. **Review Focus 4:** `welcome` con `seat:'spectator'` → sin controles y el texto "Esta partida ya tiene dos jugadores: estás mirando".
  7. `presence` con el rival ausente → "Rival desconectado"; `status:'reconnecting'` propio → "Reconectando…".
  8. `ended` → resultado ("Negro gana por 2,0 puntos" / "por rendición" / "por tiempo") + "Descargar SGF" (contenido SGF con `RE[...]` y las jugadas) + "Nueva partida online".
  9. cuenta regresiva local del reloj en turno, recalculada desde `turnStartedAt` del estado proyectado en cada evento.
- [ ] **Step 2:** Implementar. La cuenta regresiva usa un `setInterval` de 250 ms limpiado al desmontar; el valor mostrado es `max(0, flagDeadline − Date.now())` repartido en main/byoyomi con la misma lógica de `applyElapsed` (solo display; nunca decide timeouts).
- [ ] **Step 3:** `npm test -w @tengen/web && npm run typecheck` → PASS. **Step 4:** Commit `feat(online): partida en juego, espectadores y fin con SGF`.

---

### Task 7: verificación final, gate manual y deploy

- [ ] **Step 1:** `npm run typecheck && npm test && npm run build -w @tengen/web` → todo verde.
- [ ] **Step 2:** `wrangler dev` (desde `apps/worker`, con `.dev.vars`) y prueba local en dos pestañas: crear, compartir, jugar, pasar-pasar, rendirse, tiempo agotado, espectador en una tercera pestaña.
- [ ] **Step 3:** Revisión final de todo el rango (subagent-driven: revisor final del branch).
- [ ] **Step 4: Deploy SOLO con confirmación explícita de Edgar** (la migración `v1` del Durable Object es la primera del proyecto): `npm run build -w @tengen/web` + `wrangler deploy` desde `apps/worker`; verificar `/` 200 y que `POST /api/rooms` responde 201.
- [ ] **Step 5: Gate manual de Edgar:** partida real Chrome escritorio ↔ celular por datos móviles, cortando el wifi a mitad y dejando vencer el reloj una vez.
