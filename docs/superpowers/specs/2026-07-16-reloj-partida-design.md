# Reloj de partida (tiempo principal + byoyomi) — Modo Jugar

**Fecha:** 2026-07-16 · **Estado:** aprobado por Edgar (brainstorm) · **Extiende:** Fase 2 (Modo Jugar), [roadmap](../plans/2026-07-10-tengen-v1-roadmap.md) · **Spec de producto:** [`2026-07-08-tengen-design.md`](2026-07-08-tengen-design.md)

**Precursor explícito de PvP:** esta spec es la primera mitad de "jugar una partida entre dos personas, tipo KGS" (pedido original de Edgar). La segunda mitad — Durable Objects, invitación por link, sincronización en tiempo real — es un ciclo brainstorm→spec→plan APARTE, decisión explícita tomada en el brainstorm para no mezclar dos features grandes e independientes. Esta spec existe primero porque el reloj es transversal (aplica también a vs IA, hoy) y porque su módulo de dominio se diseña, desde el vamos, para que ese futuro spec de PvP lo reuse sin reescribirlo.

## Contexto y objetivo

Hoy el dominio de Modo Jugar (`apps/web/src/game/gameConfig.ts`) no tiene ningún concepto de tiempo — ni en `GameConfig` ni en `GameTree.meta`. La única partida jugable es vs IA (`PlayView.tsx`), sin reloj, y termina por dos pases, resign, o (en el futuro spec de PvP) por desconexión — nunca por agotar el tiempo. Edgar pidió agregar reloj a **todos los modos de juego** (vs IA hoy, vs humano en el futuro spec de PvP), y que en vs IA el reloj lo respeten **ambos** — el jugador humano Y la IA, adaptando esta última cuánto calcula según el tiempo que le queda (no solo un reloj decorativo del lado humano).

**Hallazgo que cambia el riesgo de esta feature:** `MctsSearch.run({visits, maxTimeMs, batchSize, shouldAbort})` (`packages/engine/src/vendor/web-katrain/analyzeMcts.ts:1743-1776`) **ya calcula un `deadline` real y corta la búsqueda por tiempo** — no es un mecanismo a construir, es infraestructura ya heredada de web-katrain (que la necesitaba para su propia UI responsiva). Hoy `engine.ts:128,196` la llama con `maxTimeMs: 600_000` (10 min) como techo de seguridad genérico, nunca como presupuesto real por jugada. Que la IA "respete el reloj" es, en el fondo, calcular el número correcto y pasarlo ahí en vez del `600_000` fijo — no tocar el MCTS.

## Alcance

**Qué se agrega:**
- Reloj configurable (tiempo principal + byoyomi japonés) en Modo Jugar, **opcional** (toggle "Sin reloj", default: reloj activado con valores sugeridos por tamaño de tablero).
- El jugador humano pierde por tiempo si se le acaba (mismo canal de resultado que hoy usa resign/score).
- La IA respeta el mismo reloj: adapta cuánto busca por jugada al tiempo que le queda, con gestión de tiempo adaptativa (Opción B del brainstorm: cortar antes si la búsqueda ya convergió, extender si la posición es difícil) — no solo un tope duro.
- Persistencia del reloj en el SGF (propiedades estándar `TM`/`BL`/`WL`/`OB`/`OW` + dos propiedades propias para la config de byoyomi) — sobrevive recarga/reapertura, igual que el resto de la partida.
- El módulo de dominio del reloj (`ClockConfig`/`ClockState`) vive en `packages/engine` (no en `apps/web`) específicamente para que el futuro spec de PvP lo reuse desde un Durable Object en `apps/worker`.

