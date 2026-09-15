# Aprender v3 — el currículo de 30 talleres de FEDIBERGO, piloto sobre el Bloque 1

> Diseño explorado con Edgar el 2026-09-15 (5 sub-agentes de investigación sobre
> `fedibergo-ensananza/` + lectura directa de los PDF fuente, no solo su resumen). Sucede a
> Aprender v1 (mergeada 2026-08-04, commit `06f7cf3`) y convive con v2 ("el motor deja de ser
> peaje", diseñada 2026-08-06 en `2026-08-06-aprender-formas-esquina-design.md`, todavía sin
> construir) — la relación entre ambas está al final de este documento.

## El material, leído directamente

`fedibergo-ensananza/files/ensenanza/` (agradecido en NOTICE.md/README.md, uso declarado público
por Edgar) tiene, por taller: `guiaDelTallerNN.pdf` (guion del docente), `problemasTalleresXXaYY.pdf`
(tarea del alumno, 6 problemas), `ayudaMemoriaTalleresXXaYY.pdf` (resumen ilustrado + soluciones).
Y tres documentos transversales: `unMetodoProgresivoDeEnsenanzaDeLasReglasDelGo.pdf` (el método de
pasos + prácticas que ordena los primeros talleres), `lasReglasDelGo.pdf`, `lasTecnicasDelJuego.pdf`.

Hechos verificados leyendo esos archivos (no el resumen de la exploración anterior):

- **El tablero real es 9×9.** `unMetodoProgresivo` pág. 15, al fijar el komi: *"El valor
  recomendado para el komi es 5,5 puntos. Esta cantidad es razonable para partidas jugadas en
  tableros de 9×9 líneas."*
- **Cada problema de FEDIBERGO es de UNA sola jugada, no un árbol.** `problemasTalleres01a05.pdf`:
  el enunciado de cada taller es *"marcar la jugada de Blanco que captura / que evita la
  captura / [...]"* sobre un diagrama fijo — no hay líneas de respuesta del rival que seguir. El
  contrato de `Exercise`/`ExerciseNode` (`apps/web/src/learn/exercise.ts`) modela árboles
  multi-jugada; un problema de FEDIBERGO es, en ese formato, un árbol de **profundidad 1**: la
  raíz (la posición) más sus hijos candidatos, uno marcado `correct`.
