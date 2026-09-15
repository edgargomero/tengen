# Bloque 1 del currículo FEDIBERGO — plan de implementación

> **Para ejecutores agénticos:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos
> usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Objetivo:** construir el piloto del Bloque 1 (5 lecciones) del currículo de FEDIBERGO en la fase
Aprender de tengen — teoría original + 6 problemas por lección, resueltos sin motor donde las
reglas alcanzan, con una partida de práctica final contra Human SL 20k.

**Arquitectura:** un tipo `Lesson` nuevo envuelve `Exercise[]` + teoría + oponente sugerido; el
`ExercisePlayer` existente se reusa sin cambios de fondo, ganando un modo `engineless` para las
Lecciones 1-3 (nunca pide el motor); el desbloqueo secuencial es una función derivada sobre el
`ProgressMap` que ya existe, sin storage nuevo; la práctica reusa `NewGameForm` con un prop de
prefill nuevo.

**Tech Stack:** Preact + TypeScript (`apps/web`), `@sabaki/go-board` (reglas, vía `game/rules.ts`),
`@sabaki/shudan` (tablero), Vitest (Node + jsdom).

**Spec:** `docs/superpowers/specs/2026-09-15-aprender-curriculo-design.md` — este plan implementa
su Pieza 1 (tipo `Lesson`), Pieza 2 (desbloqueo), Pieza 3 (verificación sin motor / spot-check) y
Pieza 4 (UI), con UNA extensión que la spec no cubría: el modo `engineless` de runtime (Task 10),
necesario para que la Pieza 3 sea cierta en la práctica y no solo en el contenido. Los ejecutores
leen la spec Y este plan — la spec explica el porqué, el plan el cómo exacto.

## Global Constraints

- **`Exercise.boardSize`** pasa de literal `19` a `BoardSize` (9 | 13 | 19) — verificado como cambio
  de tipo puro (spec, sección "Decisiones tomadas").
- **Piso de Human SL = `20k`** (`HUMAN_RANKS[0]`), cerrado — la práctica del Bloque 1 usa ese rango.
- **Lecciones 1-3 (jugada/captura, cadenas grandes, ko): CERO llamadas al motor**, ni para abrir el
  ejercicio ni para juzgar un intento fuera del árbol. El árbitro es `objectiveCheck.ts` (Task 3) +
  el modo `engineless` de `ExercisePlayer` (Task 10).
- **Lecciones 4-5 (ojos, técnicas): spot-check contra KataGo desktop, condicionado a un spike**
  (Task 8) — si el score no separa con margen claro, caen al mismo checker de reglas + revisión
  manual, NO se relaja el criterio.
- **Contenido 100% original de tengen** — inspirado en la estructura de FEDIBERGO, nunca sus
  diagramas. Veredicto de licencia escrito (Task 1) ANTES de que cualquier JSON entre a
  `curriculum.ts`.
- **Teoría en el bundle**, `readonly string[]` de texto plano — sin librería de Markdown.
- **Progreso: desbloqueo DERIVADO** sobre `ProgressMap` (`tengen:learn:v1`) — sin campo nuevo, sin
  migración.
- **Selector de rango: reusar `HumanRank`/`HUMAN_RANKS` de `NewGameForm.tsx`** — sin componente
  nuevo de selección.
- Cada task termina con `npm run typecheck -w @tengen/web` y `npm test -w @tengen/web` en verde
  antes de pasar a la siguiente.

## File Structure

- `apps/web/src/learn/lesson.ts` (nuevo) — tipo `Lesson` + `lessonIssues()`.
- `apps/web/src/learn/objectiveCheck.ts` (nuevo) — el árbitro de reglas puras (Pieza 3).
- `apps/web/src/learn/curriculum.ts` (nuevo) — registro `CURRICULUM`, mismo patrón que
  `collections.ts`.
- `apps/web/src/learn/data/bloque-1.json` (nuevo, se extiende tarea a tarea) — las 5 lecciones.
- `apps/web/src/learn/progress.ts` (modificado) — `isLessonUnlocked()`.
- `apps/web/src/ui/ExercisePlayer.tsx` (modificado) — prop `engineless`.
- `apps/web/src/ui/NewGameForm.tsx` (modificado) — prop `initial`.
- `apps/web/src/ui/AprenderView.tsx` (modificado) — nivel de currículo.
- `apps/web/tests/learnData.test.ts` (modificado) — cubre `CURRICULUM` con `lessonIssues`.
- `docs/research/fase-aprender/contenido-licencias.md` (modificado) — veredicto del Bloque 1.

---

## Contexto (histórico — de la exploración original)

Tengen tiene desde esta semana una copia de referencia del material de enseñanza de FEDIBERGO
(`fedibergo-ensananza/`, 50 PDFs, uso declarado como público por Edgar). El pedido: no un plan de
estudio personal, sino diseñar cómo ese currículum —probado en la práctica con niños de escuela
primaria— se convierte en contenido real de la fase **Aprender** de tengen, sirviendo tanto a niños
como a adultos, con la práctica jugándose dentro de tengen contra **Human SL calibrado por kyu**.

La investigación (5 sub-agentes de exploración) confirmó tres cosas que definen el diseño:

1. **La estructura pedagógica de FEDIBERGO está muy probada y es estrictamente secuencial** — no es
   una bolsa de ejercicios, es un curso de 30 lecciones con dependencias reales entre sí.
2. **El modelo de datos actual de Aprender no alcanza para este formato** — hoy solo modela
   problemas sueltos de tsumego, sin texto de teoría, sin agrupación en lecciones, sin orden forzado.
3. **El mecanismo de "jugar contra un kyu específico" ya existe de punta a punta en el motor**
   (Human SL + `meta_input` de rango) y ya está expuesto en `NewGameForm` — pero no en Aprender, y
   su piso real es **20k**, no los niveles más bajos que describe la escala interna de FEDIBERGO.

**El resto del diseño (currículo de FEDIBERGO resumido, mapeo de práctica a kyu, brecha técnica,
relación con Aprender v2, alcance del piloto) está en la spec — no se repite acá.** Este documento
es el CÓMO exacto, tarea por tarea, para el Bloque 1 (talleres 1-5) solamente.

---

# Tareas

## Task 1: Veredicto de licencia — currículo Bloque 1

**Files:**
- Modify: `docs/research/fase-aprender/contenido-licencias.md`

**Interfaces:** ninguna (documentación).

- [ ] **Step 1: Agregar la entrada del veredicto**

Justo debajo de `### Spot-check ejecutado — «Primeros pasos» (2026-08-04): TODO OK` (o como nueva
subsección de `## Material de FEDIBERGO`), agregar:

```markdown
### Veredicto — Bloque 1 del currículo (talleres 1-5), 100% original

Mismo criterio que «Primeros pasos»: **posiciones compuestas a mano para este proyecto**, inspiradas
en la estructura pedagógica de FEDIBERGO (orden de temas, tipo de problema) pero SIN reproducir sus
diagramas ni su texto. La teoría de cada lección es redacción original de tengen, no traducción ni
resumen ceñido del PDF.

Árboles de solución de las Lecciones 1-3 (jugada, captura, ko) validados por reglas puras
(`objectiveCheck.ts`, sin motor — ver spec `2026-09-15-aprender-curriculo-design.md`, Pieza 3).
Lecciones 4-5 (ojos, técnicas), condicionado al spike de la Task 8: spot-check con KataGo desktop
(mismo protocolo de este documento) o, si el spike falla, el mismo chequeo de reglas + revisión
manual de Edgar.

Fuente committeada en `apps/web/content/tsumego/bloque-1/` (obra del repo). El registro
`learn/curriculum.ts` solo importa después de que esta entrada exista — misma regla que
`collections.ts` aplica a `COLLECTIONS`.
```

