# Análisis Persistido en el SGF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir en el SGF el análisis del motor ya calculado (winrate/score/visitas por posición + la variación principal sugerida) para que reabrir una partida analizada no dispare un review completo desde cero.

**Architecture:** `game/sgf.ts` gana un gancho genérico opcional por nodo (no sabe qué es un "análisis"); un módulo nuevo `analysis/sgfAnalysisCodec.ts` (dominio puro) convierte `Analysis`↔propiedades SGF propias sin JSON; `GameReview` se vuelve consciente de visitas al decidir qué saltar/pisar; `AnalyzeView.tsx` siembra un `AnalysisStore` fresco desde lo persistido antes de arrancar el review.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Vitest, Preact. Sin dependencias nuevas.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-15-analisis-persistido-sgf-design.md` (aprobado).
- Formato **sin JSON**: reusa `vertexToSgf`/`sgfToVertex` (`game/sgf.ts`) — vértices concatenados de a 2 letras, sin separador.
- Se persiste **solo**: `winrate`/`scoreLead`/`visits` a nivel raíz de la posición + vértice y `pv` completo de la candidata con más visitas. **Nunca** las demás candidatas (heatmap completo) ni `ownership` — confirmado que ningún archivo de `apps/web` lee `ownership` hoy.
- **Simplificación respecto al spec** (detectada al planificar, no cambia nada observable): el spec listaba `TGV` (vértice top) como propiedad separada de `TGP` (secuencia); es redundante — el primer vértice de `TGP` ES la propia candidata top. Esta versión usa solo `TGP`, sin `TGV`. Un `TGP` de un solo vértice (candidata sin continuación) es un caso válido.
- `game/sgf.ts` **no importa** `Analysis`/`AnalysisStore` — recibe/emite callbacks genéricos `Record<string, string[]>`. La lógica de qué significan esas propiedades vive en `analysis/sgfAnalysisCodec.ts`.
- Sin UI nueva. Se guarda siempre que se exporta (botón "Exportar SGF" y `cloudSnapshot()` de la nube); se restaura siempre que se importa (archivo local, reapertura desde "Mis partidas"). "Empezar desde cero" no tiene nada que sembrar (árbol vacío).
- Este proyecto no tiene tests de componente Preact — los cambios en `AnalyzeView.tsx` (Task 4) se verifican manualmente en navegador.
- Todos los cambios son **aditivos**: cualquier caller que no pase el nuevo parámetro opcional (`game/persistence.ts`, `PlayView.tsx` — Modo Jugar, sin concepto de análisis) sigue funcionando exactamente igual.

---

### Task 1: `game/sgf.ts` — gancho genérico de datos extra por nodo

**Files:**
- Modify: `apps/web/src/game/sgf.ts`
- Test: `apps/web/tests/sgf.test.ts`

**Interfaces:**
- Consumes: `GameNode`, `GameTree` (`game/gameTree.ts`, sin cambios).
- Produces: `exportSgf(tree: GameTree, getExtraData?: (node: GameNode) => Record<string, string[]> | undefined): string` y `importSgf(source: string, onNodeData?: (node: GameNode, data: Record<string, string[]>) => void): GameTree` — ambas con el segundo parámetro OPCIONAL. Task 2 no depende de esto (es un módulo independiente); Task 4 consume ambas firmas.

- [ ] **Step 1: Extender `toSgfNode` y `exportSgf` con `getExtraData`**

En `apps/web/src/game/sgf.ts`, reemplazar:

```ts
/** Construye el SgfNode de un GameNode y sus descendientes. `extraRootData` sólo aplica a la raíz. */
function toSgfNode(node: GameNode, extraRootData?: Record<string, string[]>): SgfNode {
  const data: Record<string, string[]> = node.move ? moveToData(node.move) : { ...extraRootData }
  return {
    id: node.id,
    data,
    parentId: node.parent ? node.parent.id : null,
    children: node.children.map((child) => toSgfNode(child)),
  }
}

/**
 * Serializa el árbol completo a SGF. Orden de propiedades de la raíz FIJO (idempotencia):
 * GM, FF, SZ, KM, RU, [HA, AB], [RE]. `stringify([root])` envuelve el juego en `(;...)`.
 */
export function exportSgf(tree: GameTree): string {
  const { boardSize, komi, rules, handicap, result } = tree.meta
  // Orden de inserción = orden de emisión de stringify (itera `for id in data`): mantenerlo estable.
  const rootData: Record<string, string[]> = {
    GM: ['1'],
    FF: ['4'],
    SZ: [String(boardSize)],
    KM: [String(komi)],
    RU: [rulesToSgf(rules)],
  }
  if (handicap >= 2) {
    rootData.HA = [String(handicap)]
    rootData.AB = handicapVertices(boardSize, handicap).map(([x, y]) => vertexToSgf({ x, y }))
  }
  if (result !== undefined) rootData.RE = [result]

  return sgf.stringify([toSgfNode(tree.root, rootData)])
}
```

por:

```ts
/** Callback opcional: datos extra a fusionar en la propiedades SGF de UN nodo (p.ej. análisis
 * cacheado — ver `analysis/sgfAnalysisCodec.ts`). `undefined` = sin datos extra para ese nodo. */
type ExtraDataGetter = (node: GameNode) => Record<string, string[]> | undefined

/** Construye el SgfNode de un GameNode y sus descendientes. `extraRootData` sólo aplica a la raíz;
 * `getExtraData` se consulta para CUALQUIER nodo (incluida la raíz, fusionado DESPUÉS del resto —
 * nunca pisa GM/FF/SZ/.../B/W, que van primero por orden de inserción). */
function toSgfNode(node: GameNode, getExtraData?: ExtraDataGetter, extraRootData?: Record<string, string[]>): SgfNode {
  const data: Record<string, string[]> = node.move ? moveToData(node.move) : { ...extraRootData }
  const extra = getExtraData?.(node)
  if (extra) Object.assign(data, extra)
  return {
    id: node.id,
    data,
    parentId: node.parent ? node.parent.id : null,
    children: node.children.map((child) => toSgfNode(child, getExtraData)),
  }
}

/**
 * Serializa el árbol completo a SGF. Orden de propiedades de la raíz FIJO (idempotencia):
 * GM, FF, SZ, KM, RU, [HA, AB], [RE], [getExtraData]. `stringify([root])` envuelve el juego en `(;...)`.
 *
 * `getExtraData` (opcional): por cada nodo, propiedades adicionales a fusionar — el árbol NO sabe
 * qué significan (p.ej. análisis del motor cacheado); es el mecanismo genérico que usa Fase 6 sin
 * que este archivo importe `Analysis`/`AnalysisStore`. Sin este argumento, comportamiento IDÉNTICO
 * a antes (todos los callers existentes — `game/persistence.ts`, `PlayView.tsx` — no lo pasan).
 */
