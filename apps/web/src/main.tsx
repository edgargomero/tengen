// Entrada de la SPA (Fase 2, Task 4): shell del "Modo Jugar". Gate de WebGPU (igual que en
// Fase 0/1) y, detrás de él, formulario de nueva partida → pantalla de juego. La restauración de
// partida desde localStorage es Task 5 (persistence.ts ya existe pero no se cablea todavía): el
// estado `config` nace siempre en `null` por ahora, a propósito, para que Task 5 pueda insertar
// ahí una carga inicial sin reestructurar este archivo.
import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import '@sabaki/shudan/css/goban.css'
import './styles/app.css'
import type { GameConfig } from './game/gameConfig'
import { NewGameForm } from './ui/NewGameForm'
import { PlayView } from './ui/PlayView'
import { detectWebGpu } from './webgpu'

function NoWebGpu() {
  return (
    <main class="no-webgpu">
      <h1>tengen</h1>
      <p>
        tengen necesita <strong>WebGPU</strong>. Abre esta página en <strong>Chrome o Edge</strong>{' '}
        recientes (WebGPU habilitado).
      </p>
    </main>
  )
}

function PlayApp() {
  const [config, setConfig] = useState<GameConfig | null>(null)

  if (config === null) {
    return <NewGameForm onStart={setConfig} />
  }
  return <PlayView config={config} onNewGame={() => setConfig(null)} />
}

function App() {
  const [webgpu, setWebgpu] = useState<boolean | null>(null)
  useEffect(() => {
    void detectWebGpu().then(setWebgpu)
  }, [])
  if (webgpu === null) {
    return (
      <main class="detecting">
        <p>detectando WebGPU…</p>
      </main>
    )
  }
  return webgpu ? <PlayApp /> : <NoWebGpu />
}

const root = document.getElementById('app')
if (root) render(<App />, root)
