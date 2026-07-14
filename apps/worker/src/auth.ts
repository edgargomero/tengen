// better-auth del Worker (Fase 5): factory por-request memoizada + middleware de sesión.
//
// `createAuth(env)` en vez de una instancia de módulo con `import { env } from 'cloudflare:workers'`:
// los tests inyectan el env POR REQUEST (`app.request(path, {}, env)`) y esa inyección es la palanca
// para testear variantes (p.ej. un 429 con `{...env, LIMITER: fake}`). En producción `env` es estable
// por isolate, así que el WeakMap memoiza de facto (una instancia por isolate, cero costo por request).
import { betterAuth } from 'better-auth'
import { createMiddleware } from 'hono/factory'
import type { Env } from './index'

function buildAuth(env: Env) {
  return betterAuth({
      // D1 directo: better-auth ≥1.5 lo detecta por duck-typing (batch/exec/prepare) y usa su
      // dialecto Kysely para D1 (batch() para atomicidad; D1 no tiene transacciones interactivas).
      database: env.DB,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      socialProviders: {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          // drive.file (NO sensible para Google) se pide en el MISMO login inicial: solo archivos
          // creados por tengen, nunca el resto del Drive del usuario (spec §Decisiones 2).
          scope: ['https://www.googleapis.com/auth/drive.file'],
          // offline + consent: garantiza refresh_token SIEMPRE (sin él, la Drive API dejaría de
          // funcionar cuando expire el access token inicial y el backup fallaría en silencio).
          accessType: 'offline',
          prompt: 'select_account consent',
        },
      },
    })
}

type Auth = ReturnType<typeof buildAuth>

const instances = new WeakMap<Env, Auth>()

export function createAuth(env: Env): Auth {
  let auth = instances.get(env)
  if (!auth) {
    auth = buildAuth(env)
    instances.set(env, auth)
  }
  return auth
}

export interface AuthVariables {
  userId: string
}

/** Gate de sesión para las rutas /api/games/*: resuelve la sesión de better-auth desde la cookie
 * (HTTP-only, same-origin) y deja `userId` en las Variables de Hono, o corta con 401. */
export const requireUser = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const auth = createAuth(c.env)
    const session = await auth.api.getSession({ headers: c.req.raw.headers })
    if (!session) return c.json({ error: 'No autenticado' }, 401)
    c.set('userId', session.user.id)
    await next()
  },
)
