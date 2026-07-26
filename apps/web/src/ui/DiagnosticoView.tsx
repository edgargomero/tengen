// Pantalla `/diagnostico`: qué ve este dispositivo y por qué el motor arranca o no.
//
// ── Por qué NO es una ruta normal ──────────────────────────────────────────────────────────────
// El gate de WebGPU está POR ENCIMA del `<Router>` (`main.tsx`): sin adapter, la app entera se reduce a
// un mensaje —ni menú, ni `/jugar`, ni `/partidas`—, así que una ruta del router sería inalcanzable justo
// en el dispositivo que hay que diagnosticar. Se monta antes del gate, mirando `location.pathname`, y se
// llega con un `<a href>` de verdad (navegación completa del documento) en vez de un `<Link>`: para un
// diagnóstico, arrancar de cero es una ventaja, no un costo.
//
// ── Por qué el volcado se muestra SIEMPRE, aunque haya botón de copiar ────────────────────────
// El botón usa `navigator.clipboard`, que en un contexto degradado puede no existir o rechazar sin
// motivo visible. Esconder el texto detrás de un toggle sería apostar a que el toggle funcione en el
// aparato roto. El bloque de abajo es el fallback y se selecciona entero con un toque
// (`user-select: all`, ver `.diagnostico-dump` en app.css).
import { useEffect, useState } from 'preact/hooks'
import { collectDiagnostics } from '../diagnostics/collect'
import type { Diagnostics } from '../diagnostics/collect'
import { diagnose, formatDiagnostics, warnings } from '../diagnostics/format'
import { errorText } from '../diagnostics/gpuProbe'

type ViewState =
  | { phase: 'collecting' }
  | { phase: 'ready'; data: Diagnostics }
  /** `collectDiagnostics` está escrito para no lanzar; esta rama existe para que un bug ahí se vea. */
  | { phase: 'failed'; message: string }

type CopyState = 'idle' | 'copied' | 'failed'

export function DiagnosticoView() {
  const [state, setState] = useState<ViewState>({ phase: 'collecting' })
  const [copy, setCopy] = useState<CopyState>('idle')

  useEffect(() => {
    let live = true
    void collectDiagnostics().then(
      (data) => {
        if (live) setState({ phase: 'ready', data })
      },
      (err: unknown) => {
        if (live) setState({ phase: 'failed', message: errorText(err) })
      },
    )
    return () => {
      live = false
    }
  }, [])

  async function handleCopy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopy('copied')
    } catch {
      // Clipboard bloqueada, ausente o sin permiso: el volcado de abajo sigue siendo la salida.
      setCopy('failed')
    }
  }

  return (
    <main class="system-screen diagnostico">
      <h1>Diagnóstico</h1>

      {state.phase === 'collecting' && (
        <p class="system-note">Sondeando WebGPU en la página y en un worker…</p>
      )}

      {state.phase === 'failed' && (
        <p class="notice notice--danger">No se pudo recolectar el diagnóstico: {state.message}</p>
      )}

      {state.phase === 'ready' && <DiagnosticoReport data={state.data} copy={copy} onCopy={handleCopy} />}

      {/* Navegación completa a propósito (ver cabecera): un `<Link>` no serviría acá. */}
      <a class="link-button diagnostico-back" href="/">
        Volver al inicio
      </a>
    </main>
  )
}

const COPY_MESSAGE: Record<CopyState, string | null> = {
  idle: null,
  copied: 'Copiado. Pégalo en el reporte.',
  failed: 'No se pudo copiar solo: toca el bloque de abajo para seleccionarlo todo y cópialo a mano.',
}

function DiagnosticoReport({
  data,
  copy,
  onCopy,
}: {
  data: Diagnostics
  copy: CopyState
  onCopy(text: string): void
}) {
  const verdict = diagnose(data)
  const notes = warnings(data)
  const dump = formatDiagnostics(data)
  const copyMessage = COPY_MESSAGE[copy]

  return (
    <>
      {/* El veredicto es lo único que se lee de un vistazo; todo lo demás es evidencia. */}
      <p class={verdict.ok ? 'notice notice--accent' : 'notice notice--danger'}>
        <strong>{verdict.headline}</strong>
        <br />
        {verdict.detail}
      </p>

      {notes.length > 0 && (
        <ul class="diagnostico-warnings">
          {notes.map((note) => (
            <li key={note} class="hint">
              {note}
            </li>
          ))}
        </ul>
      )}

      <div class="action-row">
        <button type="button" class="primary" onClick={() => onCopy(dump)}>
          Copiar todo
        </button>
      </div>
      {copyMessage !== null && (
        <p class="hint" role="status" aria-live="polite">
          {copyMessage}
        </p>
      )}

      <p class="notice notice--quote diagnostico-dump">{dump}</p>
    </>
  )
}
