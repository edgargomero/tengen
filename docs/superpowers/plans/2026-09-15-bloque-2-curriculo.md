# Bloque 2 del currículo FEDIBERGO (talleres 6-10) — plan de implementación

> **NOTA:** este archivo reemplaza el plan anterior del Bloque 1 (ya ejecutado, revisado,
> commiteado y DESPLEGADO a producción el 2026-09-15, `tengen.kntor.io`). Ese plan queda como
> historia en `docs/superpowers/plans/2026-09-15-bloque-1-curriculo.md` — no se repite acá.

## Contexto

El Bloque 1 (talleres 1-5) del currículo FEDIBERGO ya está en producción: 5 lecciones, 30
posiciones 9×9, teoría original, desbloqueo secuencial, práctica final contra Human SL 20k — todo
`engineless` (sin motor neuronal; el árbitro es `objectiveCheck.ts`, reglas puras). Edgar ya probó
el piloto en producción y pidió seguir con el resto del currículo, de a un bloque por vez,
empezando por el Bloque 2 (talleres 6-10, el segundo de 6 bloques totales — 30 talleres en total,
checkpoints en 10/20/30).

**Investigación de contenido para este bloque** (agente Explore sobre `fedibergo-ensananza/`,
igual protocolo que el Bloque 1: estructura y secuencia de temas, NUNCA texto ni diagramas
copiables):

| Taller | Tema (Paso del método) | Tipo de problema |
|---|---|---|
| 6 | Un ojo / dos ojos, punto vital — sigue en **atari-go** (sin conteo de puntos) | Una jugada: capturar o defender |
| 7 | Ojo verdadero vs. falso, territorio — **transición a go completo con conteo**, komi todavía NO | Una jugada (+ el original pide contar puntos, ver decisión abajo) |
| 8 | Ataris sucesivos, atari sobre el borde, conexión abierta/por el borde, territorio explicado | Una jugada: capturar o conectar |
| 9 | Ojos grandes, territorio, se introduce el **nigiri** (sorteo de color) — komi sigue sin introducirse | Una jugada (+ conteo, igual que taller 7) |
| 10 | **Checkpoint**: repaso de 6-9, sin tema nuevo, resuelto en clase (no en formato "tarea a casa") — sin puntaje ni umbral formal, mismo patrón se repite cada 10 talleres (20, 30) | Una jugada, mezclando técnicas ya vistas |

Corrección a una premisa inicial: el Bloque 1 (talleres 1-5) cubrió los Pasos 1-8 del método, no
1-16 — el Bloque 2 avanza los Pasos 9-12. Tablero sigue 9×9 en todo el currículo (confirmado hasta
el taller 10 al menos).

## Decisiones tomadas (con Edgar, en esta sesión) — no re-litigar

- **Alcance: SOLO el Bloque 2** (5 lecciones, talleres 6-10). Los Bloques 3-6 se retoman después de
  que Edgar revise este.
- **Piso de Human SL sigue en 20k** para la práctica de TODAS las lecciones (igual que el Bloque
  1) — no hay rango más débil disponible en el motor, y no se investiga alternativa.
- **La sub-tarea de "contar puntos" de los talleres 7 y 9 se OMITE.** No existe código de conteo
  territorial reusable en la capa de dominio (`apps/web/src/game/` — confirmado: `endgame.ts` solo
  formatea un `scoreLead` que le llega ya calculado del motor, no lo calcula). Implementarlo sería
  una feature de UI nueva (input numérico + validación + feedback), no una repetición del patrón ya
  construido. El Bloque 2 sigue el mismo formato que el Bloque 1: cada ejercicio pide únicamente
  marcar la jugada correcta. El conteo real de puntos lo vive el alumno de forma natural en la
  partida de práctica contra Human SL (que sí tiene marcador de puntos real).
- **El checkpoint del taller 10 NO necesita UI nueva.** La investigación confirmó que en FEDIBERGO
  es solo repaso sin tema nuevo, sin puntaje ni gate de aprobación — se modela con el campo
  `checkpoint: true` que el tipo `Lesson` ya define (sin usarlo hasta ahora), pero la Lección 10 se
  renderiza EXACTAMENTE como las demás (teoría → 6 problemas → práctica). Cero cambio de código en
  `AprenderView.tsx`/`ExercisePlayer.tsx` por este motivo.
