// Cliente de better-auth (Fase 5): singleton de módulo, cliente VANILLA (no el de React — Preact
// consume el atom de nanostores vía useSession.ts). Sin baseURL: el Worker sirve SPA y API desde
// el mismo origen (tengen.kntor.io o wrangler dev :8787), así que /api/auth/* resuelve same-origin
// con cookies HTTP-only — sin CORS ni tokens en localStorage.
import { createAuthClient } from 'better-auth/client'

export const authClient = createAuthClient()

/** Usuario de la sesión activa (subconjunto que consume la UI). */
export interface SessionUser {
  id: string
  email: string
  name: string
  image?: string | null
}

export function signInWithGoogle(): void {
  // callbackURL: al volver del consent de Google se aterriza en el menú, ya logueado.
  void authClient.signIn.social({ provider: 'google', callbackURL: '/' })
}

export function signOut(): void {
  void authClient.signOut()
}
