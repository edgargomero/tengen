// Indicador de estado del guardado en la nube (Fase 5): presentación pura, visible solo con
// sesión activa (el caller gatea con cloud.active). 'idle' no pinta nada — antes del primer save
// no hay nada que informar. El error ofrece reintento manual además del backoff automático
// ("sin feedback silencioso", decisión de la ronda de quick-wins).
import type { SyncStatus } from './gameSync'

interface SyncBadgeProps {
  status: SyncStatus
  onRetry(): void
}

export function SyncBadge({ status, onRetry }: SyncBadgeProps) {
  if (status === 'idle') return null
  if (status === 'error') {
    return (
      <p class="sync-badge sync-error">
        Sin conexión con la nube; reintentando.{' '}
        <button onClick={onRetry}>Reintentar ahora</button>
      </p>
    )
  }
  return (
    <p class={`sync-badge sync-${status}`}>
      {status === 'saving' ? 'Guardando en la nube…' : 'Guardado en la nube'}
    </p>
  )
}
