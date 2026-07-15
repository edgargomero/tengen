# Modo Analizar — empezar desde cero (sin SGF)

**Fecha:** 2026-07-15 · **Estado:** aprobado por Edgar · **Extiende:** Fase 3a (Modo Analizar) + editor de variaciones ([`2026-07-12-analyze-editor-variaciones.md`](2026-07-12-analyze-editor-variaciones.md)), [roadmap](../plans/2026-07-10-tengen-v1-roadmap.md) · **Spec de producto:** [`2026-07-08-tengen-design.md`](2026-07-08-tengen-design.md)

## Contexto y objetivo

Hoy `AnalyzeView` (`apps/web/src/ui/AnalyzeView.tsx`) solo tiene una puerta de entrada: `SgfPicker`, que exige subir un archivo `.sgf` antes de mostrar cualquier tablero. Edgar quiere poder usar Modo Analizar **sin partir de un SGF existente**, para dos casos de uso que resultan ser el mismo problema de fondo:

1. **Analizar desde cero**: explorar una posición o línea teórica que nunca se jugó, sin tener que fabricar un SGF externo primero.
2. **Dar clases**: usar el tablero de Analizar (con heatmap, PV, winrate del motor) como pizarra — colocar piedras de demostración para un alumno.

Ambos casos se resuelven con lo mismo: un tablero vacío donde se puede colocar cualquier piedra, de cualquier color, sin restricción de turno IA — que es exactamente lo que ya hace el **editor de variaciones** (spec previo, arriba). No hace falta ningún concepto nuevo de "clase" ni de "posición teórica": solo un punto de entrada alternativo a `ReadyAnalyzeView` que no dependa de un archivo.

**100% frontend.** `GameTree` ya se puede construir directo desde `{boardSize, komi, rules, handicap}` sin pasar por un SGF (`GameTree.fromConfig`/su constructor, `apps/web/src/game/gameTree.ts:57-71`); el guardado en la nube (Fase 5, `mode: 'analizar'`) ya opera sobre cualquier `GameTree` sin importar su origen. No se toca `apps/worker`.

## Alcance

**Dentro de esta extensión:**
- Un segundo camino de entrada en `SgfPicker`, junto al input de archivo: elegir tamaño de tablero (9×9 / 13×13 / 19×19) y arrancar directo en un tablero vacío.
- El editor de variaciones arranca **activado** en ese camino (sin toggle manual): en un tablero vacío no hay nada más que hacer, así que el primer click ya coloca una piedra.
- Reutiliza sin cambios todo lo que ya existe para una sesión de Analizar: `GameReview`, winrate graph, guess mode, guardado en la nube, export SGF.

**Explícitamente fuera de esta extensión** (decisiones tomadas en el brainstorm, no re-litigar en el plan):
- **Sin selector de komi/reglas/hándicap** — arranca con los mismos valores por defecto que "Nueva partida" en Modo Jugar (`chinese`, komi 7, sin hándicap). Colocar piedras de hándicap a mano ya lo cubre el editor de variaciones (cualquier color, cualquier casilla).
- **Sin plantillas de posiciones guardadas** (joseki, tsumego, etc.) — es tablero vacío liso, nada más.
- **Sin concepto de "sesión de clase" separado** — es la misma `ReadyAnalyzeView` de siempre; se guarda en la nube igual que cualquier otra sesión de Analizar (`mode: 'analizar'`), sin campo ni distinción nueva en el modelo de datos.

## Diseño de interacción

**`SgfPicker`** gana una segunda sección bajo el input de archivo existente, con un rótulo tipo "o empezá en blanco:" y tres botones "9×9" / "13×13" / "19×19". Cada botón es la acción completa — sin paso de confirmación intermedio: un click construye el tablero y entra directo.

Cambio de props: en vez de un único `onLoad(tree: GameTree)`, `SgfPicker` recibe dos callbacks — `onLoadFile(tree: GameTree)` (comportamiento actual del input, sin cambios) y `onStartFromScratch(boardSize: BoardSize)` (nuevo). La construcción del `GameTree` vacío vive en `AnalyzeView`, no en `SgfPicker` (mismo lugar donde ya vive la lógica de armar el árbol para el camino de reapertura de Task 6 de Fase 5).

