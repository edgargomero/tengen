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
import { loadStoredProbe, probeEngine, PROBE_PRESETS } from '../diagnostics/engineProbe'
import type { EngineProbeResult, EngineRound, ProbePresetId } from '../diagnostics/engineProbe'
import { formatEngineProbe, judgeEngineProbe } from '../diagnostics/engineVerdict'
import { diagnose, formatDiagnostics, warnings } from '../diagnostics/format'
import { errorText } from '../diagnostics/gpuProbe'
import { webGpuAdvice } from '../diagnostics/webGpuAdvice'

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
  const copyMessage = COPY_MESSAGE[copy]
  // Las tandas de la prueba del motor entran en el MISMO volcado que se copia. Si viajaran aparte, el
  // reporte llegaría partido en dos mensajes y con la mitad de la información perdida en el camino.
  const [engineLines, setEngineLines] = useState<string[]>([])
  const dump = formatDiagnostics(data, engineLines.length > 0 ? [{ title: 'prueba del motor', lines: engineLines }] : [])
  // Qué HACER, no sólo qué pasa. El consejo también vive en el cartel del gate (`NoWebGpu`), pero a esta
  // pantalla se llega por su URL directa —es lo que uno pega en un chat— y ahí el gate nunca se ve. Sin
  // esto, el diagnóstico dice "este dispositivo no puede" y deja al lector sin siguiente paso: pasó de
  // verdad, dos veces, con el mismo iPhone entrando por Chrome.
  const advice = verdict.ok ? [] : webGpuAdvice(data.userAgent)

  return (
    <>
      {/* El veredicto es lo único que se lee de un vistazo; todo lo demás es evidencia. */}
      <p class={verdict.ok ? 'notice notice--accent' : 'notice notice--danger'}>
        <strong>{verdict.headline}</strong>
        <br />
        {verdict.detail}
      </p>

      {advice.length > 0 && (
        <div class="notice notice--accent">
          {advice.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      {notes.length > 0 && (
        <ul class="diagnostico-warnings">
          {notes.map((note) => (
            <li key={note} class="hint">
              {note}
            </li>
          ))}
        </ul>
      )}

      {/* Sólo si el motor PUEDE correr acá: medir en un dispositivo donde ni existe WebGPU no diría
          nada, y el botón invitaría a un fracaso garantizado. */}
      {verdict.ok && <EngineProbeSection onDump={setEngineLines} />}

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

type ProbeState =
  | { phase: 'idle' }
  | { phase: 'running'; rounds: EngineRound[] }
  | { phase: 'done'; result: EngineProbeResult }

/**
 * Prueba del motor: tandas idénticas de análisis real, medidas una por una.
 *
 * Dos decisiones que valen la pena explicar:
 *
 * · **Arranca con un botón, nunca sola.** La prueba levanta el motor de verdad y pone 115,8 MB en la GPU.
 *   Hacerlo al abrir una pantalla de diagnóstico sería exactamente lo contrario de diagnosticar en un
 *   dispositivo que se está investigando por memoria.
 * · **Reporta cada tanda a medida que termina**, no al final. El caso que se investiga es que el proceso
 *   muera a mitad; si los resultados se publicaran recién al terminar, el escenario interesante sería el
 *   único que no dejaría rastro.
 */
function EngineProbeSection({ onDump }: { onDump(lines: string[]): void }) {
  const [state, setState] = useState<ProbeState>({ phase: 'idle' })
  // Corrida anterior que quedó escrita. Se lee UNA vez al montar: si `finished` es false, el proceso
  // murió a mitad y cuántas tandas alcanzó es exactamente el dato que se estaba buscando.
  const [previous] = useState(() => loadStoredProbe(window.localStorage))

  // La corrida interrumpida entra en el VOLCADO, no sólo en la pantalla. Sin esto, la evidencia del
  // crash se ve pero no se copia: quien lo reporta pega el volcado —que es el punto de esta pantalla— y
  // el dato más importante se queda en el teléfono. Va en un efecto porque `onDump` actualiza estado del
  // padre, y hacerlo durante el render sería mutar mientras se pinta.
  useEffect(() => {
    if (previous !== null && !previous.finished) {
      onDump([
        `corrida anterior INTERRUMPIDA (${previous.at}) — el proceso murió sin terminar`,
        ...formatEngineProbe({
          modelInOpfs: true,
          rounds: previous.rounds,
          ...(previous.initMs !== undefined ? { initMs: previous.initMs } : {}),
        }),
      ])
    }
    // Sólo al montar: `previous` se fija una vez y `onDump` es estable en la práctica (el padre lo pasa
    // como setState). Re-ejecutarlo pisaría un volcado ya actualizado por una corrida nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Qué reparto de inferencias usar. Cambiarlo es el experimento que separa acumulación de techo (ver
  // `PROBE_PRESETS`), así que es un control de primera clase, no un ajuste escondido.
  const [preset, setPreset] = useState<ProbePresetId>('normal')

  async function run(): Promise<void> {
    const chosen = PROBE_PRESETS.find((p) => p.id === preset) ?? PROBE_PRESETS[1]
    setState({ phase: 'running', rounds: [] })
    const result = await probeEngine({
      storage: window.localStorage,
      rounds: chosen.rounds,
      visitsPerRound: chosen.visitsPerRound,
      onRound: (_round, all) => {
        setState({ phase: 'running', rounds: all })
        // Publica el parcial en el volcado en cada tanda: si el aparato muere ahora, esto es lo que
        // sobrevive para copiar.
        onDump(formatEngineProbe({ modelInOpfs: true, rounds: all }))
      },
    })
    setState({ phase: 'done', result })
    onDump(formatEngineProbe(result))
  }

  // Sólo se muestra si quedó a mitad Y no hay una corrida nueva en pantalla: una corrida terminada ya
  // dijo lo suyo, y una en curso la reemplaza.
  const interrupted = previous !== null && !previous.finished && state.phase === 'idle' ? previous : null

  const running = state.phase === 'running'
  const verdict = state.phase === 'done' ? judgeEngineProbe(state.result) : null
  const rounds = state.phase === 'running' ? state.rounds : state.phase === 'done' ? state.result.rounds : []
  const activePreset = PROBE_PRESETS.find((p) => p.id === preset) ?? PROBE_PRESETS[1]
  // El acumulado por tanda se calcula al vuelo (una suma) en vez de guardarse: es la variable que
  // discrimina, pero derivarla evita que el dato persistido tenga dos fuentes de verdad.
  let cumulative = 0
  const withCumulative = rounds.map((round) => {
    cumulative += round.visits
    return { round, cumulative }
  })

  return (
    <div class="rail-field">
      <span class="eyebrow">Prueba del motor</span>
      <p class="hint">
        Tandas iguales de análisis real, cada una cronometrada. Cambiar el reparto es el experimento:
        morir en el mismo acumulado con tandas chicas y grandes significa que algo crece; sobrevivir a las
        chicas y morir sólo en las grandes significa que el problema es el pico de una tanda.
      </p>
      <div class="choice-row" role="group" aria-label="Reparto de la prueba">
        {PROBE_PRESETS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={preset === option.id}
            class={preset === option.id ? 'active' : ''}
            disabled={running}
            onClick={() => setPreset(option.id)}
          >
            {option.label} ({option.rounds}×{option.visitsPerRound})
          </button>
        ))}
      </div>
      <div class="action-row">
        <button type="button" onClick={() => void run()} disabled={running}>
          {running ? `Midiendo… (${rounds.length}/${activePreset.rounds})` : 'Probar el motor'}
        </button>
      </div>

      {interrupted !== null && (
        <div class="notice notice--danger">
          <strong>La prueba anterior se cortó sola</strong>
          <br />
          {interrupted.rounds.length === 0
            ? 'Murió al arrancar el motor, antes de completar una sola tanda: el pico de memoria más grande de la app es justo ese, subir el modelo a la GPU.'
            : `Alcanzó ${interrupted.rounds.length}${interrupted.totalRounds !== undefined ? ` de ${interrupted.totalRounds}` : ''} tandas (${interrupted.rounds.reduce((sum, r) => sum + r.visits, 0)} inferencias) y el proceso murió. Repite con el otro reparto: si muere cerca del mismo acumulado, algo crece; si aguanta, el problema es el pico de una tanda.`}
          <br />
          {formatEngineProbe({ modelInOpfs: true, rounds: interrupted.rounds, ...(interrupted.initMs !== undefined ? { initMs: interrupted.initMs } : {}) }).join(' · ')}
        </div>
      )}

      {withCumulative.length > 0 && (
        <ul class="diagnostico-rounds">
          {withCumulative.map(({ round, cumulative: acc }) => (
            <li key={round.round} class="meta-row">
              <span>
                Tanda {round.round} · {acc} acum.
              </span>
              <span>
                {round.ms} ms · {round.visitsPerSecond} v/s
              </span>
            </li>
          ))}
        </ul>
      )}

      {verdict !== null && (
        <p class={verdict.kind === 'ok' ? 'notice notice--accent' : 'notice notice--danger'}>
          <strong>{verdict.headline}</strong>
          <br />
          {verdict.detail}
        </p>
      )}
    </div>
  )
}
