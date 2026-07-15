# Modo Analizar — Empezar Desde Cero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que Modo Analizar arranque en un tablero vacío (9×9/13×13/19×19) sin necesitar un SGF, reusando el editor de variaciones ya existente — cubre tanto "analizar desde cero" como "dar clases" con el mismo mecanismo.

**Architecture:** Cambio 100% frontend, un único archivo de dominio (`apps/web/src/ui/AnalyzeView.tsx`): `SgfPicker` gana un segundo camino de entrada (tres botones de tamaño de tablero) que construye un `GameTree` vacío con los mismos defaults que "Nueva partida" de Modo Jugar; un estado nuevo `startEditing` viaja de `AnalyzeView` a `ReadyAnalyzeView` para que el editor de variaciones (spec `2026-07-12-analyze-editor-variaciones.md`) arranque ya activado en ese camino.

**Tech Stack:** Preact, TypeScript strict (`noUncheckedIndexedAccess`), Vite. Sin dependencias nuevas, sin cambios en `apps/worker`.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-15-analizar-desde-cero-design.md` (aprobado).
- Sin selector de komi/reglas/hándicap — defaults fijos: `rules: 'chinese'`, `komi: 7`, `handicap: 0` (mismos valores que usa por defecto `NewGameForm.tsx` para Modo Jugar). Colocar piedras de hándicap a mano ya lo cubre el editor de variaciones existente.
- Sin plantillas de posiciones guardadas ni concepto de "sesión de clase" separado — es la misma `ReadyAnalyzeView` de siempre; se guarda en la nube igual que cualquier sesión de Analizar (`mode: 'analizar'`), sin campo nuevo en el modelo de datos ni cambios en `apps/worker`.
- Este proyecto **no tiene tests de componente Preact** (todos los tests de `apps/web` son de lógica pura sobre módulos sin JSX) — mismo criterio ya usado en la extensión previa del editor de variaciones: verificación manual en navegador, no suite automatizada nueva.
- Board sizes soportados: `BoardSize` de `@tengen/engine` es `9 | 13 | 19` (ya importado en el archivo).

---

### Task 1: SgfPicker con camino "empezar desde cero" + wiring hasta el editor de variaciones

**Files:**
- Modify: `apps/web/src/ui/AnalyzeView.tsx` (interfaces `SgfPickerProps`/`ReadyAnalyzeViewProps`, componentes `AnalyzeView`/`SgfPicker`/`ReadyAnalyzeView`)
- Modify: `apps/web/src/styles/app.css` (clases nuevas junto a `.analyze-picker`, línea ~489)

**Interfaces:**
- Consumes: `GameTree` (constructor `new GameTree(meta: GameTreeMeta)`, `apps/web/src/game/gameTree.ts:57`), `BoardSize` de `@tengen/engine` (ya importado en `AnalyzeView.tsx:20`).
- Produces: nada para otras tasks — es la única task de este plan.

Tarea única (no se puede partir en pasos independientemente reviewables: el cambio de props de `SgfPicker` y su wiring en `AnalyzeView`/`ReadyAnalyzeView` forman un solo cambio atómico — sin las tres partes juntas, el archivo ni siquiera tipa).

- [ ] **Step 1: Agregar las clases CSS del nuevo bloque de botones**

Abrir `apps/web/src/styles/app.css`, ubicar el bloque `.analyze-picker h1` (línea ~487-489):

```css
.analyze-picker h1 {
  margin: 0;
}
```

Agregar inmediatamente después:

```css

.analyze-picker-or {
  margin: 0;
  color: #777;
  font-size: 0.9rem;
}