- **El Bloque 1 (talleres 1-5), en orden, según `unMetodoProgresivo` (Pasos 1-16) +
  `ayudaMemoriaTalleres01a05.pdf`** (los 4 archivos, uno por taller):
  1. La jugada, libertades, atari, captura simple, retirar piedra capturada. *Atari-go: gana quien
     hace la 1ª captura.*
  2. Captura de cadenas grandes y **snapback** ("jugar en un punto donde la piedra propia
     aparentemente no tiene libertades"), atari doble. *Atari-go a 5/15 piedras.*
  3. La regla del ko — en el centro, el borde y el rincón. *Atari-go con ko.*
  4. Ojos: un ojo vs. dos ojos, ojo grande, primera aplicación de la regla del territorio.
     *Atari-go "sin límite de tiempo" (con pase) — la práctica que hace de puente a Go real.*
  5. Técnicas de captura con lectura corta: atari doble, escalera, atari contra el borde, conexión
     diagonal/directa.
- **Posiciones muy acotadas**: 5-12 piedras sueltas en un tablero 9×9 por lo demás vacío — no
  partidas realistas ni esquinas de 19×19. En tamaño se parecen a `primeros-pasos.json` (setup
  chico, árbol corto), no a `formas-esquina` (posiciones 4×9 a 7×9 insertadas en una esquina real
  de 19×19).
- **Checkpoints en talleres 10/20/30**, confirmado por el propio nombre de archivo
  (`taller10Problemas.pdf`, `taller20Problemas.pdf`, `taller30Problemas.pdf`, aparte de
  `problemasTalleresXXaYY.pdf`): sin tema nuevo, repaso + problemas resueltos en el momento.
  **Fuera de este piloto**: el Bloque 1 no llega al primero.

## Decisiones tomadas — no re-litigar

- **Piloto = Bloque 1 (5 lecciones) solamente.** Bloques 2-6 y sus checkpoints quedan fuera; se
  retoman después del gate manual de Edgar (ver Testing).
- **Contenido 100% original de tengen, inspirado en la estructura del método — no transcripción ni
  reproducción de los diagramas de FEDIBERGO.** Mismo protocolo que "Primeros pasos": veredicto
  escrito en `docs/research/fase-aprender/contenido-licencias.md` ANTES de que el JSON entre al
  registro (regla ya enforced en `collections.ts:5-7`), extendido con una entrada nueva para este
  currículo — reproducir los diagramas exactos de FEDIBERGO no está cubierto por el veredicto
  actual (que solo cubre agradecimiento + referencia).
- **`Exercise.boardSize` deja de ser el literal `19` y pasa a ser `BoardSize` (9 | 13 | 19).**
  Verificado que esto es un cambio de tipo, no un refactor: `ExercisePlayer.tsx:212-249` ya lee
  `exercise.boardSize` genéricamente para armar la grilla (no hay un `19` hardcodeado ahí salvo
  `MAX_VERTEX_SIZE_19`, un tope de píxeles cosmético e inofensivo a 9×9), y
  `AprenderView.tsx:147` ya pasa `exercise.boardSize` a `ensureReady`. Y **corrido, no solo leído**:
  un `Exercise` de prueba con `boardSize: 9` (una posición de atari real, forzando el tipo con
  `as unknown as 19` para probar el runtime actual antes de ensanchar el tipo) pasa
  `exerciseIssues` con `[]` — el camino de legalidad (`isMoveSequenceLegal` → `boardFromMoves` →
  `GoBoard.fromDimensions(9)`) no tiene ninguna suposición de 19×19 oculta; `handicapVertices`
  (que sí solo da hoshi correctos en 19×19, según su propio comentario) ni se ejercita, porque
  `exerciseIssues` siempre llama con `handicap: 0`. La negativa de `formas-esquina` a tocar
  `BoardSize` ("No cambia BoardSize ni agrega tableros pequeños") estaba acotada a SU colección —
  formas que ocurren en una esquina de 19×19 por definición. Este currículo es contenido distinto,
  genuinamente 9×9, y coincide con el default real de `NewGameForm` (`boardSize = 9`).
- **El piso de 20k queda CERRADO, no es una decisión de tengen.** Verificado en
  `packages/engine/src/types.ts` (`HUMAN_RANKS[0] === '20k'`) y `encoding/metaV1.ts`
  (`inverseRank = HUMAN_RANKS.length - idx`, derivado de `sgfmetadata.cpp:292` de KataGo): no
  existe un rango por debajo de 20k en el vocabulario de Human SL, así que no hay clamp que
  revisar ni valor "más débil" que inventar. Para el Bloque 1 esto no es una limitación: 20k
  (el más débil disponible) es la elección correcta para principiantes totales de cualquier modo.
  Si el "kyu de FEDIBERGO" de bloques posteriores (30-31 en el taller 20, ~25 en el 30) necesita
  algo por debajo de 20k queda **abierto y fuera de este piloto** — no bloquea el Bloque 1, cuyo
  rango sugerido es, precisamente, el piso.
- **Progreso: desbloqueo DERIVADO, no persistido.** `progress.ts` sigue siendo el mismo
  `Record<string, ExerciseProgress>` bajo `tengen:learn:v1`. Lección N+1 se habilita si las 6
  `ExerciseProgress` de la lección N están `estado: 'resuelto'` — una función pura sobre el mapa
  que ya existe. Sin campo nuevo, sin clave `v2`, sin migración.
- **El selector de rango se reusa de `NewGameForm.tsx` (`HumanRank`/`HUMAN_RANKS`), no se
  reinventa.** Ver Pieza 4.
- **La teoría vive en el bundle, no se pide por red.** Mismo motivo que `collections.ts:1-3`
  documenta para los datasets: entrar como módulo JSON/TS es lo que la mete al precache de la PWA
  sin tocar `globPatterns` ("orden de plugins frágil"). Sin librería de Markdown nueva (no hay
  ninguna en `apps/web/package.json` hoy): `theory` es `readonly string[]` — párrafos de texto
  plano, renderizados como `<p>`.

## Pieza 1 — El tipo `Lesson`

Nuevo archivo `apps/web/src/learn/lesson.ts` (mismo patrón que `exercise.ts`):

```ts
import type { HumanRank, BoardSize } from '@tengen/engine'
import type { Exercise } from './exercise'

export interface Lesson {
  id: string // 'b1-l1' .. 'b1-l5' en este piloto
  block: number // 1..6
  workshop: number // 1..30 — el taller de FEDIBERGO que inspira esta lección
  title: string
  theory: readonly string[] // párrafos cortos, texto plano
  exercises: readonly Exercise[] // 6, boardSize 9 en este bloque
  checkpoint: boolean // true en los talleres 10/20/30 — el campo se define ahora aunque
  //                     el piloto no lo ejercita (evita un segundo cambio de forma después)
  practiceOpponent: { rank: HumanRank; boardSize: BoardSize } // sugerido, no forzado
}
```

`lessonIssues(lesson): string[]` (mismo archivo): `exercises.length === 6`, `theory.length > 0` y
sin párrafos vacíos, `title` no vacío, y un `exerciseIssues(e)` por cada ejercicio — reusa el
validador existente en vez de duplicar sus reglas de forma/legalidad.

Registro nuevo `apps/web/src/learn/curriculum.ts` (mismo patrón que `collections.ts`):

```ts
export const CURRICULUM: readonly Lesson[] = [/* bloque1 as unknown as readonly Lesson[] */]
```

importando `./data/bloque-1.json`. Fuente committeada en `apps/web/content/tsumego/bloque-1/`
(mismo patrón de procedencia que `primeros-pasos/`).

`tests/learnData.test.ts` se EXTIENDE (no un test nuevo aislado) para recorrer `CURRICULUM` con
`lessonIssues`, igual que ya recorre `COLLECTIONS` con `exerciseIssues` — un dataset que entra sin
pasar por ese archivo escapa al guardián en silencio.

## Pieza 2 — Desbloqueo secuencial

`progress.ts` gana una función pura, sin nuevo estado persistido:

```ts
export function isLessonUnlocked(
  lessons: readonly Lesson[],
  progress: ProgressMap,
  lessonId: string,
): boolean
```

La lección en la posición 0 del currículo siempre está desbloqueada. La lección en la posición `i`
(`i > 0`) lo está si los 6 `exercises` de `lessons[i - 1]` tienen `progress[ex.id]?.estado ===
'resuelto'` — con `noUncheckedIndexedAccess` activo, `lessons[i - 1]` puede ser `undefined` y el
caso se trata como "no hay lección anterior → desbloqueada" solo para `i === 0`.

## Pieza 3 — Verificación del contenido: reglas puras donde alcanzan, motor donde no

Este es el punto donde el piloto **se aparta del protocolo por defecto** de "Primeros pasos" /
"formas de esquina", con evidencia, no por atajo:

- **Lecciones 1-3 (la jugada, captura, ko): el objetivo pedagógico ES la mecánica de la regla, no
  una lectura de vida/muerte.** Si la jugada marcada `correct` captura (o evita ser capturada, o
  resuelve/viola el ko) es un hecho 100% determinado por las reglas de Go — no requiere juicio de
  posición. `apps/web/src/game/rules.ts` ya expone lo necesario (`applyMove`, `capturesOf`,
  `isMoveSequenceLegal`). Mapeo a `ExerciseObjective` (sin extender el enum): problema de captura
  ("marcar la jugada que captura piedras del adversario") → `'matar'`; problema de defensa
  ("marcar la jugada que saca del atari / evita la captura de piedras propias") → `'vivir'`;
  Taller 3 (ko) → `'ko'`.

  El guardián para estas 3 lecciones es MÁS estricto que `exerciseIssues` (que confía en el
  `correct` horneado), pero en una sola dirección — la otra dirección es reporte, no fallo, porque
  el propio enunciado de FEDIBERGO admite más de una jugada válida en los problemas de defensa
  (`problemasTalleres01a05.pdf`, Taller 1: *"...o que saca del atari a piedras propias"* — extender
  una cadena en atari suele tener más de una salida legal; lo mismo el Taller 4 con *"...o que
  evita que sean capturadas piedras suyas"*). Recorre TODOS los puntos jugables de la posición
  (no solo los del árbol) y:
  1. **Falla** si algún nodo marcado `correct` NO logra el objetivo (captura / salva del atari /
     el ko se resuelve o se viola según corresponda) — esto sí es un error real, no un matiz.
  2. **Reporta** (no falla) cualquier punto jugable que también logre el objetivo sin estar
     marcado `correct` — cada reporte se resuelve a mano agregando ese punto como `correct`
     adicional, o achicando la posición hasta que la solución vuelva a ser única, según lo que
     tenga más sentido pedagógico para esa lección.

  Sin motor, sin spot-check — el "árbitro" es la implementación de reglas que el juego ya usa para
  jugar partidas reales.
- **Lecciones 4 (ojos) y 5 (escalera / técnicas con lectura corta): mismo protocolo que "Primeros
  pasos"** (spot-check contra KataGo desktop, co-optimalidad local + gap ≥3 pts) — **con una
  salvedad medida acá, no asumida**: las posiciones de atari-go de FEDIBERGO son mucho más
  dispersas que un tsumego real (pocas piedras sueltas en un tablero 9×9 casi vacío, no una
  esquina de 19×19 con la textura de una partida). No hay garantía de que el score de KataGo
  desktop sea una señal fiable tan fuera de distribución. **Spike obligatorio antes de comprometer
  el protocolo**: correr 2-3 posiciones de muestra de la Lección 4 contra KataGo desktop
  (`katago` ya instalado localmente, `.bin.gz` de b18 presentes) y confirmar que el score separa
  con margen claro la jugada correcta de las incorrectas. Si no separa, el gate para esas dos
  lecciones pasa a ser el mismo chequeo exhaustivo de reglas de arriba, complementado con revisión
  manual de Edgar — análogo a cómo ya se verifica a mano una forma cerrada de dos ojos simple.

## Pieza 4 — UI: currículo en Aprender, práctica en Jugar

`AprenderView` gana un nivel de navegación **antes** de "Colecciones": una lista "Currículo" con
las lecciones del Bloque 1. `stateGlyph` (ya existe) se extiende con un estado `'bloqueado'`
(glifo distinto, sin abrir) además de `'resuelto'`/`'intentado'`/`'pendiente'`.

Abrir una lección desbloqueada: teoría (los párrafos de `theory`) → los mismos 6 `Exercise` vía
`ExercisePlayer`/`EngineExercisePlayer`, **sin cambios** en ese componente. Al completar los 6, en
vez de "Volver a la lista" aparece un botón **"Practicar contra Human SL {rank}"**, con los valores
de `lesson.practiceOpponent`.

El botón navega a `/jugar` con esa configuración pre-cargada. Mecanismo: `NewGameForm` gana un prop
opcional y aditivo —

```ts
interface NewGameFormProps {
  onStart(config: GameConfig): void
  onBack(): void
  initial?: { boardSize?: BoardSize; opponentKind?: 'human' | 'kata'; humanRank?: HumanRank }
}
```

— que solo cambia los `useState` iniciales cuando está presente. Quien entra a "Jugar" por su
cuenta (sin venir de Aprender) sigue arrancando exactamente igual que hoy (`kata`, 9×9, `5k`): el
prop es opcional y `main.tsx:189` sigue montando `<NewGameForm onStart={...} onBack={...} />` sin
él. Esto es "reusar, no reinventar" tal como pide el plan: cero componente nuevo de selección de
rango.

## Relación con Aprender v2 (Pieza 1 — motor bajo demanda)

v2 quita el `ModelGate` obligatorio de `AprenderView` para que resolver un árbol sin salirse de él
no descargue el modelo. Las Lecciones 1-3 de este Bloque 1 **nunca tocan el motor** (son
verificables por reglas puras, Pieza 3) — se benefician de v2 exactamente igual que "formas de
esquina". Si v2 ya está mergeada al construir esto, este piloto se apoya en ella directamente. Si
no, el piloto **funciona igual sin ella**: `AprenderView` sigue con su `ModelGate` de v1 (que solo
se paga al abrir el player, no al ver la lista), y la partida de práctica contra Human SL vive en
`/jugar`, que ya tiene su propio gate independiente. v2 no es un prerrequisito duro de este piloto,
solo una optimización que conviene compartir si cae en la misma ventana de trabajo.

## Testing

- **Node, sin motor**: `lessonIssues` sobre `CURRICULUM` (extiende `learnData.test.ts`, no un test
  aislado); el chequeo exhaustivo de reglas de la Pieza 3 para las Lecciones 1-3, contra cada punto
  jugable de cada posición, no solo los del árbol; `isLessonUnlocked` con progreso mock (ninguna
  lección resuelta, algunas resueltas, ejercicios "intentado pero no resuelto" no desbloquean).
- **jsdom**: la lista de currículo pinta bloqueada la lección 2 cuando la 1 no está resuelta y la
  desbloquea cuando sí; el botón "Practicar contra Human SL" pasa el `initial` correcto a
  `NewGameForm` (mock de navegación); `NewGameForm` sin `initial` sigue arrancando en los valores
  de hoy (regresión del comportamiento de "Jugar" normal).
- **Spot-check**: condicional según la Pieza 3 — obligatorio para Lecciones 4-5 tras el spike, NO
  aplica a Lecciones 1-3 (las cubre el chequeo exhaustivo de reglas).
- **Gate manual**: Edgar completa el Bloque 1 de punta a punta en Chrome — teoría → 6 problemas ×
  5 lecciones → botón de práctica → partida real contra Human SL 20k en `/jugar`, arrancada con la
  config pre-cargada.

## Lo que este diseño NO hace

- No construye los Bloques 2-6 ni sus checkpoints (talleres 10/20/30).
- No decide si el "kyu de FEDIBERGO" de los bloques 2-6 necesita rangos por debajo de 20k —
  pregunta real, deliberadamente fuera de foco de un piloto cuyo rango sugerido ya es el piso.
- No reproduce los diagramas ni el texto de FEDIBERGO: contenido nuevo, con su propio veredicto de
  licencia en `contenido-licencias.md` antes de comitear el JSON.
- No toca D1 ni el progreso en la nube — sigue siendo `localStorage` v1.
- No construye la Pieza 1 (motor bajo demanda) ni la Pieza 3 (gate de WebGPU por-destino) de
  Aprender v2 — se benefician de ellas si ya existen, pero el piloto no las requiere (ver arriba).
- No cambia el comportamiento por defecto de "Jugar" para quien entra sin venir de Aprender.
- No agrega una librería de Markdown ni ningún renderer de texto enriquecido nuevo.
