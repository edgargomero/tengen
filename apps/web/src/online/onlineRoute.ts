// Ruta de una sala online: `/online/<roomId>`. Se resuelve por `pathname` en `Root` (main.tsx),
// fuera del router Y del gate de WebGPU: jugar online no necesita el motor, así que tiene que abrir
// en un navegador sin WebGPU. Como se llega con navegación completa del documento, el valor no
// cambia mientras la pantalla está montada.

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