- [ ] **Step 2: Pedir confirmación a Edgar del texto exacto antes de continuar**

Este paso es una pausa, no una automatización: mostrar el párrafo agregado y esperar el visto bueno
antes de la Task 4 (primer contenido real). Es la única decisión de la spec que quedó explícitamente
en manos de Edgar.

- [ ] **Step 3: Commit**

```bash
git add docs/research/fase-aprender/contenido-licencias.md
git commit -m "docs: veredicto de licencia para el Bloque 1 del currículo FEDIBERGO"
```

---

## Task 2: El tipo `Lesson`

**Files:**
- Create: `apps/web/src/learn/lesson.ts`
- Test: `apps/web/tests/lesson.test.ts`

**Interfaces:**
- Consumes: `Exercise`, `exerciseIssues` de `../src/learn/exercise.ts`; `HumanRank`, `BoardSize` de
  `@tengen/engine`.
- Produces: `Lesson` (tipo), `lessonIssues(lesson: Lesson): string[]` — consumidos por Task 5
  (`curriculum.ts`) y Task 13 (tests de contenido).

- [ ] **Step 1: Escribir el tipo y el validador**

```ts
// apps/web/src/learn/lesson.ts
// Bloque 1 del currículo FEDIBERGO (spec 2026-09-15-aprender-curriculo-design.md, Pieza 1): una
// Lesson envuelve teoría + 6 Exercise + el oponente sugerido para la partida de práctica. Mismo
// patrón que exercise.ts: tipo + validador de forma, sin lógica de UI ni de motor acá.
import type { HumanRank, BoardSize } from '@tengen/engine'
import { exerciseIssues, type Exercise } from './exercise'

export interface Lesson {
  id: string
  block: number
  workshop: number
  title: string
  /** Párrafos de texto plano -- sin Markdown (ver Global Constraints). */
  theory: readonly string[]
  exercises: readonly Exercise[]
  /** true en los talleres 10/20/30 -- el campo se define ahora aunque el piloto no lo ejercita. */
  checkpoint: boolean
  practiceOpponent: { rank: HumanRank; boardSize: BoardSize }
}

/** Problemas de forma de una Lesson. [] = apta. Reusa exerciseIssues por cada ejercicio -- no
 * duplica sus reglas de legalidad/forma. */
export function lessonIssues(lesson: Lesson): string[] {
  const issues: string[] = []
  if (lesson.title.trim() === '') issues.push('title vacío')
  if (lesson.theory.length === 0) issues.push('theory vacía: la lección no tiene texto')
  lesson.theory.forEach((p, i) => {
    if (p.trim() === '') issues.push(`theory[${i}] es un párrafo vacío`)
  })
  if (lesson.exercises.length !== 6) {
    issues.push(`exercises.length debe ser 6, es ${lesson.exercises.length}`)
  }
  lesson.exercises.forEach((ex, i) => {
    for (const issue of exerciseIssues(ex)) issues.push(`exercises[${i}]: ${issue}`)
  })
  return issues
}
```

- [ ] **Step 2: Escribir el test (forma inválida y forma válida)**

```ts
// apps/web/tests/lesson.test.ts
import { describe, it, expect } from 'vitest'
import { lessonIssues, type Lesson } from '../src/learn/lesson'
import type { Exercise } from '../src/learn/exercise'

function validExercise(id: string): Exercise {
  return {
    id,
    collection: 'test',
    boardSize: 9,
    setup: { black: [{ x: 3, y: 4 }], white: [{ x: 2, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 3 }] },
    toPlay: 'white',
    objective: 'matar',
    tree: {
      children: [
        { move: { color: 'white', vertex: { x: 3, y: 5 } }, correct: true, children: [] },
      ],
    },
  }
}

const validLesson: Lesson = {
  id: 'b1-l1',
  block: 1,
  workshop: 1,
  title: 'La jugada y la captura',
  theory: ['Párrafo uno.', 'Párrafo dos.'],
  exercises: Array.from({ length: 6 }, (_, i) => validExercise(`ex-${i}`)),
  checkpoint: false,
  practiceOpponent: { rank: '20k', boardSize: 9 },
}

describe('lessonIssues', () => {
  it('acepta una lección válida', () => {
    expect(lessonIssues(validLesson)).toEqual([])
  })

  it('rechaza menos de 6 ejercicios', () => {
    const issues = lessonIssues({ ...validLesson, exercises: validLesson.exercises.slice(0, 3) })
    expect(issues).toContain('exercises.length debe ser 6, es 3')
  })

  it('rechaza theory vacía', () => {
    expect(lessonIssues({ ...validLesson, theory: [] })).toContain('theory vacía: la lección no tiene texto')
  })

  it('propaga un exerciseIssues real (setup vacío)', () => {
    const broken = { ...validExercise('broken'), setup: { black: [], white: [] } }
    const issues = lessonIssues({ ...validLesson, exercises: [broken, ...validLesson.exercises.slice(1)] })
    expect(issues.some((i) => i.includes('setup vacío'))).toBe(true)
  })
})
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -w @tengen/web -- lesson.test`
Expected: 4 passed.

