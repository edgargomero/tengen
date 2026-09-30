# Partidas online: elección de reglas y fase de conteo — diseño

> Estado: aprobado en conversación con Edgar el 2026-09-30. Extiende
> `2026-09-30-partidas-online-design.md` (etapa 1, ya desplegada). Donde este documento contradice
> a aquel, manda este.

## Motivo

Una partida real (sala `guafwC_XKSW9pC3vhod6Sw`) terminó `W+1.5` con conteo por área, correcto
pero incomprensible para los jugadores: la pantalla final no mostraba desglose, las reglas eran
chinas sin opción, y las capturas "no contaban". Edgar pidió: elegir las reglas y que el resultado
se calcule según ellas. Las reglas japonesas exigen resolver piedras muertas sin capturarlas (en
conteo por territorio, capturar dentro del propio territorio cuesta puntos), así que hace falta una
fase de marcar muertas; se usa también con reglas chinas.

## Decisiones (no re-litigar)

- Reglas elegibles en la partida online: **chinas** y **japonesas** (las mismas que la app ya
  ofrece contra KataGo). Komi por defecto según regla (7 chinas, 6,5 japonesas), como el
  formulario actual.
- **Fase de conteo tras dos pases**, con marcado manual de muertas por ambos jugadores y
  aceptación de los dos. "Seguir jugando" la cancela.
- **Relojes pausados** durante el conteo.
- **Límite de 5 minutos sin acuerdo** (se reinicia con cada cambio de marcas):
  - si aceptó exactamente uno → gana ese jugador por abandono (`B+F` / `W+F`);
  - si no aceptó ninguno → la partida se reanuda.
- Sin estimación automática de muertas (no hay motor en las partidas online).

## Configuración

- `RoomConfig` gana `rules: 'chinese' | 'japanese'` (tipo `Rules` de `@tengen/engine/types`).
  Un log sin `rules` (salas creadas antes de este cambio) se trata como `'chinese'`.
- `POST /api/rooms` valida `rules` ∈ {`chinese`, `japanese`} (ausente → `chinese`).
- `NewGameForm` en modo online vuelve a mostrar el grupo **Reglas**; el komi sigue su lógica
  actual por regla; `rules` viaja en el `RoomConfig`.

## Máquina de estados de la sala

Fases: `waiting → playing → scoring → ended`, más `scoring → playing` (reanudar).

### Entrada a `scoring`

Con dos `pass` consecutivos **desde el último `resumed` (o desde `started`)** la sala emite
`scoring` en vez de `ended`. Importante: tras reanudar, el pase previo a la reanudación NO cuenta
como primero de un nuevo par (si no, el primer pase después de reanudar volvería a disparar el
conteo al instante).

### Eventos nuevos (append-only, con `seq` y `at` como todos)

| Evento | Datos | Efecto en `project` |
| --- | --- | --- |
| `scoring` | — | `phase: 'scoring'`; muertas vacías; aceptaciones en falso; relojes congelados |
| `dead-toggled` | `color` (quién marcó), `x`, `y` | alterna la **cadena** (piedras conectadas del mismo color) que contiene `(x,y)` en el conjunto de muertas; borra ambas aceptaciones |
| `accepted` | `color` | marca aceptado a ese color |
| `resumed` | `by: StoneColor \| 'timeout'` | `phase: 'playing'`; borra muertas y aceptaciones; `turnStartedAt = at` del evento; turno según el orden normal de jugadas (`currentTurn`) |
| `ended` | `result` (+ `score?` desglose, ver Conteo) | igual que hoy |

### Intenciones nuevas del cliente

`toggle-dead {x, y, seq}`, `accept {seq}`, `resume {seq}`. Reglas de validación (en
`validateIntentLocally`, compartida cliente/servidor):

- Fuera de `scoring`, estas tres → `not-scoring`. En `scoring`, `move` y `pass` → `scoring`.
- `toggle-dead` sobre un punto vacío o fuera de rango → `illegal`. Cualquier jugador puede marcar
  piedras de cualquier color.
- `accept` de quien ya aceptó (sin cambios desde entonces) → `illegal` (no emite nada; el cliente
  ya deshabilita el botón en ese caso).
- `RejectReason` suma `'scoring'` y `'not-scoring'`.
- `resign` sigue permitido en cualquier fase jugable, incluida `scoring`.
- Espectador → `not-a-player` como hoy.

Cuando ambos colores quedan aceptados, `reduce` emite `ended` con el resultado del conteo.

### Reloj

