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
import { createOpfsModelStore } from './modelStore'
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

  useEffect(() => {
    // Última-solicitud-gana: si `net` cambia o el componente se desmonta mid-descarga, el cleanup
    // marca esta solicitud obsoleta → no renderiza children de una red vieja ni deja que una promesa
    // resuelta tardíamente pise el estado de la red actual.
    let stale = false
    setStatus('downloading')
    setProgress(null)
    setErrorMsg(null)

    ensureModel(
      net,
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
      <div style="font: 14px/1.5 system-ui; margin: 2rem; max-width: 48rem;">
        <p style="color: #b00020;">Error al cargar el modelo {net}: {errorMsg}</p>
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
    <div style="font: 14px/1.5 system-ui; margin: 2rem; max-width: 48rem;">
      <p>Descargando modelo {net}…</p>
      <div
        role="progressbar"
        aria-label={`Descargando modelo ${net}`}
        aria-valuemin={percent === null ? undefined : 0}
        aria-valuemax={percent === null ? undefined : 100}
        aria-valuenow={percent === null ? undefined : percent}
        style="width: 100%; height: 1.25rem; border: 1px solid #ccc; border-radius: 4px; overflow: hidden; background: #f0f0f0;"
      >
        <div
          style={
            percent === null
              ? 'width: 100%; height: 100%; background: #b3d4f5; opacity: 0.6;'
              : `width: ${percent}%; height: 100%; background: #4a90d9; transition: width 0.15s;`
          }
        />
      </div>
      <p style="margin-top: 0.5rem; font-variant-numeric: tabular-nums;">
        {percent === null ? `descargando… ${sizeLabel}` : `${percent}% — ${sizeLabel}`}
      </p>
    </div>
  )
}
