# Partidas online (humano vs humano) — diseño

> Estado: aprobado en conversación con Edgar el 2026-09-30 (brainstorming por secciones). Pendiente:
> revisión de esta spec escrita → plan de implementación.

## Objetivo

Que una persona cree una partida, comparta la URL y juegue en tiempo real contra otra; cualquier
persona extra con el link mira (espectador, o un profesor). Uso principal: partidas casuales entre
conocidos; la puerta queda abierta al uso profesor↔alumno. Costo de infraestructura propia mínimo.

## Etapas

- **Etapa 1 (esta spec):** partidas online funcionando, sin cuentas.
- **Etapa 2 (fuera de alcance, se planifica con esto en mente):** perfil de la persona con login por
  **passkeys** (better-auth en el Worker + D1, sin terceros), historial de partidas online y
  sincronización del progreso de Aprender (hoy solo en `localStorage`). La etapa 1 deja preparado el
  `playerId` anónimo (ver Identidad) para que la etapa 2 lo vincule a una cuenta sin migrar datos.

## Decisiones (no re-litigar)

- **Transporte: WebSockets contra un Durable Object por partida** (`GameRoom`, con almacenamiento
  SQLite y WebSocket Hibernation), dentro del mismo Worker. Descartados tras investigación con
  fuentes (2026-09-30): P2P WebRTC (NAT/CGNAT móvil exige TURN; nadie arbitra el reloj), servicios
  gestionados (Supabase/Firebase/Ably/Pusher/Liveblocks: bus sin reloj de servidor, un proveedor
  más), Nostr (sin garantías), polling/SSE (1-3 s de lag), webhooks (un navegador no puede recibir
  un POST), web3 (gas por jugada, latencia de bloque, wallet obligatoria).
- **Costo:** DO facturado dentro del plan pago existente (1M requests/mes incluidos; mensajes WS
  entrantes a razón 20:1 → ~15 requests por partida de 300 jugadas; sin duración mientras hiberna).
- **Servidor autoritativo** para turnos, legalidad y reloj. El cliente solo envía intenciones.
- **Reloj desde la v1**, con la semántica ya existente de `packages/engine/src/clock/clock.ts`
  (`initialClockState` / `applyElapsed`, tiempo principal + byoyomi japonés).
- **Fin por dos pases → conteo por área tal cual** (`countArea` de `apps/web/src/game/territory.ts` +
  komi). Sin fase de marcar piedras muertas: hay que capturarlas antes de pasar (en conteo por área
  no cuesta puntos). Por eso las partidas online usan reglas chinas; komi por defecto 7.
- **Sin cuentas en la etapa 1:** la URL de la sala es la invitación; cada asiento se protege con un
  token secreto.

## Arquitectura

### Servidor (Worker existente)

- `wrangler.jsonc`: binding `GAME_ROOM` (clase `GameRoom`) + migración `new_sqlite_classes`.
- `POST /api/rooms` — cuerpo: `{ boardSize, komi, handicap, clock?, creatorColor: 'black'|'white'|'nigiri', playerId }`.
  Crea la sala (id aleatorio de 128 bits, base64url), registra `created` y devuelve
  `{ roomId, seatToken }`. Rate limit con el `LIMITER` existente.
- `GET /api/rooms/:id/ws?playerId=…&token=…` — upgrade a WebSocket hacia el DO `idFromName(roomId)`.
  - token válido → reconecta ese asiento;
  - sin token y queda asiento libre → lo toma (`joined`), recibe su `seatToken`;
  - si no → espectador.
- `GameRoom` es un **envoltorio delgado**: sockets (Hibernation API), alarm, persistencia. Toda la
  lógica vive en una función pura (ver Lógica de la sala).
- **Vida de la sala:** al terminar (`ended`) se programa una alarm a 30 días que borra el DO
  (`deleteAll`). Una sala creada que nunca empezó expira a las 24 h.

### Código compartido

- **`packages/go-rules`** (nuevo workspace): se muda `apps/web/src/game/rules.ts` y
  `apps/web/src/game/territory.ts` con sus tests. La SPA y el Worker importan el mismo código de
  reglas y conteo. Sin cambio de comportamiento: es un traslado.
- El reloj se importa del módulo puro de `packages/engine` (`clock/clock.ts`) sin arrastrar el
  resto del motor (subpath de export; verificar en el plan que el bundle del Worker no incluya
  onnxruntime).

### Cliente (SPA)

- Ruta nueva `/online/:roomId` (`OnlineGameView`), sin `ModelGate`: no usa el motor, funciona sin
  WebGPU.
- `NewGameForm`: rival nuevo **"Una persona (online)"**. Oculta fuerza y reglas; muestra tamaño,
  komi, handicap, reloj y color (negro/blanco/nigiri). "Empezar" llama `POST /api/rooms` y navega.
- `localStorage`: `playerId` + secreto del navegador (uno por navegador) y `seatToken` por sala.

## Identidad (preparación de la etapa 2)

- El navegador genera una vez `playerId` (aleatorio) y lo guarda en `localStorage`.
- Los eventos `created`/`joined` registran el `playerId`, no solo el asiento.
- Etapa 1: sin nombres; la UI dice "Negro (vos)" / "Blanco (rival)".
- Etapa 2: al crear el perfil con passkey, el `playerId` del navegador se vincula a la cuenta; las
  partidas ya jugadas pasan a su historial sin migración.

## Lógica de la sala (función pura)

`reduce(log, intent, now) → { events } | { rejected: motivo }` y `project(log) → estado`
(tablero, turno, relojes, capturas, resultado). Testeable en Node con reloj falso.

