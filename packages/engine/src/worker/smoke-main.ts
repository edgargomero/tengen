// Entrada de la página de smoke MANUAL (engine-smoke.html). Archivo 100% de tengen. NO es un test
// automatizado: crea el Worker REAL (con la factory por defecto → /models/<id>.onnx del dev server),
// hace init + genMove kata en 9×9 vacío e imprime la jugada. Verificación a ojo en Chrome/WebGPU.

import { WorkerEngine } from './client'
import type { Position } from '../types'

function log(line: string): void {
  const el = document.getElementById('log')
  if (el !== null) el.textContent += line + '\n'
}

async function runSmoke(): Promise<void> {
  log('creando Worker…')
  // El bundler (Vite) resuelve `engine.worker.ts` como módulo de worker con esta forma canónica.
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
  const engine = new WorkerEngine(worker)
  try {
    log('init b18 en 9×9…')
    await engine.init({ network: 'b18', boardSize: 9 })
    log('genMove kata (100 visitas) en tablero vacío…')
    const empty: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }
    const move = await engine.genMove(empty, { level: { kind: 'kata', visits: 100 } })
    log('jugada devuelta: ' + JSON.stringify(move))
    log('OK ✓')
  } catch (e) {
    log('ERROR: ' + (e instanceof Error ? e.message : String(e)))
  } finally {
    worker.terminate()
  }
}

document.getElementById('run')?.addEventListener('click', () => {
  void runSmoke()
})
