# Editor avanzado de partidas — Fase 1: "Editor de repaso"

**Fecha:** 2026-07-23 · **Estado:** en revisión de Edgar · **Extiende:** [Editor de variaciones](2026-07-12-analyze-editor-variaciones.md), [Análisis persistido en el SGF](2026-07-15-analisis-persistido-sgf-design.md) · **Spec de producto:** [`2026-07-08-tengen-design.md`](2026-07-08-tengen-design.md)

## Contexto y objetivo

Hoy tengen puede **agregar** jugadas y variaciones (toggle "Editar variación" en Modo Analizar) pero nada más: no se puede comentar, marcar el tablero, borrar/promover ramas, ni editar metadata. Edgar pidió un **editor avanzado de partidas** ("poder editar el SGF") y eligió el **roadmap completo por fases** estilo Sabaki, empezando por la Fase 1 pero con el diseño global escrito de entrada.

**Cómo lo hacen otros (investigación):** el patrón es casi universal — un **editor estructurado**, no un editor de texto. Sabaki (cuyos componentes tengen ya usa), OGS, EidoGo, WGo.js, KaTrain, Lizzie: árbol de jugadas + paleta de marcas + caja de comentarios + formulario de metadata + modo "setup". Editar el **texto SGF crudo** a mano casi nadie lo ofrece salvo como "pegar SGF" al importar (es frágil). Conclusión: "editar el SGF" = **editar la partida**; el SGF es solo el formato de serialización.

Todo el editing vive en **Modo Analizar** (donde ya está el toggle de edición). Modo Jugar (`PlayView`) no se toca.

## Roadmap por fases (diseño global, para dejar el rumbo en registro)

### Fase 1 — "Editor de repaso" ← ESTA (detallada abajo)
Comentarios por jugada + marcas en el tablero + operaciones de árbol que faltan (borrar rama, promover variación a principal, pasar). Mayormente **aditivo**: campos opcionales nuevos, codec nuevo, sin romper el round-trip existente.

### Fase 2 — "Componer posiciones + metadata"
- Piedras de **setup** libres (`AB`/`AW`/`AE` + `PL` "a quién le toca") para armar problemas/posiciones.
- **Editor de metadata** (`PB`/`PW`/`BR`/`WR`/`EV`/`DT`/`RE`…) — campos OPCIONALES nuevos en `GameTreeMeta`.
- **Open question (se resuelve en el spec de la Fase 2):** el `Position` del motor (`packages/engine`) solo acepta `handicap`, no setup arbitrario. Analizar una posición compuesta con setup requiere **extender `Position`** (motor) o **limitar el análisis** en esas posiciones. Es el mayor riesgo de la Fase 2; queda como pregunta abierta nombrada, no se resuelve ahora.

### Fase 3 — "SGF crudo" (escotilla, opcional)
Textarea para pegar/editar el texto SGF e importarlo (validado por `importSgf`). Barato; lo que menos hacen las apps serias, pero cubre la frase literal "editar el SGF".