export function exportSgf(tree: GameTree, getExtraData?: ExtraDataGetter): string {
  const { boardSize, komi, rules, handicap, result } = tree.meta
  // Orden de inserción = orden de emisión de stringify (itera `for id in data`): mantenerlo estable.
  const rootData: Record<string, string[]> = {
    GM: ['1'],
    FF: ['4'],
    SZ: [String(boardSize)],
    KM: [String(komi)],
    RU: [rulesToSgf(rules)],
  }
  if (handicap >= 2) {
    rootData.HA = [String(handicap)]
    rootData.AB = handicapVertices(boardSize, handicap).map(([x, y]) => vertexToSgf({ x, y }))
  }
  if (result !== undefined) rootData.RE = [result]

  return sgf.stringify([toSgfNode(tree.root, getExtraData, rootData)])
}
```

- [ ] **Step 2: Extender `importSgf` con `onNodeData`**

Reemplazar:

```ts
/**
 * Parsea SGF a un GameTree. Asume el formato que produce `exportSgf` (game-info en la raíz). Mapea
 * SZ/KM/RU/HA/RE; los AB del raíz se IGNORAN (handicap ya en HA). Lanza si el SGF es inválido (el
 * caller de persistencia lo envuelve en try/catch). El cursor queda en la raíz.
 */
export function importSgf(source: string): GameTree {
  const roots = sgf.parse(source)
  const root = roots[0]
  if (!root) throw new Error('SGF sin nodo raíz')

  const { data } = root
  const boardSize = asBoardSize(parseInt(data.SZ?.[0] ?? '19', 10))
  const komiRaw = parseFloat(data.KM?.[0] ?? '0')
  const komi = Number.isFinite(komiRaw) ? komiRaw : 0
  const rules = sgfToRules(data.RU?.[0] ?? 'Chinese')
  const handicapRaw = parseInt(data.HA?.[0] ?? '0', 10)
  const handicapParsed = Number.isFinite(handicapRaw) ? handicapRaw : 0
  const handicap = handicapParsed === 1 ? 0 : handicapParsed

  const meta = { boardSize, komi, rules, handicap } as const
  const tree = new GameTree(data.RE?.[0] !== undefined ? { ...meta, result: data.RE[0] } : meta)

  // Los hijos de la raíz son las jugadas (la raíz sólo lleva game-info + AB, que se ignoran).
  const attach = (sgfNode: SgfNode, parent: GameNode): void => {
    for (const child of sgfNode.children) {
      const move = moveFromData(child.data, boardSize)
      if (move) {
        attach(child, tree.appendChild(parent, move))
      } else {
        // Nodo sin jugada (raro en nuestro formato): transparente, cuelga sus hijos del mismo padre.
        attach(child, parent)
      }
    }
  }
  attach(root, tree.root)

  return tree
}
```

por:

```ts
/**
 * Parsea SGF a un GameTree. Asume el formato que produce `exportSgf` (game-info en la raíz). Mapea
 * SZ/KM/RU/HA/RE; los AB del raíz se IGNORAN (handicap ya en HA). Lanza si el SGF es inválido (el
 * caller de persistencia lo envuelve en try/catch). El cursor queda en la raíz.
 *
 * `onNodeData` (opcional): se invoca UNA vez por cada `GameNode` creado (incluida la raíz, PRIMERO)
 * con ese nodo (ya con `.id` asignado) y el `data` crudo parseado de su nodo SGF — el mecanismo
 * simétrico de `getExtraData` en `exportSgf`. NO se invoca para un "nodo sin jugada" transparente
 * (no crea un `GameNode` propio). Sin este argumento, comportamiento IDÉNTICO a antes.
 */
