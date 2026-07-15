# Modo Analizar — persistir el análisis del motor en el SGF

**Fecha:** 2026-07-15 · **Estado:** aprobado por Edgar · **Extiende:** Fase 3a (Modo Analizar), [roadmap](../plans/2026-07-10-tengen-v1-roadmap.md) · **Spec de producto:** [`2026-07-08-tengen-design.md`](2026-07-08-tengen-design.md)

## Contexto y objetivo

Hoy el análisis del motor (winrate, score, variación principal por posición) vive SOLO en memoria (`AnalysisStore`, `apps/web/src/analysis/analysisStore.ts`) — se pierde al recargar la página o al reabrir la partida desde "Mis partidas" (Fase 5) o desde un archivo `.sgf`. Reabrir dispara `GameReview` desde cero, que vuelve a encolar y analizar TODA la línea principal contra el motor, aunque ya se hubiera analizado antes. Edgar pidió persistir ese análisis en el propio SGF para evitar ese re-análisis completo al reabrir.

**Verificado leyendo el código real (no asumido):** `computeNodePointsLost` (`analysis/vendor/web-katrain/nodeAnalysis.ts:12-26`, la función que alimenta la detección de errores/turning-points) y `buildWinrateGraphData` (`analysis/winrateGraphData.ts:41-43`) usan **únicamente** `analysis.winrate` y `analysis.scoreLead` a nivel raíz de cada nodo — ninguna de las dos necesita la lista de candidatas del motor (`analysis.moves`). El heatmap completo (`buildHeatMap`, `overlays.ts:47-63`) sí necesita TODAS las candidatas con sus visitas — pero eso solo se pinta para la posición que el usuario está mirando en ese momento, no para las 100+ jugadas de una partida entera.

## Alcance

**Qué se persiste, por cada nodo (raíz o jugada, línea principal O variación) que tenga una entrada en `AnalysisStore` al momento de exportar:**
- `winrate` y `scoreLead` a nivel raíz de esa posición.
- Cuántas visitas tenía ese análisis (`Analysis.visits`) — para decidir al reabrir si conviene mejorarlo (ver §Comportamiento al reabrir).
- La variación principal sugerida por el motor ahí: vértice + secuencia completa (`pv`) de la candidata más visitada — lo que hoy dibuja `buildPvOverlay` como piedras fantasma numeradas.

**Qué NO se persiste (decisión del brainstorm, YAGNI):**
- Las demás candidatas del motor (lo que arma el heatmap completo de una posición) — un click de "Analizar esta posición" al llegar a esa jugada la repone al toque; guardar eso para toda la partida no tiene beneficio proporcional a su peso.
- `ownership` (`Analysis.ownership`, mapa de territorio) — confirmado que **ningún** archivo de `apps/web` lo lee hoy; no hay nada que restaurar.
- Cualquier lógica de invalidación de análisis stale tras editar una variación — `AnalysisStore` no tiene eso hoy tampoco (es cache de solo lectura/escritura explícita, sin expiración); esta fase no lo introduce.
- UI nueva — no hay checkbox ni botón nuevo. Se guarda siempre que se exporta (un solo camino), se restaura siempre que se importa.

**Se guarda SIEMPRE que se exporta**, en los dos caminos existentes — sin distinción "limpio" vs "con análisis" (decisión explícita de Edgar): el botón "Exportar SGF" de `AnalyzeView.tsx` y el guardado automático en la nube (`cloudSnapshot()`, Fase 5). Cualquier otro programa que abra el archivo (Sabaki, Lizzie) ignora las propiedades que no reconoce — así está pensado el formato SGF; no rompe nada, solo agrega peso menor al archivo.

## Formato: propiedades SGF propias, sin JSON