- Durante `scoring` no corre ningún reloj: `flagDeadline` devuelve `undefined`.
- Al `resumed`, el reloj del color en turno corre desde el `at` del `resumed`, con el estado que
  tenía al entrar a `scoring`.

### Límite de 5 minutos (alarm del Durable Object)

- `scoringDeadline(state)` = `at` del último evento de conteo (`scoring`, `dead-toggled`,
  `accepted`) + 5 min. La alarm del DO se programa ahí mientras la fase es `scoring`.
- `onAlarm` en `scoring` con `now ≥ scoringDeadline`:
  - exactamente un color aceptado → `ended{result: '<ese color>+F'}`;
  - ninguno aceptado → `resumed{by: 'timeout'}` (y la alarm vuelve a ser la del reloj si hay).
  - (Ambos aceptados no puede ocurrir: ya habría terminado.)
- `formatResult` y el texto de la UI soportan `F` ("por abandono").

## Conteo (función pura en `@tengen/go-rules`)

`scoreGame({ boardSize, handicap, moves, dead, rules, komi }) → ScoreBreakdown` donde

```ts
interface SideScore { stones: number; territory: number; prisoners: number; komi: number; total: number }
interface ScoreBreakdown { rules: Rules; black: SideScore; white: SideScore; result: string }
```

1. Tablero final = `boardFromMoves(...)` menos las piedras marcadas muertas.
2. `countArea` sobre ese tablero da área por color (piedras + territorio); territorio = área − piedras.
3. **Chinas:** `total = stones + territory` (+ komi a Blanco); `prisoners` se informa en 0.
4. **Japonesas:** `total = territory + prisoners` (+ komi a Blanco), con
   `prisoners(negro) = capturas de Negro + piedras blancas muertas` y viceversa.
5. `result = formatResult(black.total − white.total)`.

Sin compensación de handicap (como la etapa 1). Límite conocido: en japonesas un seki con ojo que
linda con un solo color se cuenta como territorio; los jugadores lo resuelven con "Seguir jugando"
o marcando. Casos de prueba obligatorios: la partida `tengen-online-2026-09-30.sgf` (sin muertas)
da `W+1.5` en chinas y `W+0.5` en japonesas.

El `ended` de un conteo aceptado lleva el `ScoreBreakdown` (`score`) para que cualquier cliente
(incluido el que reconecta o el espectador) muestre el desglose sin recalcular.

## Interfaz

- **En `scoring`:** tocar una piedra envía `toggle-dead`; las muertas se ven atenuadas y el
  territorio se pinta sobre el tablero (capacidades existentes de Shudan vía `BoundedGoban`:
  piedras atenuadas y mapa de pintura). El rail muestra el desglose en vivo según la regla, los
  botones **Aceptar** y **Seguir jugando**, el estado ("El rival aceptó" / "Aceptaste, esperando
  al rival") y la cuenta regresiva de 5 min. Espectador: lo mismo sin controles.
- **Fin:** además del resultado, el desglose: p. ej. "Negro: 28 territorio + 1 prisionero = 29 ·
  Blanco: 22 + 1 + 6,5 = 29,5" (japonesas) o "Negro: 15 piedras + 28 territorio = 43 · Blanco:
  16 + 22 + 6,5 = 44,5" (chinas). Para `+F`: "Negro gana por abandono (no aceptó el conteo)".
- **SGF:** `RU[Chinese]` / `RU[Japanese]` según la regla elegida; `RE` con el resultado.

## Errores y bordes

- Cambios de marcas simultáneos: el `seq` ya serializa; el segundo recibe `stale`.
- Reconexión durante `scoring`: el `sync` trae los eventos; el estado sale de `project`.
- Sala desplegada a mitad de partida: dos pases desde ahora llevan a `scoring` (sin impacto).

## Testing

- **go-rules (Node):** transiciones `playing → scoring → ended`, `scoring → playing` por
  `resume` y por timeout; toggle de cadena y borrado de aceptaciones; validaciones nuevas; la regla
  de "dos pases desde el último `resumed`"; `flagDeadline` indefinido en `scoring` y reloj correcto
  tras reanudar; `onAlarm` en sus tres ramas; `scoreGame` en ambas reglas (incluida la partida
  real y un caso con muertas y prisioneros).
- **Worker:** la alarm de conteo (ganador por abandono y reanudación), y `rules` en `POST`.
- **Cliente (jsdom):** marcar/desmarcar, aceptar, "El rival aceptó", seguir jugando, desglose al
  final, formulario online con Reglas.

## Fuera de alcance

Estimación automática de muertas, reglas AGA/coreanas, compensación de handicap en el conteo,
marcas SGF de territorio (`TB`/`TW`), nombres visibles.
