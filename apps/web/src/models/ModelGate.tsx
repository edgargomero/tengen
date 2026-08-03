// Gate de caché de modelo (Fase 1). Antes de renderizar `children`, garantiza que el ONNX de `net`
// está descargado y cacheado en OPFS (con barra de progreso). Reutilizable: Fase 2 lo pondrá delante
// del tablero. Sólo hilo principal — usa `ensureModel` (que toca `localStorage` vía el marcador); el
// worker lee OPFS por su cuenta (appFactory.ts).
//
// Patrón de progressbar ARIA modelado sobre web-katrain SettingsModal.tsx (MIT): aria-valuemin/max/now
// SOLO cuando hay porcentaje (Content-Length); sin total → estado indeterminado sin aria-valuenow.
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { NetworkId } from '@tengen/engine'
import { ensureModel } from './modelCache'
import { currentModelVariant } from './modelVariant'
import { createOpfsModelStore } from './modelStore'
import { ensurePersistentStorage, isDurable, type PersistenceResult } from './persistentStorage'
import type { DownloadProgress } from './progress'

type GateStatus = 'downloading' | 'ready' | 'error'

interface ModelGateProps {
  net: NetworkId
  children: ComponentChildren
}

function formatMb(bytes: number): string {
  return (bytes / 1e6).toFixed(1)
}

export function ModelGate({ net, children }: ModelGateProps) {
  const [status, setStatus] = useState<GateStatus>('downloading')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Bump para re-disparar el efecto (botón "Reintentar") sin cambiar `net`.
  const [retry, setRetry] = useState(0)
  // Qué contestó el navegador al pedido de almacenamiento persistente. `null` = todavía no se sabe.
  // Gobierna la línea que promete durabilidad: sin esto, la app afirmaba "queda guardada en este
  // navegador" mientras los 110 MB seguían en un bucket desalojable.
  const [persistence, setPersistence] = useState<PersistenceResult | null>(null)

  useEffect(() => {
    // Última-solicitud-gana: si `net` cambia o el componente se desmonta mid-descarga, el cleanup
    // marca esta solicitud obsoleta → no renderiza children de una red vieja ni deja que una promesa
    // resuelta tardíamente pise el estado de la red actual.
    let stale = false
    setStatus('downloading')
    setProgress(null)
    setErrorMsg(null)

    // ANTES de bajar 110 MB: pedir que el origen sea persistente. Es fire-and-forget a propósito —
    // si el navegador lo niega, la descarga igual vale la pena (los datos siguen viviendo, solo que
    // sin garantía de no ser desalojados); lo que cambia es lo que la pantalla promete.
    void ensurePersistentStorage(navigator.storage).then((result) => {
      if (!stale) setPersistence(result)
    })

    // `currentModelVariant()` es la MISMA llamada que hace `appFactory` en el worker, sin argumentos
    // en ninguno de los dos lados. Es lo que garantiza que el worker lea el archivo que este efecto
    // acaba de descargar; ver el comentario largo de `modelVariant.ts`.
    ensureModel(
      net,
      currentModelVariant(),
      createOpfsModelStore(),
      (url) => fetch(url),
      (p) => {
        if (!stale) setProgress(p)
      },
    ).then(
      () => {
        if (!stale) setStatus('ready')
      },
      (err: unknown) => {
        if (stale) return
        setErrorMsg(err instanceof Error ? err.message : String(err))
        setStatus('error')
      },
    )

    return () => {
      stale = true
    }
  }, [net, retry])

  if (status === 'ready') {
    return <>{children}</>
  }

  if (status === 'error') {
    return (
      <div class="system-screen">
        <h1>tengen</h1>
        <p class="notice notice--danger">
          No se pudo cargar la red neuronal {net}: {errorMsg}
        </p>
        <button onClick={() => setRetry((n) => n + 1)}>Reintentar</button>
      </div>
    )
  }

  // downloading
  const percent = progress?.percent ?? null
  const received = progress?.receivedBytes ?? 0
  const total = progress?.totalBytes ?? null
  const sizeLabel =
    total !== null ? `${formatMb(received)} / ${formatMb(total)} MB` : `${formatMb(received)} MB`

  return (
    <div class="system-screen">
      <h1>tengen</h1>
      <p>Descargando la red neuronal {net}…</p>
      <div
        class="progress-track"
        role="progressbar"
        aria-label={`Descargando modelo ${net}`}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent === null ? undefined : percent}
      >
        <div
          class={percent === null ? 'progress-fill progress-fill--indeterminate' : 'progress-fill'}
          style={percent === null ? undefined : `width: ${percent}%`}
        />
      </div>
      <p class="system-note">
        {percent === null ? sizeLabel : `${percent}% — ${sizeLabel}`}
      </p>
      {/* Esta línea dice exactamente lo que el navegador concedió, ni más. La versión anterior
          prometía durabilidad siempre; medido en producción, el origen NO era persistente. */}
      <p class="system-note">
        {persistence === null || isDurable(persistence)
          ? 'Se descarga una sola vez: queda guardada en este navegador y el motor corre entero en tu equipo, sin servidor.'
          : 'El motor corre entero en tu equipo, sin servidor. Este navegador no garantizó guardado permanente: si le falta espacio podría borrarla y habría que descargarla otra vez. Instalar tengen como app evita eso.'}
      </p>
    </div>
  )
}