- **Máxima reutilización, cero infraestructura nueva.** A diferencia del plan del Bloque 1, este
  plan NO define ningún tipo, componente, ni módulo nuevo — todo ya existe:
  - `Lesson`/`lessonIssues` (`apps/web/src/learn/lesson.ts`) — se reusa sin cambios.
  - `objectiveCheck.ts`/`checkObjective` (el árbitro de reglas puras) — se reusa sin cambios. Sigue
    soportando `matar`/`vivir`/`ko`, que cubren todo lo que el Bloque 2 necesita (ver riesgo
    conocido abajo).
  - `ExercisePlayer` con `engineless` — ya se usa para TODAS las lecciones desde el fix final del
    Bloque 1 (decisión de Edgar: todo el currículo es engineless, no solo Lecciones 1-3). El
    Bloque 2 hereda ese comportamiento sin tocar el componente.
  - `isLessonUnlocked` — ya opera sobre el array `CURRICULUM` completo, sin importar de qué bloque
    es cada lección. Al extender `CURRICULUM` con el Bloque 2, el desbloqueo secuencial sigue
    funcionando automáticamente: la Lección 6 (taller 6) se desbloquea al completar la Lección 5
    (taller 5, última del Bloque 1).
  - `curriculum.ts` — se EXTIENDE (no se reescribe) para concatenar `bloque-1.json` + `bloque-2.json`.
  - `NewGameForm.initial`, `practicaPrefill.ts` — se reusan sin cambios (la práctica de cualquier
    lección ya funciona igual).
- **Riesgo conocido, sin acción preventiva — ya se resolvió una vez con éxito:** el árbitro
  `objectiveCheck.ts` solo reconoce el patrón "grupo con EXACTAMENTE 1 libertad antes de la
  jugada" para `vivir`. En el Bloque 1, la Lección 4 (ojos) ya topó con esta limitación y el
  implementador tuvo que rediseñar una posición a mano cuando la redacción literal del plan era
  imposible bajo esa semántica (ver ledger archivado). El Bloque 2 trata fuertemente de ojos
  (talleres 6, 7, 9) — es MUY probable que el mismo patrón se repita. No se toca `objectiveCheck.ts`
  preventivamente: cada task de autoría lleva la instrucción explícita de diseñar la posición para
  que encaje en esa semántica (o rediseñar si no encaja), igual que ya funcionó.

## Global Constraints

- **`boardSize: 9`** en las 30 posiciones nuevas — igual que el Bloque 1, confirmado por la
  investigación (todo el currículo hasta el taller 10 es 9×9).
- **Contenido 100% original de tengen**, inspirado en la secuencia de FEDIBERGO, nunca sus
  diagramas ni su texto — mismo veredicto de licencia que el Bloque 1, nueva entrada en
  `docs/research/fase-aprender/contenido-licencias.md` ANTES de que el JSON entre a `curriculum.ts`
  (regla ya enforced). **Sin pausa de confirmación con Edgar** — ya indicó que no hace falta
  repreguntar esto (ver memoria `no-repreguntar-licencia-ya-aprobada`).
  `ExerciseObjective` (`matar | vivir | ko | desconocido`) — sin extender el enum. Mapeo:
  captura → `matar`; asegurar el segundo ojo / defender → `vivir`. Ningún ejercicio del Bloque 2
  necesita `ko` (eso fue exclusivo del taller 3) ni `desconocido`.
- **`practiceOpponent: { rank: '20k', boardSize: 9 }`** en las 5 lecciones — igual que el Bloque 1.
- Cada task de autoría termina con `checkObjective`/`exerciseIssues` en `[]` por posición (validado
  ANTES de comitear, mismo protocolo que el Bloque 1) + `npm run typecheck -w @tengen/web` +
  `npm test -w @tengen/web` en verde antes de pasar a la siguiente.

## File Structure

- `apps/web/src/learn/data/bloque-2.json` (nuevo, se extiende tarea a tarea) — las 5 lecciones del
  Bloque 2 (`b2-l6`..`b2-l10`, `workshop: 6`..`10`).
- `apps/web/content/tsumego/bloque-2/leccion-{6,7,8,9,10}.md` (nuevos) — notas de procedencia.
- `apps/web/src/learn/curriculum.ts` (modificado) — importa también `bloque-2.json`, concatena.
- `apps/web/src/ui/AprenderView.tsx` (modificado, mínimo) — generaliza el título "Currículo --
  Bloque 1" y los comentarios que mencionan solo el Bloque 1, ya que ahora cubre ambos.
