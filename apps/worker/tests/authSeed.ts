// Seed de sesiones para tests del worker (Fase 5): inserta user/session/account DIRECTO en D1 y
// fabrica la cookie firmada, sin pasar por el flujo OAuth de Google (que no corre en CI).
//
// ⚠️ Acoplado a internals VERIFICADOS de better-auth@1.6.23 (riesgo (a) del plan, asumido a
// conciencia — si un upgrade de better-auth rompe estos tests, revisar estos tres puntos):
//   1. Cookie `better-auth.session_token` = encodeURIComponent(`${token}.${firma}`), donde la firma
//      es HMAC-SHA256(secret, token) en base64 ESTÁNDAR con padding (btoa — better-call
//      crypto.ts `makeSignature`; el verificador exige length 44 terminando en '='), NO base64url.
//   2. Columnas date de better-auth en SQLite/D1 = ISO strings (adapter factory: supportsDates
//      false → toISOString()); booleans = 0/1.
//   3. getAccessToken NO llama a Google si accessTokenExpiresAt está a >5s del vencimiento — por
//      eso la account seedeada lleva un token vigente 1h: los tests de Drive usan ese token tal
//      cual, sin refresh.
import { env } from 'cloudflare:test'

export interface SeededUser {
  userId: string
  /** Valor listo para el header `Cookie` de un request autenticado. */
  cookie: string
  /** Access token de Google que getAccessToken va a devolver para esta cuenta. */
  googleAccessToken: string
}

async function signSessionToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

/** Crea un usuario con sesión activa y cuenta de Google vigente. `suffix` distingue usuarios
 * dentro de un mismo test (los ids/emails deben ser únicos por la constraint de user.email). */
export async function seedUser(suffix = 'a'): Promise<SeededUser> {
  const userId = `user-${suffix}`
  const sessionToken = `session-token-${suffix}`
  const googleAccessToken = `google-access-${suffix}`
  const now = new Date()
  const nowIso = now.toISOString()
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString()
  const inOneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    ).bind(userId, `Test ${suffix}`, `${suffix}@test.dev`, nowIso, nowIso),
    env.DB.prepare(
      `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    ).bind(`session-${suffix}`, inOneWeek, sessionToken, nowIso, nowIso, userId),
    env.DB.prepare(
      `INSERT INTO account (id, accountId, providerId, userId, accessToken, refreshToken, idToken,
                            accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt)
       VALUES (?, ?, 'google', ?, ?, ?, NULL, ?, NULL, ?, NULL, ?, ?)`,
    ).bind(
      `account-${suffix}`,
      `google-sub-${suffix}`,
      userId,
      googleAccessToken,
      `google-refresh-${suffix}`,
      inOneHour,
      'https://www.googleapis.com/auth/drive.file',
      nowIso,
      nowIso,
    ),
  ])

  const signature = await signSessionToken(sessionToken, env.BETTER_AUTH_SECRET)
  const cookie = `better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`
  return { userId, cookie, googleAccessToken }
}