**Qué NO se agrega (fuera de alcance, no re-litigar en el plan):**
- Modo Analizar **no** tiene reloj — no hay turnos reales ahí (explorar/revisar una posición fija), decisión explícita de Edgar en el brainstorm. Si una partida con reloj se abre en Analizar, las propiedades `BL`/`WL`/etc. se ignoran (ni se muestran ni se validan).
- PvP en sí (Durable Objects, WebSockets, invitación por link, validación autoritativa en servidor) — spec propia, futura.
- Sistemas de reloj alternativos (Fischer/incremento, byoyomi canadiense) — solo tiempo principal + byoyomi japonés en v1.
- Pausar una partida — no existe en KGS tampoco, no se agrega acá.
- Mostrar/reconstruir el reloj navegando el árbol de variaciones en Modo Jugar (`GameTreePanel`) — el reloj es del avance en vivo de la partida, no un dato a inspeccionar retroactivamente por nodo.

## Modelo de dominio (`packages/engine/src/clock/`)

Módulo puro, sin dependencias de browser ni de red — mismo espíritu que `rules.ts`/`gameTree.ts` de `apps/web` (que ya demostraron ser reusables server-side: ver hallazgo del brainstorm sobre `@sabaki/go-board`). Vive en `packages/engine` (no en `apps/web`) porque `apps/worker` no depende de `apps/web` — la misma restricción que ya aplica a `rules.ts`/`gameTree.ts` hoy, y la razón concreta por la que este módulo tiene que estar en el paquete compartido desde el día uno.

```ts
interface ClockConfig {
  mainTimeMs: number       // 0 = "byoyomi desde la primera jugada", válido
  byoyomiPeriods: number   // >= 1 si hay byoyomi
  byoyomiPeriodMs: number
}

interface ClockState {
  mainTimeRemainingMs: number
  byoyomiPeriodsRemaining: number
  inByoyomi: boolean
}

function applyElapsed(state: ClockState, config: ClockConfig, elapsedMs: number):
  { state: ClockState; timedOut: boolean }
```

**Semántica de byoyomi japonés** (la tradicional, la que usa KGS): mientras `mainTimeRemainingMs > 0`, cada jugada descuenta del pozo principal. Al agotarse, entra en byoyomi (`inByoyomi = true`): cada jugada dispone de `byoyomiPeriodMs`. Si se juega DENTRO del período, el período se recicla completo (nunca se acumula ni se pierde — siempre volvés a tener el período entero para la próxima jugada). Si se EXCEDE, se consumen tantos períodos completos como quepan en el tiempo transcurrido — regla general, no solo "un período": `periodsConsumed = Math.floor(elapsedInByoyomi / byoyomiPeriodMs)` (0 si entró dentro del período vigente), y el resto (`elapsedInByoyomi % byoyomiPeriodMs`) es lo ya transcurrido del período fresco actual. Esta regla general es la que ejercita la extensión de la IA a 2 períodos (§Gestión de tiempo de la IA): no es un caso especial, es la misma fórmula con un `elapsed` mayor. Perder más períodos de los que quedan (`periodsConsumed >= byoyomiPeriodsRemaining`) → `timedOut: true`.

`applyElapsed` es la única función que sabe de esta semántica — ni `apps/web` ni (en el futuro) el Durable Object de PvP la reimplementan; solo le pasan `elapsedMs` desde su propia fuente de tiempo (un `setInterval` local hoy, timestamps de mensajes de red mañana).

## Gestión de tiempo de la IA (Opción B, con topes explícitos)

Vive en `packages/engine/src/search/timeManagementPolicy.ts` (módulo aparte del reloj de dominio — este es específico del motor, no aplica al reloj de un jugador humano en PvP) y se integra en `engine.ts`'s `genMove`, reemplazando el `search.run()` único (líneas 126-131 hoy) por un bucle en CHUNKS — reusando el patrón que **ya existe** en `analyze()` (`engine.ts:189-203`: `while (target < opts.visits) { target += CHUNK; await search.run({visits: target, ...}) }`), no una construcción nueva.