.analyze-picker-scratch {
  display: flex;
  gap: 0.5rem;
}
```

- [ ] **Step 2: Cambiar la interfaz `SgfPickerProps` (split de `onLoad`)**

En `apps/web/src/ui/AnalyzeView.tsx`, reemplazar:

```ts
interface SgfPickerProps {
  onLoad(tree: GameTree): void
  onBack(): void
}
```

por:

```ts
interface SgfPickerProps {
  onLoadFile(tree: GameTree): void
  onStartFromScratch(boardSize: BoardSize): void
  onBack(): void
}
```

- [ ] **Step 3: Agregar el helper `emptyAnalyzeTree` y la lista de tamaños, justo antes de `SgfPicker`**

Inmediatamente antes de la definición de `function SgfPicker(...)`, agregar:

```ts
/** Tamaños ofrecidos para "empezar desde cero" — los tres `BoardSize` que soporta toda la app. */
const SCRATCH_BOARD_SIZES: BoardSize[] = [9, 13, 19]

/** Defaults fijos para un tablero vacío (spec 2026-07-15-analizar-desde-cero-design.md): mismos
 * valores que usa por defecto "Nueva partida" en Modo Jugar (`NewGameForm.tsx`: rules='chinese',
 * komi=defaultKomi('chinese')=7, sin hándicap). Sin selector — colocar piedras de hándicap a mano
 * ya lo cubre el editor de variaciones existente; decisión del brainstorm, no re-litigar. */
function emptyAnalyzeTree(boardSize: BoardSize): GameTree {
  return new GameTree({ boardSize, komi: 7, rules: 'chinese', handicap: 0 })
}
```

- [ ] **Step 4: Actualizar el cuerpo de `SgfPicker`: renombrar `onLoad`→`onLoadFile` y agregar los botones de tablero vacío**

Reemplazar la función completa (desde el comentario de doc hasta el cierre de `SgfPicker`):

```tsx
/** Pantalla mostrada cuando aún no hay árbol cargado. A diferencia de `NewGameForm`, Analizar NO
 * junta config (boardSize/komi/rules/handicap): todo eso ya viene DENTRO del SGF importado
 * (`tree.meta`), no hay nada que el usuario deba elegir antes de cargar el archivo. */
function SgfPicker({ onLoad, onBack }: SgfPickerProps) {
  const [error, setError] = useState<string | null>(null)

  async function handleFile(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    input.value = '' // permite reimportar el mismo archivo dos veces seguidas (mismo motivo que PlayView)
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const loaded = importSgf(text)
      // Deja el cursor en el tip de la línea principal (mismo UX que import de PlayView: se ve la
      // partida completa de inmediato). Validar DESPUÉS de avanzar, para cubrir exactamente la
      // línea que se va a mostrar/analizar.
      while (loaded.toChild(0)) {
        /* avanza hasta el tip */
      }
      if (!isMoveSequenceLegal(loaded.meta.boardSize, loaded.meta.handicap, loaded.movesTo())) {
        throw new Error('el SGF contiene jugadas ilegales en la línea principal')
      }
      onLoad(loaded)
    } catch (e) {
      setError(`No se pudo cargar el SGF (${errorMessage(e)}).`)
    }
  }

  return (
    <div class="analyze-picker">
      <h1>Modo Analizar</h1>
      <p>Elige un archivo SGF para analizar.</p>
      <input type="file" accept=".sgf" onChange={(e) => void handleFile(e)} />
      {error !== null && <p class="form-error">{error}</p>}
      <button onClick={onBack}>Volver</button>
    </div>
  )
}
```

con:

```tsx
/** Pantalla mostrada cuando aún no hay árbol cargado. Dos caminos: subir un SGF (la config ya
 * viene DENTRO del archivo, en `tree.meta` — nada que elegir) o empezar en un tablero vacío
 * (spec 2026-07-15: solo el tamaño es elegible, el resto son los defaults de Modo Jugar). */