export function importSgf(
  source: string,
  onNodeData?: (node: GameNode, data: Record<string, string[]>) => void,
): GameTree {
  const roots = sgf.parse(source)
  const root = roots[0]
  if (!root) throw new Error('SGF sin nodo raíz')

  const { data } = root
  const boardSize = asBoardSize(parseInt(data.SZ?.[0] ?? '19', 10))
  const komiRaw = parseFloat(data.KM?.[0] ?? '0')
  const komi = Number.isFinite(komiRaw) ? komiRaw : 0
  const rules = sgfToRules(data.RU?.[0] ?? 'Chinese')
  const handicapRaw = parseInt(data.HA?.[0] ?? '0', 10)
  const handicapParsed = Number.isFinite(handicapRaw) ? handicapRaw : 0
  const handicap = handicapParsed === 1 ? 0 : handicapParsed

  const meta = { boardSize, komi, rules, handicap } as const
  const tree = new GameTree(data.RE?.[0] !== undefined ? { ...meta, result: data.RE[0] } : meta)
  onNodeData?.(tree.root, data)

  // Los hijos de la raíz son las jugadas (la raíz sólo lleva game-info + AB, que se ignoran).
  const attach = (sgfNode: SgfNode, parent: GameNode): void => {
    for (const child of sgfNode.children) {
      const move = moveFromData(child.data, boardSize)
      if (move) {
        const node = tree.appendChild(parent, move)
        onNodeData?.(node, child.data)
        attach(child, node)
      } else {
        // Nodo sin jugada (raro en nuestro formato): transparente, cuelga sus hijos del mismo padre.
        attach(child, parent)
      }
    }
  }
  attach(root, tree.root)

  return tree
}
```

- [ ] **Step 3: Tests nuevos en `apps/web/tests/sgf.test.ts`**

Agregar al final del archivo (antes del último `})` de cierre, como bloque `describe` nuevo):

```ts
describe('exportSgf/importSgf — gancho genérico de datos extra por nodo (Fase 6, análisis persistido)', () => {
  it('exportSgf: getExtraData mergea propiedades en el nodo correspondiente, sin pisar B/W', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    const n1 = t.addMove(B(2, 2))
    const out = exportSgf(t, (node) => (node.id === n1.id ? { XX: ['hola'] } : undefined))
    expect(out).toContain('B[cc]')
    expect(out).toContain('XX[hola]')
  })

  it('exportSgf: la raíz también puede llevar datos extra, junto al game-info', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    const out = exportSgf(t, (node) => (node.id === t.root.id ? { XX: ['raiz'] } : undefined))
    expect(out).toContain('GM[1]')
    expect(out).toContain('XX[raiz]')
  })

  it('exportSgf: cada rama de una variación recibe SU PROPIO dato extra, sin mezclarse con su hermana', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(2, 2))
    const mainBranch = t.addMove(W(6, 6))
    t.toRoot()
    t.toChild(0)
    const variationBranch = t.addMove(W(4, 4)) // segunda rama de W desde B(2,2)

    const out = exportSgf(t, (node) => {
      if (node.id === mainBranch.id) return { XX: ['principal'] }
      if (node.id === variationBranch.id) return { XX: ['variacion'] }
      return undefined
    })
    const parsedRoot = sgf.parse(out)[0]!
    const b22 = parsedRoot.children[0]!
    expect(b22.children).toHaveLength(2)
    expect(b22.children[0]!.data.XX).toEqual(['principal'])
    expect(b22.children[1]!.data.XX).toEqual(['variacion'])
  })

  it('importSgf: onNodeData se invoca por cada nodo creado (incluida la raíz, primero) con su data cruda', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(2, 2))
    const out = exportSgf(t, (node) => (node.id === t.root.id ? { XX: ['raiz'] } : { XX: ['jugada'] }))

    const seen: { xx: string[] | undefined }[] = []
    importSgf(out, (_node, data) => seen.push({ xx: data.XX }))

    expect(seen).toHaveLength(2) // raíz + 1 jugada
    expect(seen[0]!.xx).toEqual(['raiz'])
    expect(seen[1]!.xx).toEqual(['jugada'])
  })

  it('sin callback (llamado como antes), exportSgf/importSgf se comportan exactamente igual (regresión)', () => {
    const t = new GameTree({ boardSize: 9, komi: 6.5, rules: 'chinese', handicap: 0 })
    t.addMove(B(2, 2))
    t.addMove(W(6, 6))
    const out = exportSgf(t)
    const t2 = importSgf(out)
    expect(exportSgf(t2)).toBe(out)
  })
})
```

- [ ] **Step 4: Correr los tests**

Run: `npm test -w @tengen/web -- sgf.test.ts`
Expected: todos los tests existentes (idempotencia, handicap, pase legacy `tt`, HA[1]) siguen en verde, más los 5 nuevos — sin regresión.

- [ ] **Step 5: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/game/sgf.ts apps/web/tests/sgf.test.ts
git commit -m "feat(web): gancho generico de datos extra por nodo en exportSgf/importSgf

game/sgf.ts sigue sin saber que es un analisis: getExtraData/onNodeData son
callbacks genericos Record<string,string[]> por nodo, incluida la raiz.
Cambio 100% aditivo (parametro opcional) - los callers existentes sin
concepto de analisis (persistence.ts, PlayView.tsx) no cambian.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `analysis/sgfAnalysisCodec.ts` — encode/decode puro

**Files:**
- Create: `apps/web/src/analysis/sgfAnalysisCodec.ts`
- Test: `apps/web/tests/sgfAnalysisCodec.test.ts`

**Interfaces:**
- Consumes: `Analysis`, `MoveAnalysis`, `Vertex` (`@tengen/engine`, sin cambios); `vertexToSgf`, `sgfToVertex` (`game/sgf.ts`, ya exportadas).
- Produces: `encodeAnalysisForNode(analysis: Analysis): Record<string, string[]>` y `decodeAnalysisFromNodeData(data: Record<string, string[]>): Analysis | null`. Task 4 consume ambas.

Independiente de Task 1 (no depende de los cambios ahí, solo de lo que `game/sgf.ts` YA exportaba: `vertexToSgf`/`sgfToVertex`) — puede hacerse en paralelo, se plantea después por orden de lectura.

- [ ] **Step 1: Crear `apps/web/src/analysis/sgfAnalysisCodec.ts`**

```ts
// Convierte un `Analysis` cacheado (AnalysisStore) a/desde propiedades SGF propias de tengen —
// puente entre `game/sgf.ts` (dominio puro, no sabe qué es un "análisis") y el cache de análisis
// (Fase 6, spec 2026-07-15-analisis-persistido-sgf-design.md). Sin JSON: reusa la codificación de
// vértices de 2 letras que ya usa `vertexToSgf`/`sgfToVertex` — evita el escapeo que exigiría
// embeber JSON en el valor de una propiedad SGF (game/sgf.ts no lo maneja hoy).
//
// Solo se persiste winrate/scoreLead/visits a nivel raíz + la candidata más visitada (vértice +
// su pv completo, concatenados en UNA sola propiedad — el primer vértice de la secuencia ES la
// propia candidata) — NO las demás candidatas (arman el heatmap completo, que solo hace falta para
// la posición que se está mirando en ese momento; ver spec §Alcance) ni `ownership` (sin uso hoy).
import type { Analysis, MoveAnalysis, Vertex } from '@tengen/engine'
import { sgfToVertex, vertexToSgf } from '../game/sgf'

const WINRATE_PROP = 'TGW'
const SCORE_PROP = 'TGS'
const VISITS_PROP = 'TGN'
// Primer vértice = la propia candidata top; el resto = su continuación (`MoveAnalysis.pv`).
const TOP_PV_PROP = 'TGP'

/** "Candidata con más visitas" — mismo criterio que ya usa `AnalyzeView.tsx` para elegir `topMove`
 * (`reduce` por visitas, sin asumir `analysis.moves` pre-ordenado por el motor). */
function topCandidate(analysis: Analysis): MoveAnalysis | undefined {
  if (analysis.moves.length === 0) return undefined
  return analysis.moves.reduce((best, m) => (m.visits > best.visits ? m : best), analysis.moves[0]!)
}

/** Trunca en el primer pase o vértice fuera de tablero (mismo criterio que YA aplica
 * `buildPvSequence`/`overlays.ts` al DIBUJAR el pv) — nunca se inventa una codificación de "pase"
 * dentro de la secuencia concatenada. */
function truncateAtPass(sequence: Vertex[]): { x: number; y: number }[] {
  const usable: { x: number; y: number }[] = []
  for (const v of sequence) {
    if (v === 'pass') break
    usable.push(v)
  }
  return usable
}

/** Arma las propiedades SGF para un `Analysis` cacheado. Siempre incluye winrate/scoreLead/visits;
 * la secuencia (`TGP`) se omite si no hay candidata, o si la candidata top es un pase. */
