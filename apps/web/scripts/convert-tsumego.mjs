#!/usr/bin/env npx tsx
// Conversor de tsumego: SGF crudos → apps/web/src/learn/data/<coleccion>.json (herramienta LOCAL,
// no corre en build ni en CI — los SGF crudos viven fuera del repo y solo el JSON con veredicto de
// licencia escrito se commitea; ver docs/research/fase-aprender/contenido-licencias.md).
//
// Uso:  npx tsx apps/web/scripts/convert-tsumego.mjs <dir-con-sgf> <coleccion> [dir-salida]
//
// Etiquetado de `correct` (horneado en cada jugada del color del alumno):
//   1. Marca explícita en la HOJA de la línea: C[] con correct/right/good/success ↔
//      wrong/bad/fail/incorrect/mistake (case-insensitive), o TE[]/BM[] en la jugada.
//   2. Sin ninguna marca en todo el árbol → heurística "primera rama = solución" con WARNING
//      (la línea principal termina correcta; toda otra hoja, incorrecta).
//   3. Ambigüedades (marcas contradictorias, toPlay indetectable) → overrides.json en el dir de
//      los SGF: { "<archivo.sgf>": { skip?, toPlay?, objective?, difficulty? } }. Nunca se adivina
//      en silencio: lo que no se resuelve queda EXCLUIDO y listado.
//
// Reproducible: mismos SGF + mismo overrides.json → bytes idénticos (orden por nombre de archivo,
// JSON con indentación fija). Valida cada ejercicio con exerciseIssues antes de incluirlo.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { importSgf } from '../src/game/sgf.ts'
import { exerciseIssues } from '../src/learn/exercise.ts'

const [, , srcDir, collection, outDirArg] = process.argv
if (!srcDir || !collection) {
  console.error('Uso: npx tsx apps/web/scripts/convert-tsumego.mjs <dir-con-sgf> <coleccion> [dir-salida]')
  process.exit(1)
}
const outDir = resolve(outDirArg ?? join(import.meta.dirname, '../src/learn/data'))

const overridesPath = join(srcDir, 'overrides.json')
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, 'utf8')) : {}

const CORRECT_RE = /\b(correct|right|good|success|solved)\b/i
const WRONG_RE = /\b(wrong|bad|fail(ed|ure)?|incorrect|mistake)\b/i

/** Marca explícita de un nodo SGF: true/false/undefined. TE/BM pesan más que el comentario. */
function explicitMark(data) {
  if (data.TE !== undefined) return true
  if (data.BM !== undefined) return false
  const comment = data.C?.[0] ?? ''
  const correct = CORRECT_RE.test(comment)
  const wrong = WRONG_RE.test(comment)
  if (correct && !wrong) return true
  if (wrong && !correct) return false
  return undefined
}

function detectObjective(rootComment) {
  if (/\bkill\b|matar/i.test(rootComment)) return 'matar'
  if (/\b(live|life)\b|vivir/i.test(rootComment)) return 'vivir'
  if (/\bko\b/i.test(rootComment)) return 'ko'
  return 'desconocido'
}

const files = readdirSync(srcDir)
  .filter((f) => f.endsWith('.sgf'))
  .sort()
const exercises = []
const excluded = []
const warnings = []

for (const file of files) {
  const override = overrides[file] ?? {}
  if (override.skip) {
    excluded.push(`${file}: skip por overrides.json`)
    continue
  }
  let tree
  const nodeData = new Map()
  try {
    tree = importSgf(readFileSync(join(srcDir, file), 'utf8'), (node, data) => nodeData.set(node, data))
  } catch (e) {
    excluded.push(`${file}: SGF inválido (${e instanceof Error ? e.message : e})`)
    continue
  }
  if (tree.meta.boardSize !== 19) {
    excluded.push(`${file}: SZ ${tree.meta.boardSize} ≠ 19 (v1 es 19×19)`)
    continue
  }
  if (!tree.meta.setup) {
    excluded.push(`${file}: sin AB/AW (tablero vacío no es tsumego)`)
    continue
  }

  const firstMoves = tree.root.children.map((c) => c.move?.color).filter(Boolean)
  const detectedToPlay = tree.meta.initialTurn ?? (new Set(firstMoves).size === 1 ? firstMoves[0] : undefined)
  const toPlay = override.toPlay ?? detectedToPlay
  if (!toPlay) {
    excluded.push(`${file}: toPlay indetectable (sin PL y primeras jugadas de colores mixtos) — resolver en overrides.json`)
    continue
  }

  // ¿Hay alguna marca explícita en el árbol? Si no, heurística primera-rama con WARNING.
  let hasAnyMark = false
  const scan = (gameNode) => {
    if (gameNode.move && explicitMark(nodeData.get(gameNode) ?? {}) !== undefined) hasAnyMark = true
    gameNode.children.forEach(scan)
  }
  scan(tree.root)
  if (!hasAnyMark) {
    warnings.push(`${file}: sin marcas Correct/Wrong/TE/BM — heurística "primera rama = solución"`)
  }

  // Veredicto por hoja: marca explícita de la hoja, o (sin marcas en el árbol) línea principal.
  const leafVerdict = (gameNode, isMainPath) => {
    const mark = explicitMark(nodeData.get(gameNode) ?? {})
    if (mark !== undefined) return mark
    return hasAnyMark ? false : isMainPath
  }

  // GameNode → ExerciseNode. `correct` de una jugada del alumno = alguna hoja de su subárbol es
  // correcta (las líneas del rival en el SGF son la resistencia más fuerte).
  const convert = (gameNode, isMainPath) => {
    const data = nodeData.get(gameNode) ?? {}
    const children = gameNode.children.map((child, i) => convert(child, isMainPath && i === 0))
    const isLeaf = gameNode.children.length === 0
    const subtreeCorrect = isLeaf ? leafVerdict(gameNode, isMainPath) : children.some((c) => c.__subtreeCorrect)
    const node = { children }
    if (gameNode.move) node.move = gameNode.move
    const comment = data.C?.[0]
    if (comment) node.comment = comment
    if (gameNode.move && gameNode.move.color === toPlay) node.correct = subtreeCorrect
    Object.defineProperty(node, '__subtreeCorrect', { value: subtreeCorrect, enumerable: false })
    return node
  }
  const rootComment = nodeData.get(tree.root)?.C?.[0] ?? ''
  const exerciseTree = convert(tree.root, true)

  const exercise = {
    id: `${collection}-${basename(file, '.sgf')}`,
    collection,
    boardSize: 19,
    setup: tree.meta.setup,
    toPlay,
    objective: override.objective ?? detectObjective(rootComment),
    ...(override.difficulty !== undefined ? { difficulty: override.difficulty } : {}),
    tree: exerciseTree,
  }

  const issues = exerciseIssues(exercise)
  if (issues.length > 0) {
    excluded.push(`${file}: ${issues.join(' · ')}`)
    continue
  }
  exercises.push(exercise)
}

if (exercises.length === 0) {
  console.error('Ningún ejercicio pasó la validación; no se escribe nada.')
  excluded.forEach((m) => console.error(`  EXCLUIDO ${m}`))
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, `${collection}.json`)
writeFileSync(outPath, JSON.stringify(exercises, null, 2) + '\n')

warnings.forEach((m) => console.warn(`WARNING ${m}`))
excluded.forEach((m) => console.warn(`EXCLUIDO ${m}`))
console.log(`${outPath}: ${exercises.length} ejercicios (${excluded.length} excluidos, ${warnings.length} warnings)`)
