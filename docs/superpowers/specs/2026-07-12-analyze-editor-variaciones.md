# Modo Analizar — Editor de variaciones

**Fecha:** 2026-07-12 · **Estado:** aprobado por Edgar · **Extiende:** Fase 3a (Modo Analizar), [roadmap](../plans/2026-07-10-tengen-v1-roadmap.md) · **Spec de producto:** [`2026-07-08-tengen-design.md`](2026-07-08-tengen-design.md)

## Contexto y objetivo

Hoy Modo Analizar (`apps/web/src/ui/AnalyzeView.tsx`) es de **solo lectura** sobre el árbol del SGF cargado: se navega la línea principal y las variaciones que ya trae el archivo, pero no hay forma de jugar una piedra propia y crear una rama nueva — el único click habilitado en el tablero es el del modo "adivinanza" (`guessWaiting`), que es efímero (compara UN click contra la jugada real del motor, no persiste en el árbol).

Edgar quiere poder cargar el SGF de otra persona, estudiarlo, y **jugar variaciones propias sobre esa partida** ("y si en vez de esto jugaba acá") para explorarlas con el motor — y después **exportar el resultado** a un archivo SGF. Es el modo de estudio estándar de KaTrain/Lizzie/Sabaki: control total sobre el tablero, no solo lectura.

## Alcance

**Dentro de esta extensión:**
- Un modo "editor de variaciones", activado por un toggle explícito, donde cada click en una casilla vacía del tablero juega una piedra (alternando color por turno) y crea un nodo nuevo en el árbol.
- Reglas normales de Go (legalidad, capturas, ko) — mismo oráculo `go-board` que ya usa Modo Jugar.
- Exportar el árbol completo (SGF original + todas las variaciones agregadas) a un archivo `.sgf`.

**Explícitamente fuera de esta extensión** (decisiones tomadas en el brainstorm, no re-litigar en el plan):
- **Sin análisis automático** de las variaciones nuevas — se sigue pidiendo con el botón "Analizar esta posición" que ya existe, igual que en cualquier otra posición del árbol.
- **Sin botón "deshacer"** — una jugada equivocada se corrige navegando a otra posición con los controles ya existentes (⏮◀▶⏭, árbol de jugadas); la variación mal jugada queda huérfana en el árbol, sin afectar nada.
- **Sin modo "setup" de piedras libres** (colocar/quitar piedras de cualquier color sin reglas, tipo editor de posiciones de Sabaki) — es una feature distinta (requeriría soportar propiedades SGF de setup `AB`/`AW`), no la que se pidió.
- **El review de fondo (`GameReview`) no se extiende** a cubrir variaciones del usuario — sigue analizando solo `tree.mainLine()` del SGF importado, como hoy.

## Arquitectura — reúso, no código de dominio nuevo

Todo lo que este editor necesita del dominio **ya existe y ya está testeado**, reusado sin cambios:

- `GameTree.addMove(move)` (`apps/web/src/game/gameTree.ts:78`) — ya crea un hijo nuevo (variación) cuando el cursor no está en el tip de la línea principal; es el mecanismo que ya usa Modo Jugar para sus propias variaciones.
- `validateMove(board, color, vertex)` + `currentTurn(handicap, moves)` (`apps/web/src/game/rules.ts`) — validan UNA jugada aislada contra el tablero actual (ocupado, suicida, ko), devuelven `{legal: boolean}`.
- `exportSgf(tree)` (`apps/web/src/game/sgf.ts`) — serializa el árbol completo (línea principal + todas las variaciones) a SGF válido; ya lo usa `PlayView.tsx`.

**Precedente exacto a replicar:** `PlayView.tsx` ya implementa este patrón para su propio "modo exploración" (`isExploring()`, líneas 284-296):

```ts
if (isExploring()) {
  const validation = validateMove(tree.boardAt(), turnAtCursor, vertex)
  if (!validation.legal) return
  tree.addMove({ color: turnAtCursor, vertex })
  bump()
  persist()
  return
}
```

El editor de variaciones de `AnalyzeView.tsx` es esencialmente este mismo bloque, sin `persist()` (Modo Analizar no persiste a localStorage) y sin la rama de "IA responde" que sigue después en `PlayView` (acá nunca hay IA automática).

## Diseño de interacción