export function encodeAnalysisForNode(analysis: Analysis): Record<string, string[]> {
  const data: Record<string, string[]> = {
    [WINRATE_PROP]: [analysis.winrate.toFixed(4)],
    [SCORE_PROP]: [analysis.scoreLead.toFixed(2)],
    [VISITS_PROP]: [String(analysis.visits)],
  }
  const top = topCandidate(analysis)
  if (top) {
    const sequence = truncateAtPass([top.vertex, ...top.pv])
    if (sequence.length > 0) {
      data[TOP_PV_PROP] = [sequence.map((v) => vertexToSgf(v)).join('')]
    }
  }
  return data
}

/**
 * Reconstruye un `Analysis` "degradado" (cero o un candidato en `moves`) desde las propiedades
 * leídas de un nodo SGF. `null` si el nodo no tenía winrate/scoreLead/visits válidos (nunca se
 * analizó, o datos corruptos/incompletos) — nunca lanza.
 */
export function decodeAnalysisFromNodeData(data: Record<string, string[]>): Analysis | null {
  const winrate = parseFloat(data[WINRATE_PROP]?.[0] ?? '')
  const scoreLead = parseFloat(data[SCORE_PROP]?.[0] ?? '')
  const visits = parseInt(data[VISITS_PROP]?.[0] ?? '', 10)
  if (!Number.isFinite(winrate) || !Number.isFinite(scoreLead) || !Number.isFinite(visits)) return null

  const moves: MoveAnalysis[] = []
  const pvRaw = data[TOP_PV_PROP]?.[0]
  if (pvRaw !== undefined && pvRaw.length >= 2 && pvRaw.length % 2 === 0) {
    const vertices: Vertex[] = []
    for (let i = 0; i < pvRaw.length; i += 2) vertices.push(sgfToVertex(pvRaw.slice(i, i + 2)))
    const [vertex, ...pv] = vertices
    moves.push({ vertex: vertex!, visits, winrate, scoreLead, prior: 0, pv })
  }

  return { winrate, scoreLead, scoreStdev: 0, visits, moves }
}
```

- [ ] **Step 2: Escribir `apps/web/tests/sgfAnalysisCodec.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { Analysis, MoveAnalysis } from '@tengen/engine'
import { decodeAnalysisFromNodeData, encodeAnalysisForNode } from '../src/analysis/sgfAnalysisCodec'

function mkMove(overrides: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return { vertex: { x: 4, y: 4 }, visits: 50, winrate: 0.5, scoreLead: 0, prior: 0.2, pv: [], ...overrides }
}

function mkAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return { winrate: 0.55, scoreLead: 2.5, scoreStdev: 3, visits: 100, moves: [], ...overrides }
}

describe('encodeAnalysisForNode / decodeAnalysisFromNodeData — round-trip', () => {
  it('un análisis con una candidata (con pv) round-tripea winrate/scoreLead/visits y la secuencia', () => {
    const top = mkMove({ vertex: { x: 4, y: 4 }, pv: [{ x: 2, y: 2 }, { x: 6, y: 6 }] })
    const analysis = mkAnalysis({ winrate: 0.6212, scoreLead: 3.45, visits: 100, moves: [top] })

    const data = encodeAnalysisForNode(analysis)
    const decoded = decodeAnalysisFromNodeData(data)

    expect(decoded).not.toBeNull()
    expect(decoded!.winrate).toBeCloseTo(0.6212, 4)
    expect(decoded!.scoreLead).toBeCloseTo(3.45, 2)
    expect(decoded!.visits).toBe(100)
    expect(decoded!.moves).toHaveLength(1)
    expect(decoded!.moves[0]!.vertex).toEqual({ x: 4, y: 4 })
    expect(decoded!.moves[0]!.pv).toEqual([{ x: 2, y: 2 }, { x: 6, y: 6 }])
  })

  it('"candidata con más visitas" se elige por reduce, no por orden del array', () => {
    const low = mkMove({ vertex: { x: 0, y: 0 }, visits: 10 })
    const high = mkMove({ vertex: { x: 8, y: 8 }, visits: 90 })
    const analysis = mkAnalysis({ moves: [low, high] }) // la de MÁS visitas va SEGUNDA en el array

    const decoded = decodeAnalysisFromNodeData(encodeAnalysisForNode(analysis))
    expect(decoded!.moves[0]!.vertex).toEqual({ x: 8, y: 8 }) // ganó la de 90 visitas, no la primera del array
  })

  it('sin candidatas (moves: []) → sin TGP, decode da moves: []', () => {
    const analysis = mkAnalysis({ moves: [] })
    const data = encodeAnalysisForNode(analysis)
    expect(data.TGP).toBeUndefined()
    const decoded = decodeAnalysisFromNodeData(data)
    expect(decoded!.moves).toEqual([])
  })

  it('candidata top con vertex="pass" → sin TGP (un pase no tiene casilla)', () => {
    const analysis = mkAnalysis({ moves: [mkMove({ vertex: 'pass', visits: 100 })] })
    const data = encodeAnalysisForNode(analysis)
    expect(data.TGP).toBeUndefined()
  })

  it('pv con un pase en medio se trunca en el primer pase (mismo criterio que buildPvSequence al dibujar)', () => {
    const top = mkMove({ vertex: { x: 4, y: 4 }, pv: [{ x: 2, y: 2 }, 'pass', { x: 6, y: 6 }] })
    const analysis = mkAnalysis({ moves: [top] })
    const decoded = decodeAnalysisFromNodeData(encodeAnalysisForNode(analysis))
    expect(decoded!.moves[0]!.pv).toEqual([{ x: 2, y: 2 }]) // corta ANTES del pase, nada después
  })

  it('un solo vértice (candidata sin continuación) es un TGP válido de 2 caracteres', () => {
    const analysis = mkAnalysis({ moves: [mkMove({ vertex: { x: 4, y: 4 }, pv: [] })] })
    const data = encodeAnalysisForNode(analysis)
    expect(data.TGP![0]).toHaveLength(2)
    const decoded = decodeAnalysisFromNodeData(data)
    expect(decoded!.moves[0]!.vertex).toEqual({ x: 4, y: 4 })
    expect(decoded!.moves[0]!.pv).toEqual([])
  })
})