function SgfPicker({ onLoadFile, onStartFromScratch, onBack }: SgfPickerProps) {
  const [error, setError] = useState<string | null>(null)

  async function handleFile(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    input.value = '' // permite reimportar el mismo archivo dos veces seguidas (mismo motivo que PlayView)
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const loaded = importSgf(text)
      // Deja el cursor en el tip de la línea principal (mismo UX que import de PlayView: se ve la
      // partida completa de inmediato). Validar DESPUÉS de avanzar, para cubrir exactamente la
      // línea que se va a mostrar/analizar.
      while (loaded.toChild(0)) {
        /* avanza hasta el tip */
      }
      if (!isMoveSequenceLegal(loaded.meta.boardSize, loaded.meta.handicap, loaded.movesTo())) {
        throw new Error('el SGF contiene jugadas ilegales en la línea principal')
      }
      onLoadFile(loaded)
    } catch (e) {
      setError(`No se pudo cargar el SGF (${errorMessage(e)}).`)
    }
  }

  return (
    <div class="analyze-picker">
      <h1>Modo Analizar</h1>
      <p>Elige un archivo SGF para analizar.</p>
      <input type="file" accept=".sgf" onChange={(e) => void handleFile(e)} />
      {error !== null && <p class="form-error">{error}</p>}

      <p class="analyze-picker-or">o empezá en blanco:</p>
      <div class="analyze-picker-scratch">
        {SCRATCH_BOARD_SIZES.map((size) => (
          <button key={size} onClick={() => onStartFromScratch(size)}>
            {size}×{size}
          </button>
        ))}
      </div>

      <button onClick={onBack}>Volver</button>
    </div>
  )
}
```

- [ ] **Step 5: Agregar `startEditing` a `ReadyAnalyzeViewProps`**

Reemplazar:

```ts
interface ReadyAnalyzeViewProps {
  tree: GameTree
  /** Id de D1 (Fase 5): ver nota en `AnalyzeView`. */
  cloudId?: string
  onBack(): void
  onLoadAnother(): void
  speed: AnalyzeSpeed
  onChangeSpeed(next: AnalyzeSpeed): void
}
```

por:

```ts
interface ReadyAnalyzeViewProps {
  tree: GameTree
  /** Id de D1 (Fase 5): ver nota en `AnalyzeView`. */
  cloudId?: string
  /** true si esta sesión viene del camino "empezar desde cero" (spec 2026-07-15): arranca el
   * editor de variaciones ya activado, ver `editingVariation` más abajo. */
  startEditing: boolean
  onBack(): void
  onLoadAnother(): void
  speed: AnalyzeSpeed
  onChangeSpeed(next: AnalyzeSpeed): void
}
```

- [ ] **Step 6: Usar `startEditing` como valor inicial de `editingVariation` en `ReadyAnalyzeView`**

Reemplazar la firma de la función:

```ts
function ReadyAnalyzeView({ tree, cloudId, onBack, onLoadAnother, speed, onChangeSpeed }: ReadyAnalyzeViewProps) {
```

por:

```ts
function ReadyAnalyzeView({
  tree,
  cloudId,
  startEditing,
  onBack,
  onLoadAnother,
  speed,
  onChangeSpeed,
}: ReadyAnalyzeViewProps) {
```

Y reemplazar (dentro del mismo componente, junto al resto de los `useState` de modo):

```ts
  const [editingVariation, setEditingVariation] = useState(false)
```

por:

```ts
  // Arranca en `startEditing` (spec 2026-07-15): en un tablero vacío ("empezar desde cero") no hay
  // nada más para hacer, así que el primer click ya coloca piedra. `startEditing` es una prop
  // estable durante la vida de este componente (una sesión = un montaje, mismo patrón que `tree`).
  const [editingVariation, setEditingVariation] = useState(startEditing)
```

- [ ] **Step 7: Renombrar el botón "Cargar otro SGF" (ahora también vuelve al picker desde una sesión "desde cero")**

Reemplazar:

```tsx
        <button onClick={handleLoadAnother}>Cargar otro SGF</button>
```

por:

```tsx
        <button onClick={handleLoadAnother}>Elegir otra partida</button>
```

- [ ] **Step 8: Wiring en `AnalyzeView` — estado `startEditing`, nuevos handlers, nuevas props al render**

Reemplazar la función completa `AnalyzeView`:

```tsx
export function AnalyzeView({ onBack }: AnalyzeViewProps) {
  // Ref-guardado: `computeInitialAnalyzeState` (y el take-once de pendingOpen que hace) debe
  // correr EXACTAMENTE una vez por montaje, no en cada render — de ahí el ref en vez de llamarlo
  // directo en dos `useState(() => ...)` separados (correría dos veces, la segunda ya sin nada).
  const initialRef = useRef<InitialAnalyzeState | null>(null)
  if (initialRef.current === null) initialRef.current = computeInitialAnalyzeState()

  const [tree, setTree] = useState<GameTree | null>(initialRef.current.tree)
  // Id de D1 (Fase 5): presente si esta sesión viene de reabrir una partida guardada (arriba).
  // `SgfPicker`/import manual arrancan sin id (POST en el primer guardado, sin cambios).
  const [gameId, setGameId] = useState<string | undefined>(initialRef.current.gameId)
  // Cargada una sola vez (lectura síncrona de localStorage, mismo patrón que loadGame en main.tsx);
  // `key={speed}` en ReadyAnalyzeView fuerza el remount completo (review + store desde cero) cuando
  // el usuario cambia de nivel a mitad de una sesión — mismo mecanismo que `sessionKey` en main.tsx.
  const [speed, setSpeed] = useState<AnalyzeSpeed>(() => loadAnalyzeSpeed(window.localStorage))

  function handleChangeSpeed(next: AnalyzeSpeed): void {
    saveAnalyzeSpeed(window.localStorage, next)
    setSpeed(next)
  }

  function handleLoadAnother(): void {
    setTree(null)
    setGameId(undefined)
  }

  if (tree === null) {
    return <SgfPicker onLoad={setTree} onBack={onBack} />
  }

  return (
    <ModelGate net={ANALYZE_NETWORK}>
      <ReadyAnalyzeView
        key={speed}
        tree={tree}
        cloudId={gameId}
        onBack={onBack}
        onLoadAnother={handleLoadAnother}
        speed={speed}
        onChangeSpeed={handleChangeSpeed}
      />
    </ModelGate>
  )
}
```

por:

```tsx
export function AnalyzeView({ onBack }: AnalyzeViewProps) {
  // Ref-guardado: `computeInitialAnalyzeState` (y el take-once de pendingOpen que hace) debe
  // correr EXACTAMENTE una vez por montaje, no en cada render — de ahí el ref en vez de llamarlo
  // directo en dos `useState(() => ...)` separados (correría dos veces, la segunda ya sin nada).
  const initialRef = useRef<InitialAnalyzeState | null>(null)
  if (initialRef.current === null) initialRef.current = computeInitialAnalyzeState()

  const [tree, setTree] = useState<GameTree | null>(initialRef.current.tree)
  // Id de D1 (Fase 5): presente si esta sesión viene de reabrir una partida guardada (arriba).
  // `SgfPicker`/import manual arrancan sin id (POST en el primer guardado, sin cambios).
  const [gameId, setGameId] = useState<string | undefined>(initialRef.current.gameId)
  // Empezar desde cero (spec 2026-07-15): true SOLO en ese camino (`handleStartFromScratch`) —
  // arranca el editor de variaciones ya activado en ReadyAnalyzeView. Import de archivo y
  // reapertura vía /partidas (Fase 5 Task 6) siguen arrancando en modo vista, como hoy.
  const [startEditing, setStartEditing] = useState(false)
  // Cargada una sola vez (lectura síncrona de localStorage, mismo patrón que loadGame en main.tsx);
  // `key={speed}` en ReadyAnalyzeView fuerza el remount completo (review + store desde cero) cuando
  // el usuario cambia de nivel a mitad de una sesión — mismo mecanismo que `sessionKey` en main.tsx.
  const [speed, setSpeed] = useState<AnalyzeSpeed>(() => loadAnalyzeSpeed(window.localStorage))

  function handleChangeSpeed(next: AnalyzeSpeed): void {
    saveAnalyzeSpeed(window.localStorage, next)
    setSpeed(next)
  }

  function handleLoadAnother(): void {
    setTree(null)
    setGameId(undefined)
    setStartEditing(false)
  }

  function handleLoadFile(loaded: GameTree): void {
    setTree(loaded)
    setStartEditing(false)
  }

  function handleStartFromScratch(boardSize: BoardSize): void {
    setTree(emptyAnalyzeTree(boardSize))
    setStartEditing(true)
  }

  if (tree === null) {
    return (
      <SgfPicker onLoadFile={handleLoadFile} onStartFromScratch={handleStartFromScratch} onBack={onBack} />
    )
  }

  return (
    <ModelGate net={ANALYZE_NETWORK}>
      <ReadyAnalyzeView
        key={speed}
        tree={tree}
        cloudId={gameId}
        startEditing={startEditing}
        onBack={onBack}
        onLoadAnother={handleLoadAnother}
        speed={speed}
        onChangeSpeed={handleChangeSpeed}
      />
    </ModelGate>
  )
}
```

- [ ] **Step 9: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin salida (sin errores). Si aparece un error de tipo sobre `SgfPickerProps`/`onLoad`, revisar que TODOS los usos de `onLoad` en `SgfPicker` (interfaz, destructuring, body de `handleFile`) se hayan renombrado a `onLoadFile` — es el error más probable si algún paso quedó a medias.

- [ ] **Step 10: Suite de tests — confirmar que nada se rompió (no se agregan tests nuevos, ver Global Constraints)**

Run: `npm test -w @tengen/web`
Expected: `409 passed` (mismo número que antes de esta task — este cambio es puramente de UI, sin lógica de dominio nueva que testear).

- [ ] **Step 11: Build de producción**

Run: `npm run build -w @tengen/web`
Expected: `✓ built` sin errores (el warning de chunk size >500kB es preexistente y no relacionado).

- [ ] **Step 12: Verificación manual en navegador**

Con Chrome (WebGPU requerido, ver CLAUDE.md):

1. `npm run dev -w @tengen/web` (Vite, puerto por defecto — confirmar en la salida del comando).
2. Abrir la app, ir a "Analizar".
3. En el picker, confirmar que aparecen los 3 botones "9×9"/"13×13"/"19×19" bajo "o empezá en blanco:", además del input de archivo existente.
4. Click en "9×9": debe entrar directo a un tablero 9×9 vacío (tras "Preparando motor…"), CON "Editar variación" ya mostrando "Dejar de editar" (modo activo) y el texto "Modo edición: le toca a Negro".
5. Click en una intersección vacía: coloca una piedra negra sin pasos previos. Click en otra: piedra blanca (alterna turno). Confirmar que una jugada ilegal (click en una intersección ocupada) muestra el hint de error existente, sin romper nada.
6. Click en "Dejar de editar": el tablero deja de responder a clicks (mismo comportamiento que hoy fuera del modo edición).
7. Click en "Elegir otra partida": vuelve limpio al picker (sin arrastrar estado del tablero anterior).
8. Repetir con "13×13" y "19×19": mismo comportamiento, tamaño de tablero correcto.
9. **Regresión**: subir un archivo `.sgf` real por el input de archivo — debe arrancar en modo VISTA (NO editando), exactamente como antes de esta task.
10. Si hay sesión de Google activa: confirmar que jugar una piedra en el tablero "desde cero" dispara el `SyncBadge` ("Guardando en la nube…" → "Guardado en la nube"), y que aparece la fila nueva en "Mis partidas" al volver al menú.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/ui/AnalyzeView.tsx apps/web/src/styles/app.css
git commit -m "feat(web): Modo Analizar — empezar desde cero sin SGF

SgfPicker gana un segundo camino de entrada (botones 9x9/13x13/19x19) que
construye un GameTree vacio con los mismos defaults que Nueva partida en Modo
Jugar (chinese/komi 7/sin handicap). El editor de variaciones ya existente
arranca activado en ese camino (startEditing), asi que el primer click ya
coloca piedra - cubre analizar posiciones teoricas y dar clases con el mismo
mecanismo. 100% frontend, sin cambios en apps/worker.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Verificación final del plan

- `npx -w @tengen/web tsc --noEmit` sin errores.
- `npm test -w @tengen/web` → 409 passed (sin regresión, sin tests nuevos por diseño).
- `npm run build -w @tengen/web` → build OK.
- Checklist manual del Step 12 completo en Chrome real.
