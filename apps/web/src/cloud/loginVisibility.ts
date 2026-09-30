// Login de Google OCULTO (decisión de Edgar, 2026-09-30): la UI no lo ofrece en ningún lado. El
// backend (better-auth, D1, /api/games) y las sesiones que ya existen siguen intactos; volver a
// mostrarlo es poner esto en `true`. Módulo sin dependencias para que `navDestinations` siga puro.
export const GOOGLE_LOGIN_VISIBLE = false
