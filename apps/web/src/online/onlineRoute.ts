// Rutas online: una sala `/online/<roomId>` y la pantalla de creación `/online/nueva`. Se resuelven por `pathname` en `Root` (main.tsx),
// fuera del router Y del gate de WebGPU: jugar online no necesita el motor, así que tiene que abrir
// en un navegador sin WebGPU. Como se llega con navegación completa del documento, el valor no
// cambia mientras la pantalla está montada. `isOnlineNewPath` se evalúa ANTES de
// `onlineRoomIdFromPath`: si no, "nueva" se tomaría como roomId.

/** `/online/nueva` (con o sin barra final): crear una sala sin pasar por el gate de WebGPU. */
export function isOnlineNewPath(pathname: string): boolean {
  return /^\/online\/nueva\/?$/.test(pathname)
}

/** El roomId de `/online/<id>` (con o sin barra final), o `null` si el path no es de una sala. */
export function onlineRoomIdFromPath(pathname: string): string | null {
  const m = /^\/online\/([^/]+)\/?$/.exec(pathname)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return m[1]!
  }
}