1. **Presupuesto base:** en tiempo principal, `base = mainTimeRemainingMs / movesLeftEstimate` (constante v1: **40, fija y global — no varía por tamaño de tablero ni por fase de la partida**, piso mínimo de 1s; se autocorrige porque `mainTimeRemainingMs` decrece con el juego aunque el divisor no cambie — ver nota de tuning en §Fuera de alcance). En byoyomi, `base = byoyomiPeriodMs × 0.85` (margen de seguridad ante variabilidad del batch de inferencia — no confiar en que un chunk termine justo en el límite).
2. **Corte temprano por convergencia:** tras cada chunk, si la jugada con más visitas mantuvo su participación dentro de ±2% en los últimos 2 chunks Y ya se usó ≥25% del `base` → cortar ahí. Una jugada obvia no necesita agotar el presupuesto.
3. **Extensión por posición difícil:** si al llegar al límite de `base` las dos mejores jugadas tienen un value muy cercano (diferencia < épsilon configurable) → extender hasta `base × 1.5`, tomado del propio `mainTimeRemainingMs` (no de un pozo separado — gastar más ahora, dejando menos para después, igual que un jugador humano dudando más en un momento difícil). En byoyomi, la extensión análoga es "quemar un período extra" — tope duro: nunca más de 2 períodos en una sola jugada.
4. **Wiring:** el número final calculado por cada chunk reemplaza el `maxTimeMs: 600_000` hardcodeado — ese valor pasa a ser SOLO el techo de seguridad absoluto que `MctsSearch.run` ya clampea internamente (`Math.min(args.maxTimeMs, ENGINE_MAX_TIME_MS)`, `analyzeMcts.ts:1750`), nunca el presupuesto real.

**`Engine.genMove` — cambio de firma, 100% aditivo:**
```ts
genMove(pos: Position, opts: { level: RankLevel; clock?: { config: ClockConfig; state: ClockState } }): Promise<Move>
```
`clock` reusa los DOS tipos ya definidos arriba (`config` = ajustes fijos de la partida, `state` = tiempo restante del color que le toca mover AHORA) — sin un tercer tipo nuevo. Es opcional: si se omite (toda partida sin reloj, y toda partida vieja restaurada de `localStorage`/D1 sin ese campo), el comportamiento es **byte-idéntico al actual** — sigue usando el `search.run()` único con `maxTimeMs: 600_000`. El chunking + política de tiempo solo se activa cuando `clock` viene presente. Nótese que `movesLeftEstimate` es la constante fija (40, ver arriba) — `genMove` no necesita recibir historial de jugadas para calcular el presupuesto en v1.

## Determinismo y testing (separar "decidir" de "leer el reloj")

Punto de fondo: cuánto tiempo real transcurre no es determinista entre máquinas, pero qué decisión tomar dado un estado de búsqueda sí lo es. Por eso el algoritmo se parte en dos piezas con responsabilidades distintas — regla arquitectónica dura, documentada con un comentario explícito en el código para que nadie la rompa sin querer:

- **`timeManagementPolicy.ts` es una función pura.** Recibe `{visitShareHistory: number[], valueGapAtCutoff: number, elapsedMsSoFar: number, budgetMs: number}` (datos ya calculados — ningún `Date.now()`/`performance.now()` adentro) y devuelve `'stop' | 'continue' | { extendTo: number }`. Testeable con fixtures escritos a mano, sin RNG, sin reloj real, sin red — mismo criterio que ya se testea `rules.ts`/`gameTree.ts` en `apps/web` hoy.
- **El lector de reloj se inyecta**, no se lee directo — mismo patrón que `LocalEngine` ya usa para inyectar `evaluatorFactory` en su constructor (para mockear la red en tests). En producción, `performance.now()`; en tests, un contador falso que avanza un valor fijo por chunk — un test de integración simula "pasaron 3000ms" sin esperar 3000ms reales ni depender de la velocidad de la máquina que corre CI.
- **Los tests existentes no se ven afectados.** `mockEvaluator` (`packages/engine/tests/mcts.test.ts:10-30`) resuelve sin ningún delay simulado — confirmado leyendo el archivo. Mientras `clock` no se pase a `genMove`, el camino es el de siempre (`maxTimeMs: 600_000`, nunca se acerca a cortar nada). Cero riesgo de flakiness en los tests actuales; cero cambio de resultados en los fixtures de `tests/fixtures/reference/`.