### Eventos (append-only; cada uno con `seq` y `at` = hora del servidor)

| Evento | Datos |
| --- | --- |
| `created` | configuración, `playerId` del creador, color elegido (o `nigiri`) |
| `joined` | asiento, `playerId` |
| `started` | colores definitivos (el nigiri se sortea acá); arranca el reloj |
| `move` | color, `{x,y}`, estado de reloj del que jugó tras la jugada |
| `pass` | color, estado de reloj |
| `resign` | color |
| `timeout` | color |
| `ended` | resultado estilo SGF RE (`B+7.5`, `W+R`, `B+T`) |

### Protocolo

- Cliente → servidor: `move {x,y,seq}`, `pass {seq}`, `resign {seq}`. `seq` = el próximo que el
  cliente espera; si no coincide, `rejected: stale` (evita dobles jugadas y dos pestañas).
- Servidor → cliente: al conectar, `sync {events desde lastSeq}`; luego cada evento nuevo; y
  `rejected {motivo}` (`not-your-turn`, `illegal`, `ko`, `stale`, `not-a-player`, `game-over`).
- Espectadores reciben lo mismo y no pueden enviar intenciones.
- Tamaño máximo de mensaje y tope de 50 conexiones por sala.

### Jugadas ilegales: nunca se juegan

Doble barrera con el MISMO código (`packages/go-rules`, `validateMove`):
1. **Cliente:** antes de enviar, valida la jugada contra el estado proyectado. Si es ilegal
   (punto ocupado, suicidio, ko, no es tu turno, partida terminada) **no se envía ni se coloca**
   la piedra, y el rail dice por qué.
2. **Servidor:** `reduce` vuelve a validar toda intención y la rechaza (`rejected`) si es ilegal.
   Nunca entra al registro un evento `move` ilegal: el log es siempre una partida válida.
Reglas: suicidio prohibido; ko simple (mismo criterio que el resto de tengen, vía `validateMove`).

### Reloj

- El DO guarda, por color, el `ClockState` y el `at` de inicio del turno actual.
- Al aplicar una jugada: `applyElapsed(estado, config, now − turnStartedAt)`; si se agotó →
  `timeout` en vez de la jugada.
- La alarm se programa al instante exacto en que se le acabaría el tiempo al que juega ahora; al
  dispararse sin jugada → `timeout` + `ended`. Solo hay alarm mientras corre el reloj (así la sala
  puede hibernar entre partidas).
- El cliente muestra una cuenta regresiva local corregida con cada evento. La latencia de red corre
  por cuenta de cada jugador (sin compensación en v1). La desconexión no detiene el reloj.

### Fin

- Dos `pass` seguidos → `countArea` + komi → `ended`. Handicap: piedras fijas; empieza Blanco.
- `resign` / `timeout` → `ended` directo.

## Interfaz

Reusa el template "estudio de tablero" y el sistema de diseño (`.kntor-design-atomic/system.md`).

- **Esperando rival:** link grande con Copiar y Compartir (`navigator.share` en móvil); el tablero
  aparece cuando entra el rival.
- **En juego:** tablero héroe + rail con relojes, capturas, turno, estado de conexión del rival
  ("desconectado"/"reconectando…") y Pasar / Rendirse. La piedra se pinta al confirmarla el
  servidor (no optimista).
- **Espectador:** misma pantalla sin controles, "Mirando: Negro vs Blanco".
- **Fin:** resultado, **Descargar SGF** (codec SGF + reloj existentes) y "Nueva partida online".
- **Volver al link:** recupera el asiento; partida terminada → modo repaso durante 30 días.

## Errores

- Sala inexistente o expirada → "Esta partida no existe o ya expiró" + nueva partida.
- Intención rechazada → aviso breve en el rail; el tablero no cambia.
- Conexión caída → reconexión automática con backoff exponencial y `sync` desde `lastSeq`.
- Link filtrado antes de que entre el rival → quien entre primero toma el asiento (el link es la
  invitación); los tokens de asiento nunca salen del navegador de su dueño.
- DO reiniciado o desalojado → estado y alarm persisten en SQLite; el reloj se recalcula desde los
  timestamps guardados.

## Testing

- **`reduce`/`project` puros (Node, reloj falso):** turnos, legalidad y ko, handicap, byoyomi
  (entrada a períodos, consumo de un período), timeout por jugada tardía y por alarm, dos pases →
  conteo por área + komi, rendición, `seq` desfasado, espectador que intenta jugar, nigiri
  determinista con rng inyectado.
- **`packages/go-rules`:** los tests existentes de reglas y conteo se mudan con el código.
- **Cliente (jsdom, socket falso):** esperar rival, jugar, rechazo, reconexión, fin, espectador.
- **CI hermético:** nada de lo anterior necesita red ni modelos.
- **Gate manual:** partida real entre Chrome de escritorio y un celular, incluyendo cortar el wifi a
  mitad de partida y perder por tiempo.

## Fuera de alcance (etapa 1)

Cuentas/perfil/passkeys y sincronización del progreso de Aprender (etapa 2), nombres visibles,
chat, deshacer jugada, fase de piedras muertas, compensación de latencia, listado de partidas
públicas, ranking.

## Monitoreo upstream

Sin dependencias nuevas de terceros en la etapa 1 (Durable Objects es plataforma ya usada). Se
mantiene la vigilancia existente de `@sabaki/*` (ahora también consumido por el Worker vía
`packages/go-rules`). Si la etapa 2 agrega el plugin de passkeys de better-auth, entra al monitoreo.