**`AnalyzeView`** gana un estado `startEditing` (booleano), en paralelo a `tree`/`gameId`:
- Camino "empezar desde cero": `setTree(new GameTree({ boardSize, komi: 7, rules: 'chinese', handicap: 0 }))` + `setStartEditing(true)`.
- Camino import de archivo (`onLoadFile`) y camino de reapertura vía `/partidas` (Fase 5 Task 6): `startEditing` en `false` — arrancan en modo vista, como hoy.
- `handleLoadAnother` (rebautizado en la UI, ver abajo) resetea `startEditing` a `false` junto con `tree`/`gameId`, para que volver al picker y elegir otro camino no arrastre el estado del anterior.

`startEditing` se pasa como prop nueva a `ReadyAnalyzeView`, que la usa como valor **inicial** de su propio estado `editingVariation` (`useState(startEditing)` en vez de `useState(false)`) — mismo patrón ya establecido para props estables por-montaje (`tree`, `cloudId`). Nada más cambia en `ReadyAnalyzeView`: mismo botón para salir del modo edición, mismo guardado automático en cada piedra colocada (`handleEditVertexClick` ya llama `cloud.save`), mismo `GameReview`/gráficos — que ya toleran un `mainLine()` vacío, es un estado que la app ya visita hoy al navegar a la raíz de cualquier partida.

**Detalle de copy**: el botón "Cargar otro SGF" pasa a llamarse "Elegir otra partida" — ahora también sirve para volver al picker desde una sesión "desde cero" (donde nunca hubo un SGF que "cargar").

## Flujo de datos

Click en "9×9"/"13×13"/"19×19" → `AnalyzeView` construye el `GameTree` vacío → `setTree` + `setStartEditing(true)` → se monta `ModelGate` + `ReadyAnalyzeView` (mismo camino de montaje que cualquier otra sesión) → `editingVariation` nace en `true` → el primer click en el tablero ya es `handleEditVertexClick` (validar + `tree.addMove` + `bump()` + `cloud.save`, sin cambios sobre el editor de variaciones existente).

## Manejo de errores

Nada nuevo: una jugada ilegal se ignora en silencio, mismo comportamiento ya aceptado en el editor de variaciones. Sin sesión activa, el guardado en la nube es no-op, igual que cualquier otra sesión de Analizar.

## Testing / verificación

- **Dominio:** cero tests nuevos — `GameTree`/`validateMove`/`exportSgf` ya están testeados por sus propias suites; esta extensión solo los invoca desde un tablero vacío en vez de uno importado.
- **UI:** este proyecto no tiene tests de componente Preact (todos los tests de `apps/web` son de lógica pura) — verificación manual en navegador: elegir cada tamaño de tablero desde el picker, confirmar que el primer click ya coloca piedra (sin activar nada a mano), jugar ambos colores libremente, confirmar guardado en la nube con sesión activa (fila nueva en D1, `mode: 'analizar'`), exportar SGF, y confirmar que "Elegir otra partida" vuelve limpio al picker (sin arrastrar `startEditing` al camino siguiente).

## Decisiones tomadas en el brainstorm (resumen)

1. **Un solo mecanismo para "desde cero" y "dar clases"** — ambos son tablero vacío + editor de variaciones ya existente, no dos features.
2. **Solo tamaño de tablero configurable** — komi/reglas/hándicap fijos en los defaults de Modo Jugar; el hándicap se resuelve colocando piedras a mano con el editor.
3. **Botón junto al picker existente**, no una pantalla nueva — cambio mínimo, ambos caminos conviven.
4. **Editor de variaciones arranca activado** en este camino — cero fricción extra en un tablero que no tiene nada más para hacer.

## Fuera de alcance (recordatorio, no re-litigar en el plan)

Selector de komi/reglas/hándicap, plantillas de posiciones guardadas, cualquier distinción de datos entre "sesión de clase" y sesión de análisis normal — todas quedan fuera; si en el futuro se necesitan, son su propio ciclo brainstorm→spec.