- `docs/research/fase-aprender/contenido-licencias.md` (modificado) — veredicto del Bloque 2.
- `apps/web/tests/learnData.test.ts` — NO se modifica (el `describe('CURRICULUM', ...)` ya es
  genérico sobre `CURRICULUM.length`, cubre el Bloque 2 automáticamente en cuanto se registre).

---

# Tareas

## Task 1: Veredicto de licencia — Bloque 2

**Files:**
- Modify: `docs/research/fase-aprender/contenido-licencias.md`

- [ ] **Step 1:** agregar, debajo de la entrada del veredicto del Bloque 1, una nueva subsección
  `### Veredicto — Bloque 2 del currículo (talleres 6-10), 100% original` con el mismo criterio
  textual que la del Bloque 1 (posiciones compuestas a mano, inspiradas en la estructura de
  FEDIBERGO, sin reproducir diagramas ni texto; árboles validados por `objectiveCheck.ts`, sin
  motor — todo el currículo es engineless desde el fix final del Bloque 1, no solo por Pieza 3).
  Fuente committeada en `apps/web/content/tsumego/bloque-2/`.
- [ ] **Step 2:** commit — `git commit -m "docs: veredicto de licencia para el Bloque 2 del currículo FEDIBERGO"`
  (sin pausa de confirmación — ver Decisiones tomadas).

---

## Task 2: Autoría de la Lección 6 — "Un ojo no alcanza, dos ojos sí" (taller 6)

**Files:**
- Create: `apps/web/content/tsumego/bloque-2/leccion-6.md`
- Create: `apps/web/src/learn/data/bloque-2.json` (arranca con 1 elemento)

**Interfaces:** consume `checkObjective` (`apps/web/src/learn/objectiveCheck.ts`, sin cambios),
`exerciseIssues`/`lessonIssues` — mismo protocolo de validación posición-por-posición que el
Bloque 1 (Task 5 de ese plan): escribir el JSON, correr `checkObjective`/`exerciseIssues` vía
script descartable, no continuar hasta `wrongCorrect: []` y `exerciseIssues: []`.

- [ ] **Step 1: Teoría** (original, español, 3-4 párrafos): qué es un grupo con UN ojo (se puede
  matar rellenando las libertades externas hasta que solo quede el ojo, y luego jugando ahí), qué
  es un grupo con DOS ojos separados (inmortal: el rival no puede jugar en ninguno de los dos sin
  suicidarse), y la idea de "punto vital" como la jugada que decide si el grupo llega a tener uno o
  dos ojos. Fuente pedagógica (no copiar texto): `guiaDelTaller06.pdf`,
  `ayudaMemoriaTalleres06a10.pdf`.
- [ ] **Step 2: Componer y validar 6 posiciones**, mismo protocolo que el Bloque 1:

  | # | Objetivo pedagógico | `objective` |
  |---|---|---|
  | 1 | Grupo con un ojo, atari — captura directa | `matar` |
  | 2 | Grupo con un ojo pero AÚN no en atari — rellenar la libertad externa que falta antes de poder matarlo (distractor: jugar el ojo de una vez es ilegal/no logra nada todavía) | `matar` |
  | 3 | Grupo propio con un ojo formado, punto vital para el segundo — jugarlo salva el grupo | `vivir` |
  | 4 | Grupo propio con dos ojos YA separados — ninguna jugada del rival lo amenaza; el problema pide identificar que el grupo YA está vivo (ejercicio de "no hay nada que hacer", con la jugada correcta siendo defender en otro punto real o, si el formato de un-solo-`correct` no calza, rediseñar como #1/#3 con una variante más simple — decisión del implementador, documentar el porqué) | `vivir` o `matar`, según el rediseño |
  | 5 | Punto vital que decide el SEGUNDO ojo cuando hay más de una forma geométrica posible — usar `checkObjective` para confirmar `unmarkedAlternatives` y resolver (marcar ambas `correct`, o achicar la posición) | `vivir` |
  | 6 | Distractor: dos grupos con un ojo cada uno, solo uno realmente capturable esta jugada (el otro todavía tiene una libertad externa) | `matar` |

  **Nota sobre #4:** es el caso más propenso a topar el riesgo conocido (`objectiveCheck` exige
  EXACTAMENTE 1 libertad para `vivir`) — un grupo con dos ojos ya formados normalmente tiene MÁS de
  1 libertad y ninguna jugada rival lo pone en atari real. Si el diseño literal no es verificable
  con el árbitro automático, seguir el patrón de la Lección 4 del Bloque 1 (Task 9 de ese plan):
  redsieñar sin perder el punto pedagógico, documentando el razonamiento en el commit/reporte.