## UI

**`NewGameForm.tsx`:** dos campos nuevos — "Tiempo principal" (minutos) y "Byoyomi" (períodos × segundos) — con un toggle **"Sin reloj"** (default: reloj ACTIVADO). Mismo patrón visual que el campo Komi existente. Valores sugeridos precargados por tamaño de tablero (editables, no forzados):

| Tablero | Tiempo principal | Byoyomi |
|---|---|---|
| 9×9 | 10 min | 5 × 30s |
| 13×13 | 20 min | 5 × 30s |
| 19×19 | 30 min | 5 × 30s |

`GameConfig.clock?: ClockConfig` — opcional, importado como tipo desde `@tengen/engine` (mismo patrón que ya usa `GameConfig` con `BoardSize`/`NetworkId`/`RankLevel`).

**`PlayView.tsx`:** reloj de cada lado visible en el panel, tickeando (`setInterval` ~250ms) solo del lado a quien le toca — usando **diferencia contra un timestamp absoluto** (`Date.now() - turnStartedAt`), no conteo de ticks, para que un tab en background/throttled se autocorrija apenas vuelve a tickear (el timeout puede detectarse tarde, nunca de forma incorrecta-temprana). Cambio visual al entrar en byoyomi (número de período visible). Al llegar a cero: mismo camino que "Rendirse" hoy — `endedRef.current = true`, resultado `B+T`/`W+T` (notación SGF estándar de derrota por tiempo, mismo canal `tree.meta.result`/`persist()` que ya usan resign y score). El tiempo que la IA consumió realmente se mide alrededor del propio `await manager.genMove(...)` — no hace falta que el motor devuelva un número nuevo.

**Reapertura/restauración con reloj activo (localStorage o "Mis partidas"):** el reloj resume desde el último snapshot persistido (remaining time del último `BL`/`WL` guardado) con un `turnStartedAt` fresco al momento de restaurar — cerrar la pestaña y reabrir no penaliza al jugador que estaba a punto de mover. Limitación aceptada y explícita (Fase A es 100% client-side, sin autoridad de servidor): esto es, en efecto, una pausa gratuita mientras la pestaña está cerrada. El futuro spec de PvP necesita autoridad de servidor real para el reloj — acá no, porque no hay nadie del otro lado a quien defraudar.

## Persistencia SGF

Se apoya en propiedades **estándar** de SGF (FF[4]), no en un formato inventado — mismo criterio que ya se usó para el análisis persistido (propiedades propias solo donde el estándar no alcanza):

| Propiedad | Nivel | Contenido |
|---|---|---|
| `TM[segundos]` | Raíz | Tiempo principal configurado (estándar SGF) |
| `TGBP[n]` | Raíz | Períodos de byoyomi configurados (propia — el estándar `OT` es texto libre no estructurado, mismo motivo por el que Fase 6 evitó JSON dentro de una propiedad) |
| `TGBT[segundos]` | Raíz | Segundos por período de byoyomi (propia) |
| `BL[segundos]` / `WL[segundos]` | Por jugada | Tiempo principal restante de Negro/Blanco tras esa jugada (estándar) |
| `OB[n]` / `OW[n]` | Por jugada | Períodos de byoyomi restantes de Negro/Blanco tras esa jugada (estándar) |

Se escriben/leen vía el mismo gancho genérico de datos extra por nodo que ya existe en `exportSgf`/`importSgf` (Fase 6) — en un módulo nuevo `game/sgfClockCodec.ts` (paralelo a `analysis/sgfAnalysisCodec.ts`, mismo patrón, sin mezclar los dos: `game/sgf.ts` sigue sin saber qué es un reloj, igual que no sabe qué es un análisis). Solo se escriben si `config.clock` está presente; ausentes en cualquier partida sin reloj (incluidas todas las existentes hoy — round-trip sin cambios).