Reusando el mismo esquema de coordenadas de 2 letras que ya usa `vertexToSgf`/`sgfToVertex` (`game/sgf.ts:20-27`) — evita introducir un formato de escape nuevo (JSON dentro de una propiedad SGF exige escapar `]`/`\`, que este archivo no maneja hoy). Cinco propiedades nuevas, con prefijo `TG` (distintivo de tengen, sin colisión con las 1-2 letras que usa el estándar SGF FF[4]):

| Propiedad | Contenido | Ejemplo |
|---|---|---|
| `TGW` | `Analysis.winrate` (raíz), 4 decimales | `TGW[0.6212]` |
| `TGS` | `Analysis.scoreLead` (raíz), 2 decimales | `TGS[3.45]` |
| `TGN` | `Analysis.visits` (raíz — NO las visitas de la candidata) | `TGN[100]` |
| `TGV` | vértice de la candidata con más visitas (2 letras) | `TGV[qf]` |
| `TGP` | secuencia completa (`pv`) de esa misma candidata, vértices concatenados de a 2 letras, SIN separador | `TGP[qfncqp]` (3 jugadas) |

"Candidata con más visitas" = mismo criterio que ya usa `AnalyzeView.tsx` para elegir `topMove` (`analysis.moves.reduce((best, m) => m.visits > best.visits ? m : best, ...)`) — un `reduce` por visitas, sin asumir que `analysis.moves` viene pre-ordenado por el motor.

`TGV`/`TGP` se omiten si la candidata top es un pase, o si `analysis.moves` viene vacío — igual que hoy: un pase no tiene casilla que dibujar (`buildPvOverlay` ya trunca la secuencia ahí). La secuencia persistida en `TGP` se trunca en el primer pase o vértice fuera de tablero (mismo criterio que YA aplica `buildPvSequence` al dibujar) — nunca se inventa una codificación para "pase" dentro de la secuencia concatenada.

Ejemplo de una jugada con análisis cacheado, dentro de una variación real:

```
(;B[pd]TGW[0.5512]TGS[1.20]TGN[100]TGV[qf]TGP[qfnc]
  (;W[dp]TGW[0.5301]TGS[0.80]TGN[100]TGV[nc]TGP[ncqc])
  (;W[dd]TGW[0.5104]TGS[-0.30]TGN[100]TGV[fc]TGP[fcqc]))
```

**Tamaño real, no estimado a ojo:** ~70 caracteres por nodo con análisis (peor caso, PV de 15 jugadas). Una partida de 300 jugadas completamente analizada agrega ~21KB al SGF — muy por debajo del límite de 256KB que ya existe para el campo `sgf` de la tabla `games` (`apps/worker/src/games.ts`, `MAX_SGF_LENGTH`).

## Arquitectura: `game/sgf.ts` no se entera de qué es un "análisis"

Todo el resto del código de `apps/web/src/analysis/` ya depende de `apps/web/src/game/` (nunca al revés) — `overlays.ts`, `katrainAdapter.ts`, `gameReview.ts` importan de `../game/gameTree`, ninguno de `game/` importa de `analysis/`. Esta fase mantiene esa dirección: `game/sgf.ts` sigue siendo dominio puro, sin importar `Analysis`/`AnalysisStore`.

- `exportSgf(tree, getExtraData?: (node: GameNode) => Record<string, string[]> | undefined): string` — nuevo segundo parámetro opcional. Para cada nodo (incluida la raíz, fusionado con `extraRootData`), si `getExtraData(node)` devuelve algo, se mergea en el `data` de ESE nodo antes de armar el `SgfNode`. `game/persistence.ts` (`saveGame`) y `PlayView.tsx` (`cloudSnapshot`) — los dos call sites de Modo Jugar, sin concepto de análisis — siguen llamando `exportSgf(tree)` sin el segundo argumento: cambio 100% aditivo, sin tocar esos call sites.
- `importSgf(source, onNodeData?: (node: GameNode, data: Record<string, string[]>) => void): GameTree` — nuevo segundo parámetro opcional, invocado una vez por nodo creado (incluida la raíz) con el `GameNode` recién construido (con su `.id` ya asignado) y el `data` crudo parseado de ESE nodo del SGF.
- La lógica específica (qué propiedades leer/escribir, cómo convertir `Analysis`↔`TGW/TGS/...`) vive en un módulo nuevo `analysis/sgfAnalysisCodec.ts`, que sí importa de `game/` (dirección ya establecida) y de `@tengen/engine` (`Analysis`/`MoveAnalysis`):
  - `encodeAnalysisForNode(analysis: Analysis): Record<string, string[]>` — arma las propiedades `TGW/TGS/TGN/TGV/TGP` desde un `Analysis`.
  - `decodeAnalysisFromNodeData(data: Record<string, string[]>): Analysis | null` — reconstruye un `Analysis` "degradado" (un solo candidato en `moves`, o `moves: []` si no había `TGV`) desde las propiedades leídas; `null` si el nodo no tenía `TGW`/`TGS` (nunca se analizó).
  - `AnalyzeView.tsx` pasa `(node) => store.has(node.id) ? encodeAnalysisForNode(store.get(node.id)!) : undefined` a `exportSgf`, y un callback que llama `store.set(node.id, decoded)` a `importSgf`, para cada nodo cuyo `decodeAnalysisFromNodeData` no dé `null`.

**`Analysis` reconstruido es un `Analysis` real, no un tipo aparte** — con `moves` conteniendo cero o un candidato (el top). Todo el resto del código (`buildHeatMap`, `buildPvOverlay`, `winrateGraphData`, `nodeAnalysis`) ya tolera esa forma sin cambios: un heatmap con una sola celda encendida en vez de varias, un PV que se dibuja igual. Cero ramas nuevas en esos archivos.

## Comportamiento al reabrir

`ReadyAnalyzeView` (`AnalyzeView.tsx`) recibe el árbol YA reconstruido con su `AnalysisStore` sembrado (vía el `onNodeData` de `importSgf`) **antes** de que el `useEffect` de montaje llame a `review.start(...)`. `GameReview.analyzeTarget` hoy salta un nodo si `store.has(node.id)` — pasa a saltar solo si **además** el análisis cacheado tiene `visits >= this.deps.visits` (la cantidad que pide la velocidad de análisis actual). Si el usuario subió su preferencia de velocidad desde la última vez, esa jugada puntual se re-analiza (mejora la calidad); si no, se ahorra por completo.

Aplica igual a los tres caminos que hoy construyen un árbol desde SGF: import de archivo (`SgfPicker.handleFile`), reapertura desde "Mis partidas" (`computeInitialAnalyzeState`, Fase 5 Task 6), y — trivialmente, sin cambios — "empezar desde cero" (árbol vacío, sin nodos que sembrar).

## Manejo de errores

Un nodo con propiedades `TG*` corruptas o incompletas (p.ej. `TGW` sin `TGS`) se trata como "sin análisis cacheado" para ese nodo — `decodeAnalysisFromNodeData` devuelve `null`, el review lo vuelve a encolar normalmente. Nunca lanza, mismo criterio que el resto de `importSgf`/`loadGame`.

## Testing / verificación

- **Dominio (tests nuevos):** `analysis/sgfAnalysisCodec.ts` es lógica pura — round-trip `encodeAnalysisForNode`→`decodeAnalysisFromNodeData` (incluye: candidata con pase → sin `TGV`/`TGP`; `moves: []` → sin `TGV`/`TGP`; datos corruptos/incompletos → `null`). Ampliar `game/sgf.test.ts` con el nuevo parámetro opcional de `exportSgf`/`importSgf` (round-trip de un árbol CON variaciones, cada rama con su propio `getExtraData`, confirmando que cada nodo recupera exactamente lo suyo — no el de su hermano).
- **UI:** sin tests de componente (convención ya establecida en este proyecto) — verificación manual: analizar una partida con variaciones, exportar, reabrir el archivo, confirmar que el gráfico de winrate y el review aparecen SIN el spinner de re-análisis, y que analizar una variación que ya tenía candidata top sigue mostrando su PV.

## Decisiones tomadas en el brainstorm (resumen)

1. **Solo winrate+score+top-PV por nodo** — alcanza para el dolor real (evitar re-analizar toda la partida); el heatmap completo por nodo no vale su peso.
2. **Se guarda siempre al exportar, sin distinción "limpio"/"con análisis"** — un solo botón, un solo camino de guardado en la nube.
3. **Formato propio, sin JSON** — reusa la codificación de vértices de 2 letras ya existente.
4. **`game/sgf.ts` no conoce `Analysis`** — gancho genérico por nodo; la lógica de análisis vive en `analysis/`, misma dirección de dependencia que ya tiene el resto del código.
5. **Re-análisis condicionado a visitas** — un análisis cacheado con menos visitas que la velocidad actual se mejora, no se queda pobre para siempre.

## Fuera de alcance (recordatorio, no re-litigar en el plan)

Persistir todas las candidatas del motor (heatmap completo por nodo), persistir `ownership`, invalidación de análisis stale tras editar una variación, cualquier UI nueva (checkbox, botón de "exportar sin análisis") — todas quedan fuera; si en el futuro se necesitan, son su propio ciclo brainstorm→spec.
