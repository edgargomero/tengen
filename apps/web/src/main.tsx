// Entrada de la SPA (Fase 0): gate de WebGPU + smoke manual del Worker. El smoke crea el Worker REAL de
// apps/web (factory propia → /models/<id>.onnx del dev server), inicializa b18 en 9×9 y pide una jugada
// kata en el tablero vacío. Verificación a ojo por Edgar en Chrome/WebGPU (headless no puede WebGPU).
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { WorkerEngine } from '@tengen/engine'
import type { Position } from '@tengen/engine'
import { detectWebGpu } from './webgpu'

function Smoke() {
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const append = (line: string): void => setLog((l) => [...l, line])

  async function runSmoke(): Promise<void> {
    setRunning(true)
    setLog([])
    // El bundler (Vite) resuelve engine.worker.ts como módulo de worker con esta forma canónica.
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    const engine = new WorkerEngine(worker)
    try {
      append('init b18 en 9×9…')
      await engine.init({ network: 'b18', boardSize: 9 })
      append('genMove kata (100 visitas) en tablero vacío…')
      const empty: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }
      const move = await engine.genMove(empty, { level: { kind: 'kata', visits: 100 } })
      append('jugada: ' + JSON.stringify(move))
      append('OK ✓')
    } catch (e) {
      append('ERROR: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      worker.terminate()
      setRunning(false)
    }
  }

  return (
    <main style="font: 14px/1.5 system-ui; margin: 2rem; max-width: 48rem;">
      <h1>tengen — smoke Worker (Fase 0)</h1>
      <p>
        Crea el Worker real, inicializa <code>b18</code> en 9×9 y pide una jugada kata (100 visitas) en el
        tablero vacío. Requiere los <code>.onnx</code> en <code>packages/engine/models/</code>.
      </p>
      <button disabled={running} onClick={() => void runSmoke()}>
        {running ? 'corriendo…' : 'Correr smoke'}
      </button>
      <pre style="margin-top: 1rem; padding: 1rem; border: 1px solid #ccc; white-space: pre-wrap; min-height: 4rem;">
        {log.join('\n')}
      </pre>
    </main>
  )
}

function NoWebGpu() {
  return (
    <main style="font: 14px/1.5 system-ui; margin: 2rem; max-width: 48rem;">
      <h1>tengen</h1>
      <p>
        tengen necesita <strong>WebGPU</strong>. Abre esta página en <strong>Chrome o Edge</strong>{' '}
        recientes (WebGPU habilitado).
      </p>
    </main>
  )
}

function App() {
  const [webgpu, setWebgpu] = useState<boolean | null>(null)
  useEffect(() => {
    void detectWebGpu().then(setWebgpu)
  }, [])
  if (webgpu === null) {
    return (
      <main style="font: 14px/1.5 system-ui; margin: 2rem;">
        <p>detectando WebGPU…</p>
      </main>
    )
  }
  return webgpu ? <Smoke /> : <NoWebGpu />
}

const root = document.getElementById('app')
if (root) render(<App />, root)