## Manejo de errores

- SGF con propiedades de reloj corruptas o incompletas (p. ej. `BL` sin `TM` en la raíz) → se trata como "sin reloj" para esa partida, igual criterio que `decodeAnalysisFromNodeData` hoy (nunca lanza).
- `mainTimeMs = 0` sin `byoyomiPeriods` configurado → rechazado por la validación de `NewGameForm` (mismo lugar que ya valida Komi/Handicap) — o hay tiempo principal, o hay byoyomi, nunca ninguno de los dos con reloj "activado".
- Timeout de la IA (el chunk excede el techo absoluto de `ENGINE_MAX_TIME_MS`) — no debería ocurrir con la política del punto anterior, pero si ocurre, el motor devuelve la mejor jugada disponible en ese momento en vez de fallar (mismo criterio defensivo que ya tiene `search.run` con su clamp de `maxTimeMs`).

## Testing / verificación

- **`packages/engine` (nuevo):** `clock.test.ts` — transiciones puras de `ClockState`/`applyElapsed` (consumo de período, reciclado dentro del período, timeout en el último período, `mainTimeMs=0` desde el arranque). `timeManagementPolicy.test.ts` — fixtures escritos a mano para cada decisión (`stop` por convergencia, `continue`, `extendTo` por posición difícil, tope de 2 períodos en byoyomi). `engine.test.ts` ampliado — reloj falso inyectado + `mockEvaluator` existente, confirma que el chunking corta cerca del presupuesto esperado sin esperar tiempo real.
- **`apps/web` (nuevo):** `gameConfig.test.ts` ampliado (validación del campo `clock` opcional). `sgfClockCodec.test.ts` — round-trip completo (con reloj, sin reloj, corrupto → degradación a "sin reloj").
- **UI:** sin tests de componente (convención ya establecida) — verificación manual: partida con reloj corto (para no esperar de más) en los 3 tamaños, confirmar cuenta regresiva, entrada a byoyomi, derrota por tiempo del lado humano, que la IA efectivamente juega más rápido bajo presión de tiempo que con reloj holgado, cerrar/reabrir a mitad de partida con reloj activo.

## Decisiones tomadas en el brainstorm (resumen)

1. **Multiplayer online real** (no hotseat local) es el objetivo final — confirma que el reloj debe ser reusable server-side, no una feature exclusiva del cliente.
2. **Separar en dos specs** — reloj primero (transversal, sirve ya en vs IA), PvP después (construye encima). Decisión explícita para no mezclar dos features grandes.
3. **Ambos (humano e IA) respetan el reloj** — no es un reloj decorativo del lado humano; la IA adapta cuánto busca.
4. **Opción B (gestión adaptativa)**, con la determinismo/testing resuelto separando política pura de lectura de reloj — pedido explícito de Edgar, documentado en código.
5. **Reloj opcional, con default sugerido** — no rompe partidas existentes ni fuerza presión de tiempo en una partida casual.
6. **Tiempo principal + byoyomi japonés únicamente** en v1 — el estándar de facto en servidores de Go, y el único que ya tiene un concepto relacionado en el motor (metadata de KataGo).
7. **Modo Analizar queda sin reloj** — no hay turnos reales ahí.
8. **Módulo de dominio en `packages/engine`, no en `apps/web`** — para que el futuro Durable Object de PvP lo reuse sin reescribir la semántica de byoyomi.

## Fuera de alcance (recordatorio, no re-litigar en el plan)

PvP en sí (spec propia). Fischer/incremento, byoyomi canadiense. Pausar partida. Reloj en Modo Analizar. Reconstruir/mostrar el reloj navegando variaciones. Autoridad de servidor sobre el reloj (recién llega con PvP). Ajuste dinámico de `movesLeftEstimate`/umbrales de convergencia según fase de la partida (v1 usa constantes fijas, documentadas como punto de partida no definitivo).
