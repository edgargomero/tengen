import { render } from 'preact'

function App() {
  return (
    <main>
      <h1>tengen</h1>
      <p>scaffold ok — Fase 0</p>
    </main>
  )
}

const root = document.getElementById('app')
if (root) render(<App />, root)