- [ ] **Step 3:** ensamblar `bloque-2.json` (primer elemento: `"id": "b2-l6"`, `"block": 2`,
  `"workshop": 6`, `"checkpoint": false`, `"practiceOpponent": {"rank":"20k","boardSize":9}`).
- [ ] **Step 4:** escribir `leccion-6.md` (mismo shape que las de Bloque 1, citando
  `guiaDelTaller06.pdf` + `ayudaMemoriaTalleres06a10.pdf`).
- [ ] **Step 5:** commit — `git commit -m "content(learn): Lección 6 del Bloque 2 -- un ojo no alcanza, dos ojos sí"`

---

## Task 3: Autoría de la Lección 7 — "Ojo verdadero, ojo falso" (taller 7)

**Files:**
- Modify: `apps/web/src/learn/data/bloque-2.json` (agrega 1 lección)
- Create: `apps/web/content/tsumego/bloque-2/leccion-7.md`

- [ ] **Step 1: Teoría** (original, 3-4 párrafos): qué distingue un ojo verdadero de uno falso (la
  diagonal sin reforzar que el rival puede cortar), y una primera noción de territorio (espacio
  vacío que un grupo vivo controla). NO se menciona conteo de puntos como tarea del alumno (decisión
  tomada arriba) — puede mencionarse como concepto ("el territorio se cuenta al final de la
  partida") sin pedirlo como ejercicio. Fuente: `guiaDelTaller07.pdf`,
  `ayudaMemoriaTalleres06a10.pdf`.
- [ ] **Step 2: Componer y validar 6 posiciones:**

  | # | Objetivo pedagógico | `objective` |
  |---|---|---|
  | 1 | Grupo con un ojo falso (diagonal sin reforzar) — el rival corta y termina capturando | `matar` |
  | 2 | Grupo propio con un ojo falso — reforzar la diagonal ANTES de que el rival corte, salva el grupo | `vivir` |
  | 3 | Grupo con un ojo verdadero + un ojo falso — el rival ataca el falso, jugada correcta lo repara | `vivir` |
  | 4 | Grupo con dos ojos verdaderos — mismo caso límite que la Lección 6 #4, mismo criterio de rediseño si hace falta | `vivir` o `matar` |
  | 5 | Distractor: grupo con un ojo verdadero y forma que PARECE ojo falso pero no lo es (la diagonal ya está reforzada) — la jugada "correcta" ingenua no logra nada | `matar` (identificar que TODAVÍA no hay captura posible) |
  | 6 | Territorio simple: grupo vivo con espacio vacío alrededor, jugada que cierra una invasión | `matar` |
- [ ] **Step 3:** ensamblar tercer elemento (`"id": "b2-l7"`, `"workshop": 7`).
- [ ] **Step 4:** `leccion-7.md`.
- [ ] **Step 5:** commit — `"content(learn): Lección 7 del Bloque 2 -- ojo verdadero, ojo falso"`

---

## Task 4: Autoría de la Lección 8 — "Ataris sucesivos y conexiones" (taller 8)

**Files:**
- Modify: `apps/web/src/learn/data/bloque-2.json` (agrega 1 lección)
- Create: `apps/web/content/tsumego/bloque-2/leccion-8.md`

- [ ] **Step 1: Teoría** (original, 3-4 párrafos): ataris sucesivos ("captura de persecución" — el
  rival huye del atari, pero cae en otro), atari contra el borde (reusa la idea de la Lección 5 del
  Bloque 1, ahora con más piedras en juego), conexión abierta y conexión por el borde como técnicas
  de defensa. Fuente: `guiaDelTaller08.pdf`, `ayudaMemoriaTalleres06a10.pdf`.
- [ ] **Step 2: Componer y validar 6 posiciones:**

  | # | Objetivo pedagógico | `objective` |
  |---|---|---|
  | 1 | Atari sucesivo: la cadena huye una vez pero cae en un segundo atari real — la jugada CORRECTA es el segundo atari (captura genuina en una jugada, mismo cuidado que la escalera de la Lección 5 del Bloque 1: `achievesObjective('matar')` solo valida UNA jugada, diseñar el paso final real) | `matar` |
  | 2 | Atari contra el borde, variante con más piedras que la Lección 5 del Bloque 1 | `matar` |
  | 3 | Conexión abierta (hueco de un punto) que salva dos grupos amenazados | `vivir` |
  | 4 | Conexión por el borde | `vivir` |
  | 5 | Distractor: una conexión que PARECE necesaria pero los dos grupos ya están seguros por separado (no hace falta conectar) — identificar que la amenaza real es otra | `matar` o `vivir`, según cuál sea la jugada realmente correcta |
  | 6 | Cadena en atari con una única salida real (no hay conexión posible, solo extender) — contraste con #3/#4 | `vivir` |
- [ ] **Step 3:** ensamblar cuarto elemento (`"id": "b2-l8"`, `"workshop": 8`).
- [ ] **Step 4:** `leccion-8.md`.
- [ ] **Step 5:** commit — `"content(learn): Lección 8 del Bloque 2 -- ataris sucesivos y conexiones"`

---

## Task 5: Autoría de la Lección 9 — "Ojos grandes" (taller 9)

**Files:**
- Modify: `apps/web/src/learn/data/bloque-2.json` (agrega 1 lección)
- Create: `apps/web/content/tsumego/bloque-2/leccion-9.md`

- [ ] **Step 1: Teoría** (original, 3-4 párrafos): ojos grandes (espacio de 4+ puntos que puede
  convertirse en dos ojos o ser reducido a uno según quién juegue primero — reusa la idea de la
  Lección 4 del Bloque 1, ahora en un contexto de partida real en vez de atari-go), mención breve
  del nigiri (sortear el color al empezar una partida real — NO se modela como ejercicio, es
  contexto). Sin mencionar komi (todavía no se introduce en FEDIBERGO). Fuente:
  `guiaDelTaller09.pdf`, `ayudaMemoriaTalleres06a10.pdf`.
- [ ] **Step 2: Componer y validar 6 posiciones:** mismo patrón que la Lección 4 del Bloque 1
  (ojo grande, punto vital, intruso a capturar), pero con formas de ojo DISTINTAS a las ya usadas
  ahí (no repetir la misma geometría exacta):

  | # | Objetivo pedagógico | `objective` |
  |---|---|---|
  | 1 | Ojo grande (4-5 puntos) con punto vital real — jugarlo reduce a un ojo, captura eventual | `matar` |
  | 2 | Ojo grande donde el rival YA jugó el punto vital — capturar esa piedra intrusa antes de que se asiente | `matar` |
  | 3 | Grupo propio con ojo grande, jugar el punto vital ANTES que el rival asegura dos ojos | `vivir` |
  | 4 | Distractor: ojo grande con suficientes libertades externas, no está amenazado todavía | `matar` (identificar que TODAVÍA no hay captura posible) |
  | 5 | Ojo grande de forma distinta (p.ej. en L o en T en vez de recto) — mismo concepto, geometría nueva | `matar` o `vivir` |
  | 6 | Grupo con ojo grande + un ojo chico ya asegurado — el punto vital del grande decide si sobrevive con dos ojos totales | `vivir` |
- [ ] **Step 3:** ensamblar quinto elemento (`"id": "b2-l9"`, `"workshop": 9`).
- [ ] **Step 4:** `leccion-9.md`.
- [ ] **Step 5:** commit — `"content(learn): Lección 9 del Bloque 2 -- ojos grandes"`

---

## Task 6: Autoría de la Lección 10 — Checkpoint: repaso de talleres 6-9

**Files:**
- Modify: `apps/web/src/learn/data/bloque-2.json` (agrega el 5º y último elemento del Bloque 2)
- Create: `apps/web/content/tsumego/bloque-2/leccion-10.md`

- [ ] **Step 1: Teoría** (original, 3-4 párrafos, tono de REPASO — no tema nuevo): resumir en
  palabras propias lo aprendido en talleres 6-9 (un ojo no alcanza, ojo verdadero vs. falso,
  ataris sucesivos y conexiones, ojos grandes) como preparación para practicar todo junto. Sin cita
  de fuente puntual más allá de `guiaDelTaller10.pdf`/`guiaParaLaRealizacionDeLosTalleres.pdf`
  (que confirman que el taller real tampoco introduce concepto nuevo acá).
- [ ] **Step 2: Componer y validar 6 posiciones — MEZCLA deliberada de las técnicas de 6-9**, no
  tema nuevo: por ejemplo 2 de captura de ojo/ojo falso, 2 de atari sucesivo/conexión, 2 de ojo
  grande — variando la geometría respecto a las lecciones anteriores (no reusar posiciones
  idénticas, el punto pedagógico de un repaso es reconocer el patrón en una forma distinta).
- [ ] **Step 3:** ensamblar sexto y último elemento de `bloque-2.json` (`"id": "b2-l10"`,
  `"workshop": 10`, **`"checkpoint": true`** — primer uso real de este campo).
- [ ] **Step 4:** `leccion-10.md`.
- [ ] **Step 5:** commit — `"content(learn): Lección 10 del Bloque 2 -- checkpoint, repaso de talleres 6-9"`

---

## Task 7: `curriculum.ts` — extender con el Bloque 2

**Files:**
- Modify: `apps/web/src/learn/curriculum.ts`

**Interfaces:** consume `bloque-2.json` (Task 2-6); produce `CURRICULUM` con 10 lecciones (5+5) —
consumido sin cambios por `AprenderView`/`isLessonUnlocked`, ya genéricos sobre el array completo.

- [ ] **Step 1:** cambiar el import único por dos, y concatenar:
  ```ts
  import bloque1 from './data/bloque-1.json'
  import bloque2 from './data/bloque-2.json'

  export const CURRICULUM: readonly Lesson[] = [...bloque1, ...bloque2] as unknown as readonly Lesson[]
  ```
- [ ] **Step 2:** correr `npm test -w @tengen/web -- learnData.test` — el `describe('CURRICULUM',
  ...)` existente (genérico, sin hardcodear cantidad de lecciones) debe pasar con las 10 lecciones,
  incluido el chequeo de `workshop` estrictamente creciente (`[1,2,3,4,5,6,7,8,9,10]`) y el
  `checkObjective` exhaustivo agregado en el fix final del Bloque 1 (30+30=60 exercises, todos
  `wrongCorrect: []`).
- [ ] **Step 3:** typecheck + suite completa (`npm run typecheck -w @tengen/web && npm test -w
  @tengen/web`).
- [ ] **Step 4:** commit — `"feat(learn): curriculum.ts incluye el Bloque 2 (talleres 6-10)"`

---

## Task 8: `AprenderView.tsx` — generalizar el título y los comentarios de "Bloque 1"

**Files:**
- Modify: `apps/web/src/ui/AprenderView.tsx`

Cambio mínimo, puramente de presentación — la lógica (desbloqueo, engineless, práctica) ya funciona
sin cambios para el Bloque 2, según lo establecido en Decisiones tomadas.

- [ ] **Step 1:** cambiar el header hardcodeado `<h2>Currículo -- Bloque 1</h2>` (línea ~186) por
  algo que no mienta ahora que hay 2 bloques — mínimo viable: `<h2>Currículo</h2>` a secas (la
  lista ya muestra los títulos de cada lección, que incluyen su contexto). Si se prefiere seguir
  distinguiendo visualmente el bloque de cada lección dentro de la lista, es una mejora de UI
  legítima pero NO requerida por este plan — decisión del implementador, documentar si se aparta
  del mínimo.
- [ ] **Step 2:** actualizar los comentarios que mencionan "las 5 lecciones del Bloque 1" (líneas
  ~7-9, ~29-31, ~155-162) para reflejar que aplica a TODO `CURRICULUM`, no solo al Bloque 1 —
  mismo contenido técnico (todo engineless, motivo del spike), solo generalizar el alcance del
  comentario.
- [ ] **Step 3:** correr la suite de tests de `AprenderView.test.tsx` — confirmar que ningún test
  existente dependía del texto literal "Bloque 1" (si alguno lo hace, actualizarlo para que siga
  siendo un test significativo, no borrarlo).
- [ ] **Step 4:** typecheck + suite completa.
- [ ] **Step 5:** commit — `"feat(learn): AprenderView ya no asume que el currículo es solo el Bloque 1"`

---

## Task 9: Verificación final y gate manual

- [ ] Typecheck de los 3 workspaces + suite completa de `@tengen/web` en verde.
- [ ] Build de producción (`npm run build -w @tengen/web`) exitoso.
- [ ] Revisión final de todo el rango (implementador+revisor por task, más una revisión final del
  rango completo del Bloque 2 — mismo proceso `subagent-driven-development` que el Bloque 1).
- [ ] Gate manual de Edgar en Chrome: abrir `/aprender`, confirmar que la Lección 6 se desbloquea
  al completar la Lección 5 (frontera Bloque 1 → Bloque 2), resolver al menos una lección completa
  del Bloque 2, y llegar hasta la Lección 10 (checkpoint) para confirmar que se ve/comporta igual
  que las demás.
- [ ] Deploy a producción (`wrangler deploy`) — con la misma confirmación explícita que el Bloque 1
  (repo público + sitio público real), no automático.
