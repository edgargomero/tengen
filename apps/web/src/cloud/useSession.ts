// Hook Preact sobre el atom `useSession` del cliente vanilla de better-auth (nanostores:
// `.subscribe(cb)` dispara de inmediato con el valor actual y en cada cambio; el primer suscriptor
// activa el fetch perezoso de /api/auth/get-session). El nombre colisiona a propósito con el hook
// de better-auth/react: es la misma superficie, adaptada a Preact.
import { useEffect, useState } from 'preact/hooks'
import { authClient, type SessionUser } from './authClient'

export interface SessionState {
  /** null = sin sesión (o todavía cargando; ver `pending`). */
  user: SessionUser | null
  /** true mientras el get-session inicial está en vuelo — la UI no muestra "Iniciar sesión"
   * hasta saber que de verdad no hay sesión (evita el parpadeo login→avatar al recargar). */
  pending: boolean
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ user: null, pending: true })

  useEffect(() => {
    const unsubscribe = authClient.useSession.subscribe((snapshot) => {
      setState({ user: snapshot.data?.user ?? null, pending: snapshot.isPending })
    })
    return unsubscribe
  }, [])

  return state
}