### Cross-cutting (todas las fases)
- **Idempotencia byte-idéntica:** cada propiedad SGF nueva en orden canónico fijo, escrita solo si presente (mismo criterio que `TGHC` del nigiri).
- **Campos nuevos de meta = OPCIONALES:** evitar el churn de ~40 sitios de construcción que causó el campo *requerido* de `humanColor`.
- **Precedencia de `markerMap`** (Shudan admite un marker por vértice): marca de usuario > markers del análisis (burbuja de pérdida #9 > labels del PV).

## Alcance de la Fase 1

**Dentro:**
- **Comentario por nodo** (`C[]`): textarea editable en Modo edición, visible también en modo lectura.
- **Marcas en el tablero** (`TR`/`SQ`/`CR`/`MA`/`LB`): paleta △ □ ○ ✕ A; clic coloca/quita; etiquetas auto-incrementales (letras).
- **Operaciones de árbol nuevas:** borrar rama (`removeNode`), promover variación a principal (`promoteToMainLine`), pasar (`addMove` con `vertex:'pass'`).
- **Persistencia** de comentarios+marcas en el SGF (export manual y guardado en la nube) y su restauración al reimportar — componiendo el codec nuevo con el de análisis ya existente, **sin tocar el núcleo de `game/sgf.ts`**.

**Fuera (decisiones del brainstorm / roadmap, no re-litigar en el plan):**
- **Sin setup de piedras libres** (`AB`/`AW`/`AE` arbitrarios) ni editor de metadata — son la Fase 2.
- **Sin editor de SGF crudo** — es la Fase 3.
- **Sin etiquetas de texto libre** en `LB` — solo letras auto-generadas (ver §Decisión: labels). El texto libre en `LB[vertice:texto]` rompería con `:`/`]` en el valor; se evita por diseño en la Fase 1.
- **Sin invalidación del review tras editar el árbol** — igual que hoy, `AnalysisStore` no expira (ver §Decisión: report stale).
- **Modo Jugar sigue descartando comentarios en round-trip** — ver §Límite de alcance conocido.

## Correcciones al plan (verificadas contra el código real)

Tres afirmaciones del plan-borrador se ajustan tras leer el código:

1. **`overlays.ts` NO tiene un `buildMarkerMap` "círculo de última jugada".** No existe tal función ni tal marca. El `markerMap` que hoy recibe el `<BoundedGoban>` (`AnalyzeView.tsx:668`) es `mergeMarkerMaps(pointsLostMarkerMap, pvOverlay?.markerMap)`: la precedencia real es **burbuja de pérdida #9 > labels numerados del PV**. La "precedencia usuario > análisis > última-jugada" del plan se traduce entonces a **usuario > (#9 > PV)**.
2. **`handleEditVertexClick` ya llama `cloud.save(cloudSnapshot())` en cada edición** (`AnalyzeView.tsx:578`), y tanto `cloudSnapshot()` como `handleExportSgf` serializan con `exportSgf(tree, analysisExtraData)`. Para que comentarios+marcas persistan hay que **componer** el codec de anotaciones dentro de ese `getExtraData` y disparar `cloud.save` también al editar comentario/marca.
3. **`Markup.vertex` es `{x:number;y:number}`, no `Vertex`** (el `Vertex` del motor incluye `'pass'`, que no tiene casilla): una marca siempre cae en una intersección real.

4. **Idempotencia del escapeo — verificada empíricamente** (no asumida del plan): `@sabaki/sgf` escapa `]`→`\]` y `\`→`\\` al serializar, des-escapa al parsear, y re-serializa determinista. Probado con `]`, `\`, backslash **final**, `\]` pre-escapado, `\\` y newline embebido → `exportSgf(importSgf(exportSgf(t)))` byte-idéntico y valor preservado en los 8 casos. El comentario se guarda **crudo** (sin escapeo manual); la lib se encarga.

## Diseño

### 1. Modelo de datos — `apps/web/src/game/gameTree.ts`

`GameNode` gana dos campos **opcionales MUTABLES** (los `id/move/parent/children` siguen `readonly`; solo estos dos son editables — mismo espíritu que mutar `tree.meta.result`/`tree.meta.clock` en el lugar):

```ts
export interface GameNode {
  readonly id: number
  readonly move: Move | null
  readonly parent: GameNode | null
  readonly children: GameNode[]
  comment?: string
  markup?: Markup[]
}