- **Estado nuevo** en `ReadyAnalyzeView`: `const [editingVariation, setEditingVariation] = useState(false)`.
- **Botón toggle** "Editar variación" / "Dejar de editar" en el panel, cerca de "Analizar esta posición" — `disabled={booting}` igual que el resto de los controles de acción (mismo criterio que "Analizar esta posición", que ya usa ese guard). **Mutuamente excluyente con el modo adivinanza**: activar el editor cancela `guessWaiting` (y viceversa) — ambos modos consumen el único `onVertexClick` del tablero, no pueden convivir.
- **`onVertexClick` del `<Goban>`** se ramifica en tres casos (orden de precedencia):
  1. `editingVariation === true` → `handleEditVertexClick(v)`: `validateMove` + `tree.addMove` + `bump()`.
  2. `guessWaiting === true` → comportamiento actual (`handleBoardGuessClick`, sin cambios).
  3. Ninguno → `undefined` (sin click, solo lectura — comportamiento de hoy).
- **Indicador de estado**: mientras `editingVariation` está activo, un texto "Modo edición: le toca a {Negro|Blanco}" (deriva de `tree.currentTurnAt()`, ya existe — cero cálculo nuevo).
- **Navegar fuera del editor no lo desactiva** — es un modo explícito del usuario, se apaga solo con el botón toggle o al activar el modo adivinanza.

## Flujo de datos

Click en el tablero (editor activo) → `validateMove(tree.boardAt(), tree.currentTurnAt(), vertex)` → si `!legal`, se ignora en silencio (mismo criterio que `PlayView`, sin mensaje de error nuevo) → si `legal`, `tree.addMove({color, vertex})` → `bump()`.

Todo lo que se pinta en `ReadyAnalyzeView` (heatmap, ghost stones del PV, panel de winrate, árbol de jugadas) **ya se deriva de `tree`/`store` frescos en cada render** — no hace falta tocar `buildHeatMap`/`buildPvOverlay`/`GameTreePanel`, la variación nueva aparece sola en el árbol y en el tablero apenas se pinta.

**Caso de borde ya cubierto, sin tocar nada:** si el usuario pide "Analizar esta posición" y ANTES de que resuelva juega una variación nueva (cambiando `tree.current`), el resultado del análisis en vuelo no se atribuye mal — `handleAnalyzeClick` ya tiene el guard de staleness por-nodo (`if (tree.current.id === nodeId) ...`, `AnalyzeView.tsx:254`) que descarta el resultado si el nodo actual cambió mientras tanto.

## Export

Botón "Exportar SGF" en el panel — mismo patrón exacto que `PlayView.tsx:365-366`:

```ts
function handleExportSgf(): void {
  const text = exportSgf(tree)
  // descarga como archivo, mismo mecanismo que PlayView
}
```

Exporta el árbol **completo**: la línea principal del SGF original tal como se cargó, más todas las variaciones que el usuario haya jugado en cualquier punto — SGF soporta múltiples variaciones nativamente, `exportSgf` ya las serializa todas sin distinguir "original" de "agregada".

## Manejo de errores

Nada nuevo: una jugada ilegal se ignora en silencio, mismo comportamiento ya aceptado en `PlayView.tsx` modo exploración. No se introduce ningún mensaje de error nuevo para esto.

## Testing / verificación

- **Dominio:** cero tests nuevos necesarios — `validateMove`, `GameTree.addMove`, `exportSgf` ya están testeados por sus propias suites (`rules.test.ts`, `gameTree.test.ts`, `sgf.test.ts`); esta extensión solo los invoca desde un nuevo punto de la UI.
- **UI:** este proyecto no tiene tests de componente Preact hoy (los tests de `apps/web` son todos de lógica pura) — verificación manual en navegador, mismo criterio que el resto de `AnalyzeView.tsx`: activar el editor, jugar una variación legal (aparece en tablero + árbol), intentar una jugada ilegal (se ignora), analizar la variación nueva con "Analizar esta posición" (funciona igual que en cualquier nodo), exportar SGF y confirmar que el archivo incluye la variación.

## Decisiones tomadas en el brainstorm (resumen)

1. **Editor libre, ambos colores** — cada click juega el color que le toca según el turno del árbol, el usuario controla las dos partes (no hay "IA responde").
2. **Reglas normales de Go** — se reusa el oráculo `go-board` vía `validateMove`, no un modo de colocación libre.
3. **Sin auto-análisis** — el usuario pide análisis con el botón ya existente.
4. **Sin botón deshacer** — se corrige navegando, la variación mal jugada queda en el árbol sin molestar.
5. **Activación explícita por toggle** — evita crear variaciones sin querer con clicks exploratorios (p.ej. mirando el heatmap).

## Fuera de alcance (recordatorio, no re-litigar en el plan)

Modo setup sin reglas (piedras libres tipo editor de posiciones), extender el review de fondo a variaciones del usuario, botón deshacer/eliminar rama, auto-análisis tras cada jugada — todas quedan fuera; si en el futuro se necesitan, son su propio ciclo brainstorm→spec.
