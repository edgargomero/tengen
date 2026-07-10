// Entrada de la SPA. Gate de WebGPU + selector de red + smoke manual del Worker (Fase 0→1). El smoke
// vive DENTRO de <ModelGate>, que garantiza el ONNX en OPFS (con progreso) antes de correrlo. Al pulsar,
// crea el Worker REAL de apps/web (factory propia → lee OPFS), inicializa la red en 9×9 y pide una jugada.
// Verificación a ojo por Edgar en Chrome/WebGPU (headless no puede WebGPU).
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { WorkerEngine } from '@tengen/engine'
import type { Move, NetworkId, Position } from '@tengen/engine'
import { detectWebGpu } from './webgpu'
import { ModelGate } from './models/ModelGate'

function Smoke({ net }: { net: NetworkId }) {
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
      append(`init ${net} en 9×9…`)
      await engine.init({ network: net, boardSize: 9 })
      const empty: Position = { boardSize: 9, komi: 7, rules: 'chinese', handicap: 0, moves: [] }
      // Nivel inline por red: human (rank) para humanv0; kata (visitas) para el resto (b18).
      let move: Move
      if (net === 'humanv0') {
        append('genMove human (5k) en tablero vacío…')
        move = await engine.genMove(empty, { level: { kind: 'human', rank: '5k' } })
      } else {
        append('genMove kata (100 visitas) en tablero vacío…')
        move = await engine.genMove(empty, { level: { kind: 'kata', visits: 100 } })
      }
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
    <div style="margin-top: 1rem;">
      <button disabled={running} onClick={() => void runSmoke()}>
        {running ? 'corriendo…' : `Correr smoke (${net})`}
      </button>
      <pre style="margin-top: 1rem; padding: 1rem; border: 1px solid #ccc; white-space: pre-wrap; min-height: 4rem;">
        {log.join('\n')}
      </pre>
    </div>
  )
}

function SmokeApp() {
  const [selectedNet, setSelectedNet] = useState<NetworkId>('b18')

  return (
    <main style="font: 14px/1.5 system-ui; margin: 2rem; max-width: 48rem;">
      <h1>tengen — smoke Worker (Fase 1: caché OPFS)</h1>
      <p>
        Selecciona una red; <code>ModelGate</code> la descarga a OPFS (con progreso) o la lee del caché,
        y sólo entonces corre el smoke, que crea el Worker real, inicializa la red en 9×9 y pide una jugada
        en el tablero vacío. Recarga con Network offline: la red carga desde OPFS sin red.
      </p>
      <label>
        Red:{' '}
        <select
          value={selectedNet}
          onChange={(e) => setSelectedNet((e.currentTarget as HTMLSelectElement).value as NetworkId)}
        >
          <option value="b18">b18 (kata)</option>
          <option value="humanv0">humanv0 (human)</option>
        </select>
      </label>
      <ModelGate net={selectedNet}>
        <Smoke net={selectedNet} />
      </ModelGate>
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
  return webgpu ? <SmokeApp /> : <NoWebGpu />
}

const root = document.getElementById('app')
if (root) render(<App />, root)