export type MarkupType = 'triangle' | 'square' | 'circle' | 'cross' | 'label'
export interface Markup {
  type: MarkupType
  vertex: { x: number; y: number }
  /** Solo presente (y solo válido) cuando `type === 'label'`. */
  label?: string
}
```

**Decisión on-node, no store paralelo** (a diferencia del análisis cacheado, que sí vive en `AnalysisStore`): son datos **autorados** (no regenerables) y, como la Fase 1 agrega **borrar**, la anotación **muere con el nodo gratis** — un store paralelo tendría que purgar el subárbol por id o filtraría entradas huérfanas.

**Invariante ≤1 markup por vértice:** aunque `markup` es un array, se mantiene a lo sumo UNA marca por casilla (Shudan solo pinta un marker por vértice). El colocador (§UI) reemplaza al cambiar de herramienta y hace toggle-off con la misma — nunca deja dos marcas en el mismo `{x,y}`.

### 2. API de árbol nueva — `gameTree.ts`

- **`removeNode(node): void`** — desengancha `node` de `parent.children`. Guard: si `node === this.root`, no-op (la raíz no se borra). Si el cursor (`this.current`) estaba dentro del subárbol borrado (incluido `node` mismo), se reubica en `node.parent`. Mutación estructural pura.
- **`promoteToMainLine(node): void`** — para cada nodo del camino raíz→`node`, lo mueve al índice 0 de `parent.children` (así `mainLine()`, que sigue `children[0]`, pasa por `node`). Incluye "promover un nivel" como subconjunto. Recorre de `node` hacia arriba: por cada `n` con padre `p`, si `p.children.indexOf(n) > 0`, se mueve `n` al frente.

Ambas son mutaciones puras y testeables; las vistas (`GameTreeGraph`) re-renderizan solas vía `bump()`.

### 3. Codec SGF de anotaciones — `apps/web/src/game/sgfAnnotationCodec.ts` (NUEVO)

Espeja `analysis/sgfAnalysisCodec.ts`, pero vive en `game/` (los datos son de dominio, no de análisis). Importa `vertexToSgf`/`sgfToVertex` de `./sgf` y `Markup`/`MarkupType`/`GameNode` de `./gameTree`. **`game/sgf.ts` sigue puro** (no lo importa).

- **`encodeAnnotationForNode(node): Record<string, string[]>`** — `C[comment]` (crudo — la lib escapa) + markup a `TR`/`SQ`/`CR`/`MA` (listas de vértices de 2 letras) y `LB` (lista de `vertice:etiqueta`). Omite claves vacías. Orden canónico fijo `C → TR → SQ → CR → MA → LB`, y **vértices ordenados dentro de cada clave** (idempotencia).
- **`decodeAnnotationFromNodeData(data): { comment?: string; markup?: Markup[] }`** — inverso, **nunca lanza**. `LB` se parte en el primer `:` (`vertice:etiqueta`). Vértices fuera de tablero o malformados se ignoran en silencio (mismo criterio defensivo que `moveFromData`/`decodeAnalysisFromNodeData`).

Mapeo tipo ↔ propiedad SGF (estándar FF[4]): `triangle→TR`, `square→SQ`, `circle→CR`, `cross→MA`, `label→LB`.

### 4. Composición del hook (sin tocar `game/sgf.ts`) — `AnalyzeView.tsx`

Hoy `AnalyzeView` pasa UN `getExtraData` (análisis). Se compone con anotaciones en una función local:

```ts
function extraDataForNode(node: GameNode): Record<string, string[]> | undefined {
  const merged = { ...encodeAnnotationForNode(node), ...(analysisExtraData(node) ?? {}) }
  return Object.keys(merged).length > 0 ? merged : undefined
}
```

- **Orden de emisión:** anotaciones primero (`C/TR/SQ/CR/MA/LB`), análisis después (`TGW/TGS/TGN/TGP`) — determinista (el `stringify` de `@sabaki/sgf` respeta el orden de inserción, ya explotado por el codec de análisis). `moveToData` (B/W) va SIEMPRE primero (lo pone `toSgfNode`), sin cambios.
- Se usa en **ambos** call sites de serialización: `handleExportSgf` y `cloudSnapshot` (que hoy pasan `analysisExtraData`).
- **Import:** en los dos `importSgf` con callback (`computeInitialAnalyzeState`, `SgfPicker.handleFile`), el `onNodeData` decodifica ambos:

```ts
importSgf(text, (node, data) => {
  const decoded = decodeAnalysisFromNodeData(data)
  if (decoded) analysisSeed.set(node.id, decoded)
  const { comment, markup } = decodeAnnotationFromNodeData(data)
  if (comment !== undefined) node.comment = comment
  if (markup !== undefined) node.markup = markup
})
```

Un SGF **sin** anotaciones no escribe ninguna propiedad nueva → export byte-idéntico al de hoy (sin regresión).

### 5. UI — Modo Analizar (`AnalyzeView.tsx` + componentes nuevos)

- **Renombrar** el toggle "Editar variación" → **"Editar"** (alcance ampliado). Con edición activa aparece el panel de edición.
- **Sub-modos mutuamente excluyentes dentro de Editar** (evita el bug de "el clic para marcar juega una piedra"): estado `editTool: 'stone' | MarkupType`, default `'stone'`. La paleta (botones "Jugar piedra" / △ □ ○ ✕ A) fija el activo. `handleEditVertexClick` despacha por `editTool`:
  - `'stone'` → comportamiento actual (`validateMove` + `addMove`).
  - marca → coloca/quita en `tree.current.markup` (toggle si ya hay marca en ese vértice; reemplaza si es de otro tipo; ≤1 por vértice).
- **`onVertexClick`** conserva la precedencia de modos de arriba: `editingVariation ? handleEditVertexClick : guessWaiting ? handleBoardGuessClick : undefined`. Editar y adivinanza siguen siendo mutuamente excluyentes (ya lo son hoy).
- **Comentario:** `<textarea>` bound a `tree.current.comment` → al editar: mutar + `bump()` + `cloud.save(cloudSnapshot())`. El comentario del nodo actual se muestra **también en modo lectura** (debajo del panel).
- **Ops de árbol:** botones "Borrar rama" (`removeNode(tree.current)` + `afterNavigate()`), "Promover a principal" (`promoteToMainLine(tree.current)` + `bump()`), "Pasar" (`addMove({color: currentTurnAt(), vertex:'pass'})` — patrón ya existente en `PlayView`). Todos disparan `cloud.save`. "Borrar rama" se deshabilita en la raíz.
- **Etiquetas auto-incrementales:** al colocar con la herramienta label, se usa la primera letra A–Z no usada en las marcas `label` del nodo. Toggle-off si ya hay label en ese vértice. Cap 26 letras (más que suficiente por posición; documentado).

### 6. Render — `overlays.ts` + `AnalyzeView.tsx`

Nueva función pura `buildAnnotationMarkerMap(node, boardSize): (Marker | null)[][]` en `overlays.ts` (junto a las otras `build*Map`): recorre `node.markup` y coloca cada marca como `Marker` de Shudan (`{type}` para △□○✕, `{type:'label', label}` para labels). Fusión en `AnalyzeView`, con la **precedencia usuario > (#9 > PV)**:

```ts
const analysisMarkers = mergeMarkerMaps(pointsLostMarkerMap, pvOverlay?.markerMap, boardSize)
const markerMap = mergeMarkerMaps(buildAnnotationMarkerMap(tree.current, boardSize), analysisMarkers, boardSize)
```

`mergeMarkerMaps(played, pv)` ya devuelve `played[y][x] ?? pv[y][x]` → la marca de usuario gana. Cero ramas nuevas en `mergeMarkerMaps`.

## Decisiones tomadas (para no re-litigar en el plan)

- **Labels = letras auto-generadas, no texto libre** — sidestep del escapeo de `LB[vertice:texto]` (`:`/`]` en el valor). Texto libre queda para una fase posterior si se pide.
- **Report/turning-points quedan "best-effort" tras editar el árbol** — el reporte cacheado del review indexa por posición en `mainLine()` (`nodeForReportEntry` → `mainLine()[n-1]`); tras `promoteToMainLine`/`removeNode` puede apuntar a nodos corridos hasta el próximo ciclo de review. El **gráfico de winrate se auto-cura** (el store está keyeado por `id` de nodo, estable). No se construye maquinaria de invalidación (YAGNI, mismo criterio que el spec de análisis persistido). Decisión consciente, no sorpresa latente.
- **`Markup.vertex = {x,y}`** (sin `'pass'`) — una marca siempre tiene casilla.
- **Persistencia en cada edición** — comentario y marca disparan `cloud.save` igual que ya hace una jugada de variación (Fase 5). Un solo camino de guardado.

## Límite de alcance conocido

**Modo Jugar (`PlayView`) descarta comentarios en round-trip.** Su `importSgf` no pasa un `onNodeData` que decodifique anotaciones, y su `exportSgf`/`cloudSnapshot` no pasan el codec — así que importar un SGF con `C[]` en Modo Jugar y re-exportar **pierde los comentarios**. Esto es **comportamiento preexistente** (Modo Jugar nunca preservó comentarios), no una regresión de esta fase. Se deja fuera de alcance a propósito (la Fase 1 es un editor de *repaso*, que vive en Analizar). Si Edgar quiere round-trip sin pérdida en todas las pantallas, cablear el mismo codec en los `importSgf`/`exportSgf` de `PlayView` es un follow-up chico — **se marca explícitamente para su decisión**.

## Testing / verificación

**Tests nuevos (Vitest, lógica pura — sin tests de componente, convención del repo):**
- `game/gameTree.test.ts` (ampliar): `removeNode` (cursor reubicado al padre cuando estaba en el subárbol; raíz protegida = árbol intacto; subárbol desaparece). `promoteToMainLine` (`mainLine()` cambia y pasa por el nodo promovido; orden de hijos correcto en cada ancestro; "promover un nivel" como caso).
- `game/sgfAnnotationCodec.test.ts` (nuevo): comentario con `]`/`\`/`\` final/newline round-trip exacto; markup de los 5 tipos round-trip; **idempotencia byte-idéntica** `exportSgf(importSgf(exportSgf(t)))` con comentarios+marcas en varias ramas; y un SGF **sin** anotaciones sigue byte-idéntico (no escribe props nuevas).
- `analysis/overlays.test.ts` (ampliar): precedencia del `markerMap` (marca de usuario gana sobre burbuja #9 y sobre label de PV en la misma casilla; celda transpuesta vacía, mismo rigor `[y][x]` que el resto del archivo).

**Automatizada:** `npx -w @tengen/web tsc --noEmit` · `npm test -w @tengen/web` · `npm run build -w @tengen/web`. (El motor no se toca; `@tengen/engine` sin cambios.)

**Manual en Chrome (dev server local):** cargar un SGF real → Editar: comentar una jugada, poner marcas (triángulo + etiqueta), **borrar una rama**, **promover una variación** a principal, **pasar**; el comentario del nodo se ve al navegar; **exportar SGF → reimportar conserva comentarios + marcas + la estructura editada**; un SGF sin anotar exporta byte-idéntico a hoy (sin regresión).

## Ejecución

Implementar la Fase 1 directo en `main` (patrón del repo), acotada a `apps/web` (cero cambios de motor ni worker). Sin subagentes/Workflow salvo pedido explícito. Deploy: separado, decisión de Edgar. Las Fases 2 y 3 obtienen su propio spec cuando lleguemos; la Fase 2 arranca resolviendo el open question del `Position` del motor.
