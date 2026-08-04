#!/usr/bin/env node
// Spot-check de un dataset de Aprender contra KataGo desktop (herramienta LOCAL, protocolo de
// docs/research/fase-aprender/contenido-licencias.md): para cada ejercicio, (1) el top move del
// motor a visitas altas debe coincidir con la primera jugada de la solución, y (2) el scoreLead
// tras la solución debe superar con claridad al de cada rama marcada incorrecta.
//
// Uso:  node apps/web/scripts/spotcheck-tsumego.mjs apps/web/src/learn/data/primeros-pasos.json
// Requiere: brew katago (setup-katago.sh) + packages/engine/models/katago-bin/b18c384nbt.bin.gz
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const MODEL = new URL('../../../packages/engine/models/katago-bin/b18c384nbt.bin.gz', import.meta.url).pathname
const CONFIG = '/opt/homebrew/share/katago/configs/analysis_example.cfg'
const VISITS = 400
const MIN_GAP = 3 // puntos mínimos entre solución y rama incorrecta

const dataPath = process.argv[2]
if (!dataPath) {
  console.error('Uso: node apps/web/scripts/spotcheck-tsumego.mjs <dataset.json>')
  process.exit(1)
}
const exercises = JSON.parse(readFileSync(dataPath, 'utf8'))

// {x,y} de tengen (y=0 arriba) → vértice GTP (columna sin I, fila 1 abajo).
const COLS = 'ABCDEFGHJKLMNOPQRST'
const gtp = (v) => `${COLS[v.x]}${19 - v.y}`

const katago = spawn('katago', [
  'analysis',
  '-model',
  MODEL,
  '-config',
  CONFIG,
  '-override-config',
  `reportAnalysisWinratesAs=BLACK,maxVisits=${VISITS}`,
])
katago.stderr.on('data', () => {}) // el banner de arranque no interesa
const lines = createInterface({ input: katago.stdout })
const pending = new Map()
lines.on('line', (line) => {
  const msg = JSON.parse(line)
  const resolve = pending.get(msg.id)
  if (resolve) {
    pending.delete(msg.id)
    resolve(msg)
  }
})

let seq = 0
function query(initialStones, moves, initialPlayer, allowMoves) {
  const id = `q${seq++}`
  const req = {
    id,
    rules: 'chinese',
    komi: 7.5,
    boardXSize: 19,
    boardYSize: 19,
    initialStones,
    initialPlayer,
    moves,
    includePolicy: false,
    ...(allowMoves ? { allowMoves } : {}),
  }
  katago.stdin.write(JSON.stringify(req) + '\n')
  return new Promise((resolve) => pending.set(id, resolve))
}

// El check 1 compara contra la mejor jugada LOCAL, no la global: en un 19×19 casi vacío el top
// move de tablero entero es una esquina de apertura (Q4/Q16), que vale más que el tsumego — la
// limitación de "tablero completo" que el plan acepta. `allowMoves` con untilDepth 1 restringe la
// PRIMERA jugada de la búsqueda al área del problema (bounding box del setup + 2).
function localArea(setup) {
  const all = [...setup.black, ...setup.white]
  const minX = Math.max(0, Math.min(...all.map((v) => v.x)) - 1)
  const maxX = Math.min(18, Math.max(...all.map((v) => v.x)) + 1)
  const minY = Math.max(0, Math.min(...all.map((v) => v.y)) - 1)
  const maxY = Math.min(18, Math.max(...all.map((v) => v.y)) + 1)
  const occupied = new Set(all.map((v) => `${v.x},${v.y}`))
  const moves = []
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!occupied.has(`${x},${y}`)) moves.push(gtp({ x, y }))
    }
  }
  return moves
}

let failures = 0
for (const e of exercises) {
  const stones = [
    ...e.setup.black.map((v) => ['B', gtp(v)]),
    ...e.setup.white.map((v) => ['W', gtp(v)]),
  ]
  const player = e.toPlay === 'black' ? 'B' : 'W'
  const solutionMove = e.tree.children.find((c) => c.correct === true)?.move
  if (!solutionMove) continue

  // Criterio 1: la solución debe ser (co-)ÓPTIMA LOCAL — top local exacto, o a ≤1.5 pts de él.
  // La tolerancia existe por los problemas de VIVIR: en un tablero por lo demás vacío, "vivir en
  // gote" y "jugar afuera y vivir después" pueden ser miai de timing con score idéntico (medido:
  // Δ0.1 en los cuatro primeros). Eso es Go normal, no un defecto del ejercicio — el veredicto
  // pedagógico lo carga el criterio 2 (toda rama incorrecta pierde ≥3 pts).
  const root = await query(stones, [], player, [{ player, moves: localArea(e.setup), untilDepth: 1 }])
  const top = root.moveInfos?.[0]
  const solutionInfo = root.moveInfos?.find((m) => m.move === gtp(solutionMove.vertex))
  const sideSign = e.toPlay === 'black' ? 1 : -1
  const delta = top && solutionInfo ? sideSign * (top.scoreLead - solutionInfo.scoreLead) : Infinity
  const ok1 = top?.move === gtp(solutionMove.vertex) || delta <= 1.5
  if (!ok1) failures++
  console.log(
    `${e.id}: solución ${gtp(solutionMove.vertex)} vs top local ${top?.move} (Δ ${Number.isFinite(delta) ? delta.toFixed(1) : '∞'} pts) ${ok1 ? 'OK' : 'DISCREPANCIA'}`,
  )

  const afterSolution = await query(stones, [[player, gtp(solutionMove.vertex)]], player)
  const solutionScore = afterSolution.rootInfo.scoreLead // perspectiva NEGRO (override)
  const sign = e.toPlay === 'black' ? 1 : -1
  for (const child of e.tree.children) {
    if (child.correct !== false || !child.move || child.move.vertex === 'pass') continue
    const afterWrong = await query(stones, [[player, gtp(child.move.vertex)]], player)
    const gap = sign * (solutionScore - afterWrong.rootInfo.scoreLead)
    const ok2 = gap >= MIN_GAP
    if (!ok2) failures++
    console.log(
      `  rama incorrecta ${gtp(child.move.vertex)}: gap ${gap.toFixed(1)} pts ${ok2 ? 'OK' : `< ${MIN_GAP} DISCREPANCIA`}`,
    )
  }
}

katago.stdin.end()
katago.kill()
console.log(failures === 0 ? 'SPOT-CHECK: todo OK' : `SPOT-CHECK: ${failures} discrepancias`)
process.exit(failures === 0 ? 0 : 1)