describe('decodeAnalysisFromNodeData — datos corruptos o incompletos → null (nunca lanza)', () => {
  it('sin ninguna propiedad TG* → null', () => {
    expect(decodeAnalysisFromNodeData({})).toBeNull()
  })

  it('TGW presente pero TGS ausente → null', () => {
    expect(decodeAnalysisFromNodeData({ TGW: ['0.5'] })).toBeNull()
  })

  it('TGW con valor no numérico → null', () => {
    expect(decodeAnalysisFromNodeData({ TGW: ['no-es-numero'], TGS: ['1'], TGN: ['10'] })).toBeNull()
  })

  it('TGP con longitud impar (corrupto) → se ignora, pero winrate/scoreLead/visits SÍ se conservan', () => {
    const decoded = decodeAnalysisFromNodeData({ TGW: ['0.5'], TGS: ['1.0'], TGN: ['10'], TGP: ['abc'] })
    expect(decoded).not.toBeNull()
    expect(decoded!.moves).toEqual([])
  })
})
```

- [ ] **Step 3: Correr los tests**

Run: `npm test -w @tengen/web -- sgfAnalysisCodec.test.ts`
Expected: todos verdes.

- [ ] **Step 4: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/analysis/sgfAnalysisCodec.ts apps/web/tests/sgfAnalysisCodec.test.ts
git commit -m "feat(web): codec Analysis<->propiedades SGF (TGW/TGS/TGN/TGP)

Sin JSON: reusa vertexToSgf/sgfToVertex existente. Solo winrate/scoreLead/
visitas raiz + la candidata mas visitada (vertice+pv concatenados en TGP,
truncados en el primer pase). Analysis reconstruido tiene 0 o 1 candidato en
moves - compatible sin cambios con buildHeatMap/buildPvOverlay/nodeAnalysis.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `GameReview` — re-análisis condicionado a visitas

**Files:**
- Modify: `apps/web/src/analysis/gameReview.ts`
- Test: `apps/web/tests/gameReview.test.ts`

**Interfaces:**
- Consumes: `AnalysisStore.get(nodeId)`/`.has(nodeId)` (sin cambios de firma); `GameReview` constructor `{tree, store, scheduler, visits}` (sin cambios).
- Produces: mismo `GameReview` público (`start`, `progress`, `getLatestReport`, `dispose`) — comportamiento interno cambia, firmas no.

**Corrección de una interacción sutil, detectada al planificar (no estaba en el spec):** el guard de escritura de `analyzeTarget` hoy es `if (!store.has(node.id)) store.set(...)` — asume que "ya hay algo en el store" siempre implica "de calidad igual o mayor" (cierto HOY, porque lo único que puebla el store antes de que el review corra es un análisis interactivo, que SIEMPRE usa más visitas). Con esta fase, el store puede llegar sembrado desde el SGF con MENOS visitas que las pedidas — si no se actualiza este guard, el re-análisis (Step 1) correría igual pero su resultado NUNCA se guardaría (el guard lo descartaría en silencio). El fix generaliza el criterio: comparar visitas, no presencia.

- [ ] **Step 1: `start()` — el filtro de "qué encolar" pasa a comparar visitas, no solo presencia**

En `apps/web/src/analysis/gameReview.ts`, reemplazar:

```ts
  start(onReport: (report: GameReport) => void, startedAtMsOverride?: number): Promise<void> {
    this.startedAtMs = startedAtMsOverride ?? Date.now()
    const { tree, store } = this.deps

    const targets: TengenGameNode[] = [tree.root, ...tree.mainLine()]
    this.targetNodeIds = targets.map((node) => node.id)

    const pending = targets
      .filter((node) => !store.has(node.id))
      .map((node) => this.analyzeTarget(node, onReport))
```

por:

```ts
  start(onReport: (report: GameReport) => void, startedAtMsOverride?: number): Promise<void> {
    this.startedAtMs = startedAtMsOverride ?? Date.now()
    const { tree, store, visits } = this.deps

    const targets: TengenGameNode[] = [tree.root, ...tree.mainLine()]
    this.targetNodeIds = targets.map((node) => node.id)

    // Fase 6 (análisis persistido en SGF): un nodo sembrado desde el archivo con MENOS visitas que
    // las que pide esta sesión SÍ se re-encola (mejora la calidad); con visitas suficientes, se
    // salta igual que antes (evita el re-análisis completo que motivó esta fase).
    const pending = targets
      .filter((node) => {
        const cached = store.get(node.id)
        return !cached || cached.visits < visits
      })
      .map((node) => this.analyzeTarget(node, onReport))
```

- [ ] **Step 2: `analyzeTarget` — el guard de escritura pasa a comparar visitas**

Reemplazar el comentario y el guard dentro del handler de éxito de `analyzeTarget`:

```ts
          (analysis) => {
            // Guard deliberado (Fase 3a, fix-wave del review final, Finding 1): un análisis
            // interactivo ("Analizar esta posición", AnalyzeView.tsx `handleAnalyzeClick`) puede
            // haber escrito YA en `store` para este mismo nodo mientras este job de review estaba en
            // vuelo — el review encola TODO al montar, así que un usuario que analiza a mano una
            // posición antes de que le toque su turno en la cola de fondo es el caso común, no el
            // raro. El review SIEMPRE corre con menos visitas (`REVIEW_VISITS`) que un análisis
            // interactivo (`INTERACTIVE_VISITS`), así que si `store` YA tiene algo para este nodo,
            // es de mayor calidad o igual de fresco — nunca pisarlo. `handleAnalyzeClick` hace lo
            // simétrico-inverso a propósito (escribe SIEMPRE, sin este guard): una petición
            // interactiva fresca debe ganarle a cualquier resultado de review ya cacheado, sin
            // importar el orden de llegada.
            if (!this.deps.store.has(node.id)) this.deps.store.set(node.id, analysis)
            this.recomputeAndReport(onReport)
          },
```

por:

```ts
          (analysis) => {
            // Guard deliberado (Fase 3a, fix-wave del review final, Finding 1; generalizado en
            // Fase 6 a comparar VISITAS en vez de solo presencia). Motivos por los que `store` puede
            // tener YA algo para este nodo cuando este job se asienta:
            //   (a) un análisis interactivo ("Analizar esta posición") con más visitas que el review.
            //   (b) un análisis sembrado desde el SGF (Fase 6) con MENOS visitas que este review —
            //       ese es justo el caso que Step 1 vuelve a encolar; si no se guarda el resultado
            //       nuevo, el re-análisis correría en vano (nunca mejora lo mostrado).
            // Comparar por visitas cubre ambos: nunca pisar algo de igual o mayor calidad, pero SÍ
            // reemplazar algo de menor calidad — sin importar de dónde vino (interactivo o sembrado).
            const cached = this.deps.store.get(node.id)
            if (!cached || cached.visits < analysis.visits) this.deps.store.set(node.id, analysis)
            this.recomputeAndReport(onReport)
          },
```

- [ ] **Step 3: Tests nuevos en `apps/web/tests/gameReview.test.ts`**

Agregar al final del archivo (después del bloque "── 8. Finding 1 ..."), como dos `describe` nuevos:

```ts
// ── 9. Fase 6: un nodo sembrado con MENOS visitas que las pedidas se re-analiza y se actualiza ──

describe('GameReview — Fase 6: nodo sembrado con menos visitas se re-analiza y el resultado nuevo reemplaza al sembrado', () => {
  it('re-encola y sobreescribe un análisis sembrado con menos visitas que `deps.visits`', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2)) // targets = [raíz, jugada1]

    // Sembrado (p.ej. desde un SGF reabierto) con 10 visitas — MENOS que lo que este review pide (VISITS=50).
    store.set(tree.root.id, mkAnalysis({ visits: 10, scoreLead: 0, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))
    const m1 = tree.mainLine()[0]!
    store.set(m1.id, mkAnalysis({ visits: 10, scoreLead: 1, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })

    engine.programNext({ chunks: [mkAnalysis({ visits: VISITS, scoreLead: 9, moves: [mkMoveAnalysis({ x: 8, y: 8 })] })] }) // raíz, mejora
    engine.programNext({ chunks: [mkAnalysis({ visits: VISITS, scoreLead: 7, moves: [mkMoveAnalysis({ x: 8, y: 8 })] })] }) // jugada1, mejora

    await review.start(() => {})

    expect(engine.calls).toHaveLength(2) // SÍ se re-analizaron (no se saltaron)
    expect(store.get(tree.root.id)!.visits).toBe(VISITS)
    expect(store.get(tree.root.id)!.scoreLead).toBe(9) // el sembrado (scoreLead=0) fue reemplazado
    expect(store.get(m1.id)!.visits).toBe(VISITS)
    expect(store.get(m1.id)!.scoreLead).toBe(7)
  })
})

// ── 10. Fase 6: un nodo sembrado con visitas SUFICIENTES no se re-encola ─────────────────────

describe('GameReview — Fase 6: nodo sembrado con visitas suficientes NO se re-encola (objetivo central de esta fase)', () => {
  it('con todo el store sembrado a MÁS visitas de las pedidas, start() no llama al motor ni una vez', async () => {
    const { mgr, engine } = await makeReadyHarness()
    const scheduler = new ReviewScheduler(mgr)
    const store = new AnalysisStore()
    const tree = tree9()
    tree.addMove(B(2, 2))
    tree.addMove(W(6, 6))

    const [m1, m2] = tree.mainLine()
    store.set(tree.root.id, mkAnalysis({ visits: VISITS + 50, scoreLead: 0, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))
    store.set(m1!.id, mkAnalysis({ visits: VISITS + 50, scoreLead: 1, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))
    store.set(m2!.id, mkAnalysis({ visits: VISITS + 50, scoreLead: 2, moves: [mkMoveAnalysis({ x: 8, y: 8 })] }))

    const review = new GameReview({ tree, store, scheduler, visits: VISITS })
    const reports: ReturnType<typeof review.getLatestReport>[] = []

    await review.start((report) => reports.push(report))

    expect(engine.calls).toHaveLength(0) // cero re-análisis: el objetivo central de esta fase
    expect(reports[0]!.moveEntries).toHaveLength(2)
    const p = review.progress(1000)!
    expect(p.countLabel).toBe('3/3')
  })
})
```

- [ ] **Step 4: Correr TODOS los tests de `gameReview.test.ts` (los 8 existentes + los 2 nuevos)**

Run: `npm test -w @tengen/web -- gameReview.test.ts`
Expected: 10 tests, todos verdes — en particular, los 8 existentes NO se modifican y siguen pasando (confirmado al planificar: sus mocks usan la MISMA constante `VISITS` para cache y request, así que `cached.visits < visits` da `false` en los mismos casos donde antes daba `!store.has(...)` false — comportamiento idéntico para esos escenarios).

- [ ] **Step 5: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/analysis/gameReview.ts apps/web/tests/gameReview.test.ts
git commit -m "fix(web): GameReview compara visitas, no solo presencia, al saltar/pisar

Un nodo sembrado desde un SGF persistido (Fase 6) puede tener MENOS visitas
que las pedidas por la velocidad de analisis actual - start() ahora lo
re-encola en ese caso, y el guard de escritura de analyzeTarget (que antes
descartaba en silencio cualquier resultado si el store YA tenia algo) ahora
compara visitas: nunca pisa algo de igual o mayor calidad, pero SI reemplaza
algo de menor calidad sin importar si vino de un click interactivo o de un
SGF reabierto. Los 8 tests existentes no cambian (sus mocks reusan la misma
constante VISITS para cache y request, mismo resultado que antes).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `AnalyzeView.tsx` — sembrar/exportar el análisis + verificación manual

**Files:**
- Modify: `apps/web/src/ui/AnalyzeView.tsx`

**Interfaces:**
- Consumes: `exportSgf`/`importSgf` (Task 1), `encodeAnalysisForNode`/`decodeAnalysisFromNodeData` (Task 2), `AnalysisStore.set` (sin cambios).
- Produces: nada para otras tasks — última del plan.

- [ ] **Step 1: Import nuevo y tipo `Analysis`**

En `apps/web/src/ui/AnalyzeView.tsx`, en el bloque de imports, cambiar:

```ts
import type { BoardSize, NetworkId, Vertex as TengenVertex } from '@tengen/engine'
```

por:

```ts
import type { Analysis, BoardSize, NetworkId, Vertex as TengenVertex } from '@tengen/engine'
```

Y agregar, junto a los demás imports de `../cloud/...`/`../game/...`:

```ts
import { decodeAnalysisFromNodeData, encodeAnalysisForNode } from '../analysis/sgfAnalysisCodec'
```

- [ ] **Step 2: `computeInitialAnalyzeState` siembra `analysisSeed` al reabrir desde "Mis partidas"**

Reemplazar:

```ts
interface InitialAnalyzeState {
  tree: GameTree | null
  gameId?: string
}

/** Consume `takePendingOpen('analizar')` UNA sola vez (take-once — no puede recalcularse en cada
 * render): si hay una partida pendiente de reabrir y su SGF es válido, arranca directo en ella,
 * saltando `SgfPicker`. SGF corrupto → cae al picker como si no hubiera pendingOpen (nunca deja la
 * SPA en blanco; mismo espíritu que el ErrorBoundary de main.tsx). */
function computeInitialAnalyzeState(): InitialAnalyzeState {
  const pendingGame = takePendingOpen('analizar')
  if (!pendingGame) return { tree: null }
  try {
    const tree = importSgf(pendingGame.sgf)
    // Mismo criterio que SgfPicker/PlayView import: cursor en el tip de la línea principal (D1 no
    // guarda el cursor exacto, solo el SGF).
    while (tree.toChild(0)) {
      /* avanza hasta el tip */
    }
    return { tree, gameId: pendingGame.id }
  } catch {
    return { tree: null }
  }
}
```

por:

```ts
interface InitialAnalyzeState {
  tree: GameTree | null
  gameId?: string
  /** Análisis persistido en el SGF (Fase 6) — sembrará un `AnalysisStore` fresco en `ReadyAnalyzeView`
   * ANTES de que arranque el review, evitando re-analizar lo que ya viene con visitas suficientes. */
  analysisSeed?: Map<number, Analysis>
}

/** Consume `takePendingOpen('analizar')` UNA sola vez (take-once — no puede recalcularse en cada
 * render): si hay una partida pendiente de reabrir y su SGF es válido, arranca directo en ella,
 * saltando `SgfPicker`. SGF corrupto → cae al picker como si no hubiera pendingOpen (nunca deja la
 * SPA en blanco; mismo espíritu que el ErrorBoundary de main.tsx). */
function computeInitialAnalyzeState(): InitialAnalyzeState {
  const pendingGame = takePendingOpen('analizar')
  if (!pendingGame) return { tree: null }
  try {
    const analysisSeed = new Map<number, Analysis>()
    const tree = importSgf(pendingGame.sgf, (node, data) => {
      const decoded = decodeAnalysisFromNodeData(data)
      if (decoded) analysisSeed.set(node.id, decoded)
    })
    // Mismo criterio que SgfPicker/PlayView import: cursor en el tip de la línea principal (D1 no
    // guarda el cursor exacto, solo el SGF).
    while (tree.toChild(0)) {
      /* avanza hasta el tip */
    }
    return { tree, gameId: pendingGame.id, analysisSeed }
  } catch {
    return { tree: null }
  }
}
```

- [ ] **Step 3: `AnalyzeView` — estado `analysisSeed` + wiring de `handleLoadFile`/`handleLoadAnother`/render**

Reemplazar:

```ts
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

por:

```ts
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
  // Análisis persistido en el SGF (Fase 6): sembrado al reabrir vía pendingOpen o al importar un
  // archivo con propiedades TGW/TGS/TGN/TGP. `undefined` en "empezar desde cero" (árbol vacío) y
  // tras "Elegir otra partida".
  const [analysisSeed, setAnalysisSeed] = useState<Map<number, Analysis> | undefined>(
    initialRef.current.analysisSeed,
  )
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
    setAnalysisSeed(undefined)
  }

  function handleLoadFile(loaded: GameTree, seed: Map<number, Analysis>): void {
    setTree(loaded)
    setStartEditing(false)
    setAnalysisSeed(seed)
  }

  function handleStartFromScratch(boardSize: BoardSize): void {
    setTree(emptyAnalyzeTree(boardSize))
    setStartEditing(true)
    setAnalysisSeed(undefined)
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
        analysisSeed={analysisSeed}
        onBack={onBack}
        onLoadAnother={handleLoadAnother}
        speed={speed}
        onChangeSpeed={handleChangeSpeed}
      />
    </ModelGate>
  )
}
```

- [ ] **Step 4: `SgfPicker` — `onLoadFile` pasa a incluir el `analysisSeed` construido durante el import**

Reemplazar:

```ts
interface SgfPickerProps {
  onLoadFile(tree: GameTree): void
  onStartFromScratch(boardSize: BoardSize): void
  onBack(): void
}
```

por:

```ts
interface SgfPickerProps {
  onLoadFile(tree: GameTree, analysisSeed: Map<number, Analysis>): void
  onStartFromScratch(boardSize: BoardSize): void
  onBack(): void
}
```

Y dentro de `SgfPicker`, reemplazar el cuerpo de `handleFile`:

```ts
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
```

por:

```ts
  async function handleFile(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    input.value = '' // permite reimportar el mismo archivo dos veces seguidas (mismo motivo que PlayView)
    if (!file) return
    setError(null)
    try {
      const text = await file.text()
      const analysisSeed = new Map<number, Analysis>()
      const loaded = importSgf(text, (node, data) => {
        const decoded = decodeAnalysisFromNodeData(data)
        if (decoded) analysisSeed.set(node.id, decoded)
      })
      // Deja el cursor en el tip de la línea principal (mismo UX que import de PlayView: se ve la
      // partida completa de inmediato). Validar DESPUÉS de avanzar, para cubrir exactamente la
      // línea que se va a mostrar/analizar.
      while (loaded.toChild(0)) {
        /* avanza hasta el tip */
      }
      if (!isMoveSequenceLegal(loaded.meta.boardSize, loaded.meta.handicap, loaded.movesTo())) {
        throw new Error('el SGF contiene jugadas ilegales en la línea principal')
      }
      onLoadFile(loaded, analysisSeed)
    } catch (e) {
      setError(`No se pudo cargar el SGF (${errorMessage(e)}).`)
    }
  }
```

- [ ] **Step 5: `ReadyAnalyzeViewProps` + siembra del `AnalysisStore` en `ReadyAnalyzeView`**

Reemplazar:

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

por:

```ts
interface ReadyAnalyzeViewProps {
  tree: GameTree
  /** Id de D1 (Fase 5): ver nota en `AnalyzeView`. */
  cloudId?: string
  /** true si esta sesión viene del camino "empezar desde cero" (spec 2026-07-15): arranca el
   * editor de variaciones ya activado, ver `editingVariation` más abajo. */
  startEditing: boolean
  /** Análisis persistido en el SGF (Fase 6): siembra `AnalysisStore` en el montaje, ver más abajo. */
  analysisSeed?: Map<number, Analysis>
  onBack(): void
  onLoadAnother(): void
  speed: AnalyzeSpeed
  onChangeSpeed(next: AnalyzeSpeed): void
}
```

Reemplazar la firma de `ReadyAnalyzeView` y la construcción de `storeRef`:

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
  const { reviewVisits, interactiveVisits } = speedSettings(speed)
  const managerRef = useRef<EngineManager | null>(null)
  if (!managerRef.current) managerRef.current = new EngineManager(createWorkerManagedEngine)
  const manager = managerRef.current

  const storeRef = useRef<AnalysisStore | null>(null)
  if (!storeRef.current) storeRef.current = new AnalysisStore()
  const store = storeRef.current
```

por:

```ts
function ReadyAnalyzeView({
  tree,
  cloudId,
  startEditing,
  analysisSeed,
  onBack,
  onLoadAnother,
  speed,
  onChangeSpeed,
}: ReadyAnalyzeViewProps) {
  const { reviewVisits, interactiveVisits } = speedSettings(speed)
  const managerRef = useRef<EngineManager | null>(null)
  if (!managerRef.current) managerRef.current = new EngineManager(createWorkerManagedEngine)
  const manager = managerRef.current

  const storeRef = useRef<AnalysisStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new AnalysisStore()
    // Fase 6: siembra el cache ANTES de que el useEffect de montaje llame a review.start() (más
    // abajo) — así GameReview ve estas posiciones ya cubiertas (o las mejora si tenían menos
    // visitas que las pedidas, ver gameReview.ts) en vez de re-analizar todo desde cero.
    if (analysisSeed) {
      for (const [nodeId, analysis] of analysisSeed) storeRef.current.set(nodeId, analysis)
    }
  }
  const store = storeRef.current
```

- [ ] **Step 6: `handleExportSgf`/`cloudSnapshot` pasan el análisis cacheado al exportar**

Agregar, justo antes de `cloudSnapshot` (que ya usa `store`/`tree` en su cuerpo), un helper compartido:

```ts
  /** Datos extra por nodo para `exportSgf` (Fase 6): el análisis cacheado de ESE nodo, si lo hay.
   * Compartido por el export manual y el guardado en la nube — un solo camino, sin distinción. */
  function analysisExtraData(node: TengenGameNode): Record<string, string[]> | undefined {
    return store.has(node.id) ? encodeAnalysisForNode(store.get(node.id)!) : undefined
  }
```

Reemplazar dentro de `cloudSnapshot`:

```ts
  function cloudSnapshot(): GameSnapshot {
    return buildGameSnapshot(
      { sgf: exportSgf(tree), boardSize: tree.meta.boardSize, mode: 'analizar' },
      cloudNameRef.current!,
      cloudId !== undefined,
    )
  }
```

por:

```ts
  function cloudSnapshot(): GameSnapshot {
    return buildGameSnapshot(
      { sgf: exportSgf(tree, analysisExtraData), boardSize: tree.meta.boardSize, mode: 'analizar' },
      cloudNameRef.current!,
      cloudId !== undefined,
    )
  }
```

Y reemplazar `handleExportSgf`:

```ts
  function handleExportSgf(): void {
    const text = exportSgf(tree)
    const blob = new Blob([text], { type: 'application/x-go-sgf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tengen-analyze-${formatDateForFilename(new Date())}.sgf`
    a.click()
    URL.revokeObjectURL(url)
  }
```

por:

```ts
  function handleExportSgf(): void {
    const text = exportSgf(tree, analysisExtraData)
    const blob = new Blob([text], { type: 'application/x-go-sgf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tengen-analyze-${formatDateForFilename(new Date())}.sgf`
    a.click()
    URL.revokeObjectURL(url)
  }
```

- [ ] **Step 7: Typecheck**

Run: `npx -w @tengen/web tsc --noEmit`
Expected: sin errores. Si aparece un error sobre `TengenGameNode` en `analysisExtraData`, confirmar que el import de tipo `GameNode as TengenGameNode` ya existe en la cabecera del archivo (Task 4 no lo agrega, ya estaba).

- [ ] **Step 8: Suite completa — confirmar cero regresión**

Run: `npm test -w @tengen/web`
Expected: todos los tests pasan (línea base + los nuevos de Tasks 1-3) — ningún test de componente que romper (este archivo no tiene).

- [ ] **Step 9: Build**

Run: `npm run build -w @tengen/web`
Expected: `✓ built` sin errores.

- [ ] **Step 10: Verificación manual en navegador**

Con Chrome (WebGPU requerido):

1. `npm run dev -w @tengen/web`, ir a "Analizar" → "9×9" (empezar desde cero — el editor ya arranca activo).
2. Jugar 2-3 piedras alternando color.
3. Click "Analizar esta posición" UNA vez sobre la posición actual (garantiza determinísticamente una entrada en el store, sin depender del timing del review de fondo).
4. Confirmar que el panel muestra winrate/score (no "Sin analizar todavía").
5. Click "Exportar SGF" — abrir el archivo descargado (`cat` desde terminal alcanza) y confirmar que contiene `TGW[`, `TGS[`, `TGN[`, y `TGP[` en el nodo de la jugada analizada.
6. Click "Elegir otra partida" → subir ESE MISMO archivo exportado por el input de archivo.
7. **Verificación clave:** al llegar a esa misma posición, el panel debe mostrar winrate/score **inmediatamente**, SIN haber clickeado "Analizar esta posición" de nuevo — confirma que `analysisSeed` sembró el store correctamente desde las propiedades `TG*` leídas del archivo.
8. Confirmar que jugadas SIN análisis cacheado (una nueva variación recién jugada) siguen mostrando "Sin analizar todavía" hasta pedir el análisis — sin regresión del comportamiento normal.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/ui/AnalyzeView.tsx
git commit -m "feat(web): sembrar/exportar analisis persistido en Modo Analizar

computeInitialAnalyzeState (reapertura) y SgfPicker.handleFile (import local)
construyen un analysisSeed via decodeAnalysisFromNodeData durante el import;
ReadyAnalyzeView siembra un AnalysisStore fresco con eso ANTES de que arranque
GameReview. handleExportSgf/cloudSnapshot pasan encodeAnalysisForNode a
exportSgf - un solo camino de guardado, siempre incluye el analisis cacheado.

Verificado en Chrome real: exportar tras analizar una posicion, reabrir ese
mismo archivo, y el winrate/score aparece sin re-analizar. Suite completa
sin regresion, build OK.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Verificación final del plan

- `npx -w @tengen/web tsc --noEmit` sin errores (tras cada task).
- `npm test -w @tengen/web` → todos verdes, incluidos los ~19 tests nuevos (5 de Task 1, 12 de Task 2, 2 de Task 3).
- `npm run build -w @tengen/web` → build OK.
- Checklist manual del Step 10 (Task 4) completo en Chrome real.