- [ ] **Step 4: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores (confirma que `boardSize: 9` en el `Exercise` de prueba tipa bien contra
`BoardSize` -- si esto falla, la Task 3's widening de `Exercise.boardSize` está mal secuenciada).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/learn/lesson.ts apps/web/tests/lesson.test.ts
git commit -m "feat(learn): tipo Lesson y su validador de forma"
```

---

## Task 3: Ensanchar `Exercise.boardSize` a `BoardSize`

**Files:**
- Modify: `apps/web/src/learn/exercise.ts:30`

**Interfaces:**
- Produces: `Exercise.boardSize: BoardSize` en vez de `19` -- todo lo que ya consume `boardSize`
  (`ExercisePlayer.tsx`, `AprenderView.tsx`) sigue compilando sin cambios porque ya lo leen
  genéricamente (verificado en la spec).

- [ ] **Step 1: Cambiar el tipo**

```ts
// apps/web/src/learn/exercise.ts -- reemplazar:
//   boardSize: 19
// por:
import type { BoardSize, Move, StoneColor } from '@tengen/engine'
// ...
export interface Exercise {
  id: string
  collection: string
  boardSize: BoardSize
  setup: SetupStones
  toPlay: StoneColor
  objective: ExerciseObjective
  difficulty?: number
  tree: ExerciseNode
}
```

- [ ] **Step 2: Typecheck de los 3 workspaces**

Run: `npm run typecheck`
Expected: sin errores. Si `primeros-pasos.json` (boardSize 19, vía `as unknown as readonly
Exercise[]`) o algo más falla, es una señal real -- no forzar el cast a ciegas, leer el error.

- [ ] **Step 3: Correr toda la suite de `@tengen/web`**

Run: `npm test -w @tengen/web`
Expected: todo verde, en particular `learnData.test.ts` (los `Exercise` de "Primeros pasos" a 19
siguen siendo válidos: `BoardSize` incluye 19).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/learn/exercise.ts
git commit -m "feat(learn): Exercise.boardSize admite 9/13/19, no solo 19"
```

---

## Task 4: `objectiveCheck.ts` -- el árbitro de reglas puras (Pieza 3)

**Files:**
- Create: `apps/web/src/learn/objectiveCheck.ts`
- Test: `apps/web/tests/objectiveCheck.test.ts`

**Interfaces:**
- Consumes: `boardFromMoves`, `applyMove`, `capturesOf`, `validateMove` de `../game/rules.ts`;
  `colorToSign` de `../game/coords.ts`; `Exercise` de `./exercise.ts`.
- Produces: `checkObjective(exercise: Exercise): ObjectiveCheckResult` -- consumido por la Task 13
  (tests de contenido de las Lecciones 1-3) y por cada task de autoría (7, 9) como comando manual.

- [ ] **Step 1: Escribir el árbitro**

```ts
// apps/web/src/learn/objectiveCheck.ts
// Bloque 1 (spec 2026-09-15-aprender-curriculo-design.md, Pieza 3): árbitro de reglas puras para
// las Lecciones 1-3. Recorre CADA punto jugable de la posición inicial y confirma, con las mismas
// reglas que usa una partida real, qué jugada logra el objetivo pedagógico -- sin motor. Más
// estricto que exerciseIssues (que confía en el `correct` horneado) en una sola dirección: un nodo
// `correct` que no logra el objetivo es un error real; un punto que lo logra sin estar marcado es
// un reporte para resolver a mano (agregarlo como `correct` extra o achicar la posición), porque el
// propio enunciado de FEDIBERGO admite más de una jugada válida en los problemas de defensa.
import GoBoard from '@sabaki/go-board'
import type { StoneColor } from '@tengen/engine'
import { boardFromMoves, applyMove, capturesOf, validateMove } from '../game/rules'
import { colorToSign } from '../game/coords'
import type { Exercise } from './exercise'

export interface ObjectiveCheckResult {
  wrongCorrect: { x: number; y: number }[]
  unmarkedAlternatives: { x: number; y: number }[]
}

function opposite(color: StoneColor): StoneColor {
  return color === 'black' ? 'white' : 'black'
}

/** Grupos del color `color` con exactamente 1 libertad en `board` -- "en atari". */
function groupsInAtari(board: GoBoard, color: StoneColor): { x: number; y: number }[][] {
  const sign = colorToSign(color)
  const seen = new Set<string>()
  const groups: { x: number; y: number }[][] = []
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (board.get([x, y]) !== sign) continue
      const key = `${x},${y}`
      if (seen.has(key)) continue
      const chain = board.getChain([x, y])
      chain.forEach(([cx, cy]) => seen.add(`${cx},${cy}`))
      if (board.getLiberties([x, y]).length === 1) {
        groups.push(chain.map(([cx, cy]) => ({ x: cx, y: cy })))
      }
    }
  }
  return groups
}

function achievesObjective(exercise: Exercise, v: { x: number; y: number }): boolean {
  const before = boardFromMoves(exercise.boardSize, 0, [], exercise.setup)
  if (!validateMove(before, exercise.toPlay, v).legal) return false

  if (exercise.objective === 'matar') {
    const capturesBefore = capturesOf(before)
    const after = applyMove(before, exercise.toPlay, v)
    return capturesOf(after)[exercise.toPlay] > capturesBefore[exercise.toPlay]
  }

  if (exercise.objective === 'vivir') {
    const atGroups = groupsInAtari(before, exercise.toPlay)
    if (atGroups.length === 0) return false
    const after = applyMove(before, exercise.toPlay, v)
    return atGroups.some((group) => {
      const anchor = group[0]
      if (!anchor) return false
      if (after.get([anchor.x, anchor.y]) !== colorToSign(exercise.toPlay)) return false
      return after.getLiberties([anchor.x, anchor.y]).length >= 2
    })
  }

  if (exercise.objective === 'ko') {
    const capturesBefore = capturesOf(before)
    const after = applyMove(before, exercise.toPlay, v)
    if (capturesOf(after)[exercise.toPlay] <= capturesBefore[exercise.toPlay]) return false
    const diff = before.diff(after) ?? []
    const captured = diff.find(([x, y]) => after.get([x, y]) === 0 && before.get([x, y]) !== 0)
    if (!captured) return false
    const recapture = validateMove(after, opposite(exercise.toPlay), { x: captured[0], y: captured[1] })
    return !recapture.legal && recapture.reason === 'ko'
  }

  return false
}

/** Todos los vértices del tablero (ocupados incluidos -- `achievesObjective` los descarta por
 * `validateMove` devolviendo overwrite=ilegal, así que no hace falta filtrarlos acá). */
function everyVertex(boardSize: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = []
  for (let y = 0; y < boardSize; y++) for (let x = 0; x < boardSize; x++) points.push({ x, y })
  return points
}

export function checkObjective(exercise: Exercise): ObjectiveCheckResult {
  const correctVertices = exercise.tree.children
    .filter((c) => c.move !== undefined && c.move.vertex !== 'pass' && c.correct === true)
    .map((c) => (c.move!.vertex as { x: number; y: number }))

  const wrongCorrect = correctVertices.filter((v) => !achievesObjective(exercise, v))

  const correctKeys = new Set(correctVertices.map((v) => `${v.x},${v.y}`))
  const unmarkedAlternatives = everyVertex(exercise.boardSize).filter(
    (v) => !correctKeys.has(`${v.x},${v.y}`) && achievesObjective(exercise, v),
  )

  return { wrongCorrect, unmarkedAlternatives }
}
```

- [ ] **Step 2: Escribir los tests -- contra los dos ejercicios ya verificados a mano**

```ts
// apps/web/tests/objectiveCheck.test.ts
import { describe, it, expect } from 'vitest'
import { checkObjective } from '../src/learn/objectiveCheck'
import type { Exercise } from '../src/learn/exercise'

describe('checkObjective', () => {
  it('matar: captura de una cadena de 2 piedras -- (4,5) es la única correcta', () => {
    const ex: Exercise = {
      id: 'b1-l1-02', collection: 'bloque-1-leccion-1', boardSize: 9,
      setup: {
        black: [{ x: 3, y: 4 }, { x: 4, y: 4 }],
        white: [{ x: 2, y: 4 }, { x: 4, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 5 }, { x: 5, y: 4 }],
      },
      toPlay: 'white', objective: 'matar',
      tree: { children: [{ move: { color: 'white', vertex: { x: 4, y: 5 } }, correct: true, children: [] }] },
    }
    const result = checkObjective(ex)
    expect(result.wrongCorrect).toEqual([])
    expect(result.unmarkedAlternatives).toEqual([])
  })

  it('matar: detecta un `correct` que NO captura nada (posición mal armada)', () => {
    const ex: Exercise = {
      id: 'broken', collection: 'test', boardSize: 9,
      setup: { black: [{ x: 3, y: 4 }, { x: 4, y: 4 }], white: [{ x: 2, y: 4 }] },
      toPlay: 'white', objective: 'matar',
      // (0,0) no toca la cadena negra: no puede capturar nada.
      tree: { children: [{ move: { color: 'white', vertex: { x: 0, y: 0 } }, correct: true, children: [] }] },
    }
    expect(checkObjective(ex).wrongCorrect).toEqual([{ x: 0, y: 0 }])
  })

  it('vivir: salvar una cadena blanca de 2 piedras en atari -- (4,5) es la única salida', () => {
    const ex: Exercise = {
      id: 'b1-l1-04', collection: 'bloque-1-leccion-1', boardSize: 9,
      setup: {
        white: [{ x: 3, y: 4 }, { x: 4, y: 4 }],
        black: [{ x: 2, y: 4 }, { x: 5, y: 4 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 5 }],
      },
      toPlay: 'white', objective: 'vivir',
      tree: { children: [{ move: { color: 'white', vertex: { x: 4, y: 5 } }, correct: true, children: [] }] },
    }
    const result = checkObjective(ex)
    expect(result.wrongCorrect).toEqual([])
    expect(result.unmarkedAlternatives).toEqual([])
  })
})
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -w @tengen/web -- objectiveCheck.test`
Expected: 3 passed. Si el segundo caso ("vivir") no pasa, verificar a mano las libertades de la
cadena blanca (3,4)-(4,4) antes y después de jugar (4,5) -- es la posición que la spec y este plan
ya verificaron dos veces a mano; un fallo ahí es más probable un bug del checker que de la posición.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/learn/objectiveCheck.ts apps/web/tests/objectiveCheck.test.ts
git commit -m "feat(learn): objectiveCheck -- árbitro de reglas puras para el Bloque 1 (Pieza 3)"
```

---

## Task 5: Autoría de la Lección 1 -- "La jugada y la captura" (taller 1)

**Files:**
- Create: `apps/web/content/tsumego/bloque-1/leccion-1.md` (notas de procedencia, no se importa)
- Create: `apps/web/src/learn/data/bloque-1.json` (arranca con 1 elemento: esta lección)

**Interfaces:**
- Consumes: `checkObjective` (Task 4), `exerciseIssues`/`lessonIssues` (Task 2).
- Produces: el primer elemento real de `bloque-1.json`, consumido por la Task 6 (`curriculum.ts`).

Fuente pedagógica (NO se copian diagramas ni texto, solo la secuencia de temas): `unMetodoProgresivo...pdf`
Pasos 1-4 + `ayudaMemoriaTalleres01a05.pdf` Taller 1. Temas: la jugada, libertades, atari, captura
simple y defensa (extender), retirar la piedra capturada.

- [ ] **Step 1: Escribir la teoría (original, en español, 3-4 párrafos cortos)**

```
"El go se juega turno a turno: cada jugador coloca UNA piedra en una intersección vacía del
tablero, o pasa el turno. Las piedras nunca se mueven -- se quedan donde se colocan, salvo que las
capturen.",
"Una piedra (o una cadena de piedras del mismo color, conectadas) tiene libertades: las
intersecciones vacías pegadas a ella. Cuando le queda una sola libertad, decimos que está en
atari -- en peligro de captura inmediata.",
"Si el rival ocupa esa última libertad, la piedra (o toda la cadena) se captura: sale del tablero.
Pero si la piedra en atari es tuya, también podés jugar ahí vos primero -- eso se llama defenderse,
y agranda la cadena en vez de perderla.",
"Encontrar el atari, y decidir si conviene capturar o defenderse, es la primera destreza táctica
del go. Los seis problemas de esta lección practican exactamente eso."
```

- [ ] **Step 2: Componer y validar las 6 posiciones, una por una**

Dos ya vienen verificadas (Task 4): reusar `b1-l1-02` (captura de cadena) y una versión de la
lección de `b1-l1-04` (defensa/atari propio). Completar las 4 restantes siguiendo el MISMO patrón
(setup chico en 9×9, objetivo `matar` o `vivir`) para cubrir:

| # | Objetivo pedagógico | `objective` |
|---|---|---|
| 1 | Atari de una sola piedra, captura directa | `matar` |
| 2 | Atari de una cadena de 2, captura directa (`b1-l1-02` de la Task 4) | `matar` |
| 3 | Atari de una cadena de 3 en forma de L, captura | `matar` |
| 4 | Cadena propia (blanca) en atari, defenderse extendiendo (`b1-l1-04` de la Task 4) | `vivir` |
| 5 | Cadena propia en atari con más de una extensión válida -- usar `checkObjective` para confirmar `unmarkedAlternatives` y marcar AMBAS como `correct` | `vivir` |
| 6 | Tablero con una cadena de 2 libertades (no atari) junto a una piedra suelta de 1 libertad -- distractor: hay que identificar CUÁL está en atari antes de capturar | `matar` |

Para cada posición nueva: escribir el JSON, correr manualmente

```ts
import { checkObjective } from './src/learn/objectiveCheck'
import { exerciseIssues } from './src/learn/exercise'
console.log(exerciseIssues(ex), checkObjective(ex))
```

(vía un script descartable o un test temporal) y no continuar hasta que ambos den `[]`/sin
`wrongCorrect`. Si `unmarkedAlternatives` no es `[]` y no es el caso #5 a propósito, agregar esos
puntos como `correct: true` extra o achicar la posición (mismo criterio que la spec, Pieza 3).

- [ ] **Step 3: Ensamblar `bloque-1.json`**

```json
[
  {
    "id": "b1-l1",
    "block": 1,
    "workshop": 1,
    "title": "La jugada y la captura",
    "theory": ["...", "...", "...", "..."],
    "exercises": [ /* los 6 objetos Exercise validados en el Step 2 */ ],
    "checkpoint": false,
    "practiceOpponent": { "rank": "20k", "boardSize": 9 }
  }
]
```

- [ ] **Step 4: Escribir `leccion-1.md` (procedencia, no se importa al producto)**

```markdown
# Lección 1 -- procedencia

Estructura pedagógica inspirada en `unMetodoProgresivoDeEnsenanzaDeLasReglasDelGo.pdf` (Pasos 1-4)
y `ayudaMemoriaTalleres01a05.pdf` (Taller 1) de FEDIBERGO. Posiciones y texto 100% originales de
tengen -- ver veredicto en `docs/research/fase-aprender/contenido-licencias.md`.
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/learn/data/bloque-1.json apps/web/content/tsumego/bloque-1/leccion-1.md
git commit -m "content(learn): Lección 1 del Bloque 1 -- la jugada y la captura"
```

---

## Task 6: `curriculum.ts` -- el registro

**Files:**
- Create: `apps/web/src/learn/curriculum.ts`
- Modify: `apps/web/tests/learnData.test.ts`

**Interfaces:**
- Consumes: `Lesson`, `lessonIssues` (Task 2); `bloque-1.json` (Task 5).
- Produces: `CURRICULUM: readonly Lesson[]` -- consumido por `AprenderView` (Task 11).

- [ ] **Step 1: Escribir el registro**

```ts
// apps/web/src/learn/curriculum.ts
// Bloque 1 del currículo FEDIBERGO: registro análogo a collections.ts, mismo motivo (JSON al
// bundle para el precache de la PWA sin tocar globPatterns). REGLA: un bloque entra solo después
// de que su veredicto de licencia esté escrito (ver Task 1) -- ver también collections.ts:5-7.
import type { Lesson } from './lesson'
import bloque1 from './data/bloque-1.json'

export const CURRICULUM: readonly Lesson[] = bloque1 as unknown as readonly Lesson[]
```

- [ ] **Step 2: Extender `learnData.test.ts` (no un test aislado)**

Leer el archivo primero para calzar el patrón exacto que ya usa con `COLLECTIONS`/`exerciseIssues`,
y agregarle un bloque equivalente:

```ts
import { CURRICULUM } from '../src/learn/curriculum'
import { lessonIssues } from '../src/learn/lesson'

describe('CURRICULUM', () => {
  it('cada lección registrada pasa lessonIssues sin problemas', () => {
    for (const lesson of CURRICULUM) {
      expect(lessonIssues(lesson), `lección ${lesson.id}`).toEqual([])
    }
  })

  it('el orden de bloque/workshop es estrictamente creciente (desbloqueo secuencial depende de esto)', () => {
    const workshops = CURRICULUM.map((l) => l.workshop)
    expect(workshops).toEqual([...workshops].sort((a, b) => a - b))
  })
})
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -w @tengen/web -- learnData.test`
Expected: todo verde, incluida la Lección 1 recién autorada.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/learn/curriculum.ts apps/web/tests/learnData.test.ts
git commit -m "feat(learn): registro CURRICULUM, cubierto por learnData.test.ts"
```

---

## Task 7: Autoría de las Lecciones 2 y 3 (sin motor)

**Files:**
- Modify: `apps/web/src/learn/data/bloque-1.json` (agrega 2 lecciones más)
- Create: `apps/web/content/tsumego/bloque-1/leccion-{2,3}.md`

**Interfaces:** iguales a la Task 5, mismo patrón de validación.

Ambas lecciones siguen el MISMO ciclo de 5 pasos que la Task 5 (teoría → componer y validar 6
posiciones una por una con `checkObjective`/`exerciseIssues` → ensamblar en `bloque-1.json` →
`leccion-N.md` de procedencia → commit) — se repite la estructura acá para que se pueda ejecutar
sin volver a leer la Task 5.

- [ ] **Step 1: Lección 2 -- "Cadenas grandes y atari doble" (taller 2)**

  1. **Teoría** (original, 3-4 párrafos): qué es una cadena de más de 2 piedras, y snapback —
     jugar en un punto donde la piedra propia aparentemente no tiene libertades. Fuente pedagógica
     (no copiar texto): `unMetodoProgresivo...pdf` Pasos 3-4 + 8; `ayudaMemoriaTalleres01a05.pdf`
     Taller 2, secuencia "Defensa del atari" (pág. 1): ahí la defensa correcta es CAPTURAR la
     piedra atacante, no extender — ese es el snapback a replicar con una posición propia.
  2. **Componer y validar 6 posiciones**, una por una (mismo comando manual que la Task 5, Step 2:
     `exerciseIssues(ex)` + `checkObjective(ex)`, no continuar hasta `[]`/sin `wrongCorrect`):

     | # | Objetivo pedagógico | `objective` |
     |---|---|---|
     | 1 | Cadena de 3-4 piedras en atari, captura directa | `matar` |
     | 2 | Snapback: negra juega "donde no tiene libertades" y captura | `matar` |
     | 3 | Atari doble: blanca amenaza dos cadenas negras a la vez, negra debe elegir cuál salvar | `vivir` |
     | 4 | Cadena blanca propia en atari, se salva capturando la piedra negra atacante (snapback defensivo) | `vivir` |
     | 5 | Cadena blanca en atari con extensión simple (contraste con el #4: acá SÍ conviene extender) | `vivir` |
     | 6 | Distractor: dos cadenas negras, solo una realmente en atari (la otra tiene 2 libertades) | `matar` |
  3. **Ensamblar** el segundo elemento de `bloque-1.json` (mismo shape que la Task 5, Step 3, con
     `"id": "b1-l2"`, `"workshop": 2`).
  4. **Escribir** `apps/web/content/tsumego/bloque-1/leccion-2.md` (mismo shape que
     `leccion-1.md`, citando `unMetodoProgresivo...pdf` Pasos 3-4/8 + Taller 2).
  5. **Commit:**

  ```bash
  git add apps/web/src/learn/data/bloque-1.json apps/web/content/tsumego/bloque-1/leccion-2.md
  git commit -m "content(learn): Lección 2 del Bloque 1 -- cadenas grandes y atari doble"
  ```

- [ ] **Step 2: Lección 3 -- "La regla del ko" (taller 3)**

  1. **Teoría** (original, 3-4 párrafos): la regla del ko (prohibición de recapturar de inmediato,
     para evitar el ciclo infinito), en el centro, el borde y el rincón. Fuente pedagógica:
     `unMetodoProgresivo...pdf` Pasos 5-6; `ayudaMemoriaTalleres01a05.pdf` Taller 3 (que muestra el
     ko en los tres lugares del tablero).
  2. **Componer y validar 6 posiciones:**

     | # | Objetivo pedagógico | `objective` |
     |---|---|---|
     | 1 | Ko en el centro del tablero: la captura crea una situación de ko real | `ko` |
     | 2 | Ko en el borde | `ko` |
     | 3 | Ko en el rincón | `ko` |
     | 4 | Captura simple SIN ko, para contraste (el enunciado real pide "decir si es ko o no") | `matar` |
     | 5 | Captura simple sin ko, otra forma (cadena de 2, no de 1) | `matar` |
     | 6 | Distractor: una jugada que parece ko pero no lo es (la recaptura es legal) | `matar` |

     Para los `objective: 'ko'`, `checkObjective` valida específicamente (Task 4, Step 1) que la
     recaptura inmediata sea ilegal por regla de ko, no por otra razón — confiar en ese chequeo, no
     solo en la lectura visual de la posición.
  3. **Ensamblar** el tercer elemento de `bloque-1.json` (`"id": "b1-l3"`, `"workshop": 3`).
  4. **Escribir** `apps/web/content/tsumego/bloque-1/leccion-3.md`.
  5. **Commit:**

  ```bash
  git add apps/web/src/learn/data/bloque-1.json apps/web/content/tsumego/bloque-1/leccion-3.md
  git commit -m "content(learn): Lección 3 del Bloque 1 -- la regla del ko"
  ```

- [ ] **Step 3: Extender `bloque-1.json` con ambas lecciones y re-correr `learnData.test.ts`**

Run: `npm test -w @tengen/web -- learnData.test`
Expected: 3 de 5 lecciones registradas al terminar esta task, todas en `[]`.

---

## Task 8: Spike de spot-check para la Lección 4 (decide el protocolo de 4-5)

**Files:** ninguno permanente -- es una medición, no código de producto.

- [ ] **Step 1: Componer 2-3 posiciones de muestra de "ojos" (borrador, no las finales)**

Un ojo simple en atari, un ojo grande con punto vital, una cadena con dos ojos ya formados (donde
NINGUNA jugada debería lograr nada -- caso de control).

- [ ] **Step 2: Correr cada una contra KataGo desktop con el script existente**

Run: `apps/web/scripts/spotcheck-tsumego.mjs` (requiere `TENGEN_NN_MODEL` o el flujo que ya usa
"Primeros pasos" -- ver `docs/research/fase-aprender/contenido-licencias.md`, sección "Protocolo de
spot-check").

- [ ] **Step 3: Evaluar el resultado contra el criterio de la spec**

¿El score separa la jugada correcta de las incorrectas con margen claro (mismo umbral ≥3 pts que
"Primeros pasos"), o el ruido de una posición tan dispersa (pocas piedras en un 9×9 casi vacío)
hace el score no confiable? Anotar el resultado en
`docs/research/fase-aprender/contenido-licencias.md` (nueva entrada corta bajo el veredicto de la
Task 1) -- decide el protocolo real de la Task 9.

- [ ] **Step 4: Commit (solo la entrada de research, las posiciones de prueba se descartan)**

```bash
git add docs/research/fase-aprender/contenido-licencias.md
git commit -m "docs: resultado del spike de spot-check para Lecciones 4-5 del Bloque 1"
```

---

## Task 9: Autoría de las Lecciones 4 y 5

**Files:**
- Modify: `apps/web/src/learn/data/bloque-1.json`
- Create: `apps/web/content/tsumego/bloque-1/leccion-{4,5}.md`

Mismo ciclo de 5 pasos que las Tasks 5 y 7 (teoría → componer y validar 6 posiciones → ensamblar →
`.md` de procedencia → commit), con UNA diferencia: el paso de validación depende del resultado de
la Task 8 (spike de spot-check) — se detalla en cada Step.

- [ ] **Step 1: Lección 4 -- "Ojos: uno no alcanza" (taller 4)**

  1. **Teoría** (original, 3-4 párrafos): qué es un ojo, por qué un grupo con dos ojos separados no
     se puede capturar, ojo grande y su punto vital. Fuente pedagógica:
     `unMetodoProgresivo...pdf` Pasos 7, 9-10; `ayudaMemoriaTalleres01a05.pdf` Taller 4.
  2. **Componer y validar 6 posiciones:**

     | # | Objetivo pedagógico | `objective` |
     |---|---|---|
     | 1 | Grupo con un ojo, en atari -- captura | `matar` |
     | 2 | Ojo falso (diagonal sin reforzar, no un ojo real): el rival juega ahí y termina capturando el grupo | `matar` |
     | 3 | Ojo grande con punto vital -- jugar ahí evita los dos ojos | `matar` |
     | 4 | Ojo grande donde el rival YA jugó adentro -- capturar esa piedra intrusa | `matar` |
     | 5 | Grupo propio con un ojo, se salva formando el segundo | `vivir` |
     | 6 | Distractor: grupo con un ojo y suficientes libertades externas (no está realmente amenazado esta jugada) | `matar` (objetivo: identificar que TODAVÍA no hay captura posible) |

     **Validación** (según el resultado de la Task 8): si el spot-check separó con margen claro,
     correr `apps/web/scripts/spotcheck-tsumego.mjs` sobre estas 6 con el mismo umbral que "Primeros
     pasos" (co-optimalidad local + gap ≥3 pts); si no, usar `checkObjective` — los grupos de dos
     ojos reales son verificables sin motor: para el caso #2 ningún punto jugable del rival reduce
     el grupo a 0 libertades en una sola jugada, chequeo directo con `validateMove`/`getLiberties`
     sobre cada intento — más revisión manual de Edgar antes de commitear.
  3. **Ensamblar** el cuarto elemento de `bloque-1.json` (`"id": "b1-l4"`, `"workshop": 4`).
  4. **Escribir** `apps/web/content/tsumego/bloque-1/leccion-4.md`.
  5. **Commit:**

  ```bash
  git add apps/web/src/learn/data/bloque-1.json apps/web/content/tsumego/bloque-1/leccion-4.md
  git commit -m "content(learn): Lección 4 del Bloque 1 -- ojos, uno no alcanza"
  ```

- [ ] **Step 2: Lección 5 -- "Escalera, atari doble y conexión" (taller 5)**

  1. **Teoría** (original, 3-4 párrafos): la escalera (captura a distancia siguiendo una diagonal),
     el atari contra el borde, la conexión (directa y diagonal) como defensa. Fuente pedagógica:
     `unMetodoProgresivo...pdf` Paso 8/11; `ayudaMemoriaTalleres01a05.pdf` Taller 5.
  2. **Componer y validar 6 posiciones:**

     | # | Objetivo pedagógico | `objective` |
     |---|---|---|
     | 1 | Escalera: primera jugada que inicia una captura en diagonal | `matar` |
     | 2 | Escalera ya en curso: siguiente jugada correcta de la secuencia | `matar` |
     | 3 | Atari contra el borde: el borde del tablero hace de "libertad faltante" | `matar` |
     | 4 | Conexión directa: salvar dos grupos propios amenazados uniéndolos | `vivir` |
     | 5 | Conexión diagonal (con hueco) como defensa válida | `vivir` |
     | 6 | Distractor: una escalera que en realidad está bloqueada por una piedra propia ya puesta (no funciona) -- la jugada correcta es OTRA técnica, no la escalera | `matar` |

     Mismo protocolo de validación que la Lección 4 (Step 1), según el resultado de la Task 8.
  3. **Ensamblar** el quinto y último elemento de `bloque-1.json` (`"id": "b1-l5"`, `"workshop": 5`).
  4. **Escribir** `apps/web/content/tsumego/bloque-1/leccion-5.md`.
  5. **Commit:**

  ```bash
  git add apps/web/src/learn/data/bloque-1.json apps/web/content/tsumego/bloque-1/leccion-5.md
  git commit -m "content(learn): Lección 5 del Bloque 1 -- escalera, atari doble y conexión"
  ```

- [ ] **Step 3: Correr toda la suite tras completar las 5 lecciones**

Run: `npm test -w @tengen/web -- learnData.test`
Expected: las 5 lecciones del Bloque 1 registradas en `CURRICULUM`, todas en `[]`.

---

## Task 10: `progress.ts` -- `isLessonUnlocked`

**Files:**
- Modify: `apps/web/src/learn/progress.ts`
- Test: `apps/web/tests/progress.test.ts` (extender el existente)

**Interfaces:**
- Consumes: `Lesson` (Task 2), `ProgressMap`/`ExerciseProgress` (ya en `progress.ts`).
- Produces: `isLessonUnlocked(lessons, progress, lessonId): boolean` -- consumido por `AprenderView`
  (Task 12).

- [ ] **Step 1: Escribir la función (derivada, sin nuevo storage)**

```ts
// Agregar a apps/web/src/learn/progress.ts
import type { Lesson } from './lesson'

/** Lección en la posición 0 del currículo: siempre desbloqueada. Lección en la posición i>0:
 * desbloqueada si los 6 ejercicios de lessons[i-1] están 'resuelto'. Derivado de ProgressMap --
 * cero storage nuevo. */
export function isLessonUnlocked(lessons: readonly Lesson[], progress: ProgressMap, lessonId: string): boolean {
  const index = lessons.findIndex((l) => l.id === lessonId)
  if (index <= 0) return true
  const previous = lessons[index - 1]
  if (!previous) return true
  return previous.exercises.every((ex) => progress[ex.id]?.estado === 'resuelto')
}
```

- [ ] **Step 2: Tests**

```ts
// agregar a apps/web/tests/progress.test.ts
import { isLessonUnlocked } from '../src/learn/progress'
import type { Lesson } from '../src/learn/lesson'

const lessons: Lesson[] = [
  { ...validLesson, id: 'b1-l1', exercises: [{ id: 'e1' }, { id: 'e2' }] as any },
  { ...validLesson, id: 'b1-l2' },
]

describe('isLessonUnlocked', () => {
  it('la primera lección siempre está desbloqueada', () => {
    expect(isLessonUnlocked(lessons, {}, 'b1-l1')).toBe(true)
  })
  it('la segunda lección NO se desbloquea si falta resolver un ejercicio de la primera', () => {
    const progress = { e1: { estado: 'resuelto', intentos: 1 } } as any
    expect(isLessonUnlocked(lessons, progress, 'b1-l2')).toBe(false)
  })
  it('un ejercicio "intentado" (no resuelto) NO desbloquea', () => {
    const progress = { e1: { estado: 'intentado', intentos: 3 }, e2: { estado: 'resuelto', intentos: 1 } } as any
    expect(isLessonUnlocked(lessons, progress, 'b1-l2')).toBe(false)
  })
  it('se desbloquea cuando los 6 (acá 2, de prueba) están resueltos', () => {
    const progress = {
      e1: { estado: 'resuelto', intentos: 1 },
      e2: { estado: 'resuelto', intentos: 1 },
    } as any
    expect(isLessonUnlocked(lessons, progress, 'b1-l2')).toBe(true)
  })
})
```

(Nota para quien ejecute: adaptar el `Lesson` de prueba al helper `validLesson` real que ya exista
en el archivo, o construirlo inline igual que en `lesson.test.ts` -- lo importante es que
`exercises` tenga IDs cortos y controlados para las aserciones.)

- [ ] **Step 3: Correr**

Run: `npm test -w @tengen/web -- progress.test`
Expected: todo verde.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/learn/progress.ts apps/web/tests/progress.test.ts
git commit -m "feat(learn): isLessonUnlocked -- desbloqueo secuencial derivado, sin storage nuevo"
```

---

## Task 11: `ExercisePlayer` -- modo `engineless`

**Files:**
- Modify: `apps/web/src/ui/ExercisePlayer.tsx`
- Test: `apps/web/tests/ExercisePlayer.test.tsx` (extender el existente -- confirmar el nombre real
  antes de escribir, puede estar en otro archivo de tests de componente)

**Interfaces:**
- Modifies: `ExercisePlayerProps` -- `scheduler` pasa a opcional, nuevo `engineless?: boolean`.
- Produces: comportamiento nuevo en `applyResult`'s case `'fuera-de-arbol'` -- consumido por
  `AprenderView` (Task 12) al abrir una lección con `needsEngine: false`.

- [ ] **Step 1: Ampliar `ExercisePlayerProps` y gatear el precalentamiento**

```tsx
// apps/web/src/ui/ExercisePlayer.tsx -- cambios puntuales, no un rewrite:

export interface ExercisePlayerProps {
  exercise: Exercise
  storage: StorageLike
  /** Ausente/undefined cuando `engineless` es true -- nunca se llama. */
  scheduler?: RefutationScheduler
  booting?: boolean
  /** Lecciones 1-3 del Bloque 1 (spec, Pieza 3): fuera-de-árbol NO consulta al motor -- feedback
   * inmediato y genérico. Cuando es true, `scheduler` puede faltar. */
  engineless?: boolean
  boardBounds?: BoundedBoardSize
  onBackToList(): void
  onNext?(): void
}
```

En el `useEffect` del precalentamiento (línea ~100), cambiar la guarda inicial:

```tsx
useEffect(() => {
  if (booting || engineless || !scheduler) return
  // ... resto igual
}, [booting, engineless, session, scheduler])
```

- [ ] **Step 2: Bifurcar el case `'fuera-de-arbol'` de `applyResult`**

```tsx
case 'fuera-de-arbol': {
  if (engineless) {
    setFeedback({ tone: 'danger', text: 'Esa no es la jugada. Fijate cuál piedra está en atari.' })
    session.fail()
    recordResult(storage, exercise.id, 'fallado')
    return
  }
  // ... el bloque existente de refutación con el motor, sin cambios, ahora dentro del else
}
```

- [ ] **Step 3: Test -- fuera-de-árbol en modo `engineless` no llama al scheduler**

```tsx
// agregar al archivo de tests existente de ExercisePlayer (buscar el describe actual y sumar acá)
it('modo engineless: fuera-de-árbol falla al toque, sin tocar el scheduler', () => {
  const scheduler = { analyzePosition: vi.fn() }
  const exercise = /* el mismo fixture que ya usa el archivo, con un punto fuera del árbol conocido */
  render(
    <ExercisePlayer
      exercise={exercise}
      storage={memoryStorage()}
      engineless
      boardBounds={{ maxWidth: 400, maxHeight: 400 }}
      onBackToList={() => {}}
    />,
  )
  // click en un vértice legal que NO está en el árbol de solución
  fireEvent.click(/* el vértice correspondiente del BoundedGoban -- seguir el patrón del test existente */)
  expect(scheduler.analyzePosition).not.toHaveBeenCalled()
  expect(screen.getByText(/Esa no es la jugada/)).toBeInTheDocument()
})
```

(Nota: adaptar a los helpers de render/click que el archivo real ya usa -- no reinventar el patrón
de disparo de clics sobre `BoundedGoban`, seguir el que el test existente de "fuera-de-árbol con
motor" ya tiene.)

- [ ] **Step 4: Confirmar que el comportamiento CON motor no cambió (regresión)**

Run: `npm test -w @tengen/web -- ExercisePlayer`
Expected: todos los tests existentes (con `scheduler` real/mock) siguen en verde -- `engineless`
por defecto es `false`/`undefined`, cero cambio de comportamiento para "Primeros pasos".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/ExercisePlayer.tsx apps/web/tests/ExercisePlayer.test.tsx
git commit -m "feat(learn): modo engineless en ExercisePlayer -- fuera-de-árbol sin motor"
```

---

## Task 12: `NewGameForm` -- prop `initial`

**Files:**
- Modify: `apps/web/src/ui/NewGameForm.tsx`
- Test: `apps/web/tests/NewGameForm.test.tsx` (o el nombre real -- confirmar antes de escribir)

**Interfaces:**
- Modifies: `NewGameFormProps` -- nuevo `initial?: { boardSize?: BoardSize; opponentKind?: 'human' | 'kata'; humanRank?: HumanRank }`.
- Produces: consumido por `AprenderView` (Task 12) para prellenar "Practicar contra Human SL".

- [ ] **Step 1: Agregar el prop y usarlo solo en los `useState` iniciales**

```tsx
interface NewGameFormProps {
  onStart(config: GameConfig): void
  onBack(): void
  initial?: { boardSize?: BoardSize; opponentKind?: 'human' | 'kata'; humanRank?: HumanRank }
}

export function NewGameForm({ onStart, onBack, initial }: NewGameFormProps) {
  const [boardSize, setBoardSize] = useState<BoardSize>(initial?.boardSize ?? 9)
  const [opponentKind, setOpponentKind] = useState<'human' | 'kata'>(initial?.opponentKind ?? 'kata')
  const [humanRank, setHumanRank] = useState<HumanRank>(initial?.humanRank ?? '5k')
  // resto del componente sin cambios -- mainTimeMin ya deriva de boardSize con defaultMainTimeMin,
  // así que arrancar en 9 (con o sin `initial`) sigue dando el mismo tiempo por defecto.
  ...
```

- [ ] **Step 2: Test -- `initial` prellena, ausencia preserva el comportamiento de hoy**

```tsx
it('sin initial arranca en kata/9x9/5k (comportamiento de hoy, regresión)', () => {
  render(<NewGameForm onStart={() => {}} onBack={() => {}} />)
  expect(screen.getByRole('button', { name: /9×9|9x9/i })).toHaveAttribute('aria-pressed', 'true')
  // seguir el patrón real de aserciones del archivo para opponentKind/humanRank si ya existe
})

it('con initial={opponentKind:human, humanRank:20k, boardSize:9} arranca prellenado', () => {
  render(
    <NewGameForm
      onStart={() => {}}
      onBack={() => {}}
      initial={{ opponentKind: 'human', humanRank: '20k', boardSize: 9 }}
    />,
  )
  // aserción sobre el selector de rango mostrando 20k -- seguir el patrón real del archivo
})
```

- [ ] **Step 3: Correr**

Run: `npm test -w @tengen/web -- NewGameForm`
Expected: verde, incluidos los tests preexistentes (regresión del comportamiento por defecto).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/ui/NewGameForm.tsx apps/web/tests/NewGameForm.test.tsx
git commit -m "feat(ui): NewGameForm admite initial -- prefill opcional y aditivo"
```

---

## Task 13: `AprenderView` -- el nivel de currículo

**Files:**
- Modify: `apps/web/src/ui/AprenderView.tsx`
- Modify: `apps/web/src/main.tsx` (pasar `initial` al montar `NewGameForm` cuando se navega desde
  Aprender -- ver Step 4)
- Test: `apps/web/tests/AprenderView.test.tsx` (extender el existente)

**Interfaces:**
- Consumes: `CURRICULUM` (Task 6), `isLessonUnlocked` (Task 10), `ExercisePlayer` con `engineless`
  (Task 11), `NewGameForm` con `initial` (Task 12).

- [ ] **Step 1: Agregar el estado de currículo, en paralelo al de colecciones existente**

```tsx
// AprenderView.tsx -- agregar junto al `Selection` existente:
interface LessonSelection {
  lessonId: string
  /** 'teoria' -> exercises[0..5] -> 'practicar'. */
  step: 'teoria' | number | 'practicar'
}

const [lessonSelection, setLessonSelection] = useState<LessonSelection | null>(null)
```

- [ ] **Step 2: Renderizar la lista de currículo con candado, antes de "Colecciones"**

```tsx
// dentro del render principal, antes del `collections.map(...)` existente:
<section class="aprender-collection">
  <h2>Currículo -- Bloque 1</h2>
  <ul class="exercise-list">
    {CURRICULUM.map((lesson) => {
      const unlocked = isLessonUnlocked(CURRICULUM, progress, lesson.id)
      return (
        <li key={lesson.id}>
          <button
            type="button"
            class="exercise-row"
            disabled={!unlocked}
            onClick={() => unlocked && setLessonSelection({ lessonId: lesson.id, step: 'teoria' })}
          >
            <span class={unlocked ? 'exercise-state' : 'exercise-state exercise-state--bloqueado'}>
              {unlocked ? '·' : '🔒'}
            </span>
            <span class="exercise-row-label">{lesson.title}</span>
          </button>
        </li>
      )
    })}
  </ul>
</section>
```

- [ ] **Step 3: Renderizar teoría → ejercicios → práctica cuando hay `lessonSelection`**

La spec (Pieza 3) distingue Lecciones 1-3 (sin motor) de 4-5 (con motor, según el resultado de la
Task 8). Como `Lesson` no tiene ese campo -- fue deliberado en la spec, para no acoplar la UI a un
detalle que puede resultar distinto tras el spike --, se deriva acá con una constante a nivel de
módulo, junto al resto de constantes del archivo (como `LEARN_NETWORK`):

```tsx
// Talleres 1-3: sin motor (spec, Pieza 3). Ajustar si el resultado de la Task 8/9 cambia esto.
const LESSONS_WITHOUT_ENGINE = new Set([1, 2, 3])
```

```tsx
if (lessonSelection) {
  const lesson = CURRICULUM.find((l) => l.id === lessonSelection.lessonId)
  if (lesson) {
    if (lessonSelection.step === 'teoria') {
      return (
        <main class="card-screen">
          <h1>{lesson.title}</h1>
          {lesson.theory.map((p, i) => <p key={i}>{p}</p>)}
          <button type="button" onClick={() => setLessonSelection({ ...lessonSelection, step: 0 })}>
            Empezar los 6 problemas
          </button>
          <button type="button" class="ghost" onClick={() => setLessonSelection(null)}>Volver</button>
        </main>
      )
    }
    if (lessonSelection.step === 'practicar') {
      return (
        <main class="card-screen">
          <h1>Practicá lo que aprendiste</h1>
          <p>Una partida contra Human SL, calibrado a {lesson.practiceOpponent.rank}.</p>
          <button
            type="button"
            class="primary"
            onClick={() => route(`/jugar?practica=${lesson.id}`)}
          >
            Jugar contra Human SL {lesson.practiceOpponent.rank}
          </button>
          <button type="button" class="ghost" onClick={() => setLessonSelection(null)}>Volver al currículo</button>
        </main>
      )
    }
    const index = lessonSelection.step
    const exercise = lesson.exercises[index]
    if (exercise) {
      const hasNext = index + 1 < lesson.exercises.length
      const playerProps = {
        key: exercise.id,
        exercise,
        storage,
        onBackToList: () => setLessonSelection(null),
        ...(hasNext
          ? { onNext: () => setLessonSelection({ ...lessonSelection, step: index + 1 }) }
          : { onNext: () => setLessonSelection({ ...lessonSelection, step: 'practicar' as const }) }),
      }
      return LESSONS_WITHOUT_ENGINE.has(lesson.workshop) ? (
        <ExercisePlayer {...playerProps} engineless />
      ) : (
        <ModelGate net={LEARN_NETWORK}>
          <EngineExercisePlayer {...playerProps} />
        </ModelGate>
      )
    }
  }
  setLessonSelection(null)
}
```

- [ ] **Step 4: Pasar `initial` a `NewGameForm` cuando se navega desde una práctica**

En `main.tsx`, donde hoy monta `<NewGameForm onStart={handleStart} onBack={onBack} />` (línea 189):
leer un query param `practica` (o el mecanismo de ruteo que `preact-router` ya use en el resto del
archivo -- seguir el patrón existente, no introducir uno nuevo) y, si está presente y corresponde a
una lección conocida, pasar `initial={{ boardSize: 9, opponentKind: 'human', humanRank: lesson.practiceOpponent.rank }}`.
Sin el param, `initial` queda `undefined` -- cero cambio para "Jugar" normal.

- [ ] **Step 5: Tests -- candado, apertura de lección, botón de práctica**

```tsx
// agregar al archivo de tests existente de AprenderView
it('la Lección 2 aparece bloqueada si la Lección 1 no está resuelta', () => {
  render(<AprenderView storage={memoryStorage()} />)
  expect(screen.getByRole('button', { name: /Cadenas grandes/i })).toBeDisabled()
})

it('la Lección 2 se desbloquea cuando los 6 ejercicios de la Lección 1 están resueltos', () => {
  const storage = memoryStorage()
  // sembrar progreso resuelto para los 6 ids de CURRICULUM[0].exercises antes de renderizar
  for (const ex of CURRICULUM[0]!.exercises) recordResult(storage, ex.id, 'resuelto')
  render(<AprenderView storage={storage} />)
  expect(screen.getByRole('button', { name: /Cadenas grandes/i })).not.toBeDisabled()
})

it('abrir la Lección 1 no monta ModelGate (sin motor)', () => {
  render(<AprenderView storage={memoryStorage()} />)
  fireEvent.click(screen.getByRole('button', { name: /La jugada y la captura/i }))
  fireEvent.click(screen.getByRole('button', { name: /Empezar los 6 problemas/i }))
  // aserción de que NO aparece el texto/estado de "Preparando motor" que ModelGate/EngineExercisePlayer sí muestra
  expect(screen.queryByText(/Preparando motor/i)).not.toBeInTheDocument()
})
```

(Nota: seguir el patrón real de `memoryStorage()`/imports que el archivo ya tiene -- no
reinventarlo.)

- [ ] **Step 6: Correr toda la suite de `@tengen/web` y el typecheck**

Run: `npm run typecheck -w @tengen/web && npm test -w @tengen/web`
Expected: todo verde.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/ui/AprenderView.tsx apps/web/src/main.tsx apps/web/tests/AprenderView.test.tsx
git commit -m "feat(learn): nivel de currículo en AprenderView -- lecciones, candado y práctica"
```

---

## Task 14: Gate manual (Edgar, en Chrome)

No es una tarea de código. Con todo lo anterior mergeado:

- [ ] Abrir `/aprender` en Chrome, confirmar que la Lección 1 abre INSTANTÁNEO (sin pedir descarga
  de modelo) y las Lecciones 2-5 están bloqueadas.
- [ ] Resolver los 6 problemas de la Lección 1 -- confirmar que un intento fuera del árbol da
  feedback inmediato, sin "Consultando al motor…".
- [ ] Confirmar que la Lección 2 se desbloquea sola al terminar la 1.
- [ ] Completar las 5 lecciones, llegar al botón de práctica de la Lección 1 (o la última que use
  20k) y confirmar que `/jugar` abre con Human SL 20k, 9×9 ya seleccionados.
- [ ] Jugar la partida de práctica hasta el final.
- [ ] Si alguna Lección 4-5 quedó con motor (según el resultado de la Task 8), confirmar que SÍ pide
  el modelo y que el veredicto en puntos aparece igual que en "Primeros pasos".
- [ ] Reportar a Edgar: listo para evaluar si se escala al Bloque 2, o qué ajustar primero.
