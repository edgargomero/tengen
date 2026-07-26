// Estado de conexión del navegador. Deliberadamente simple: `navigator.onLine` miente hacia el lado
// optimista (puede decir `true` con una wifi sin salida a internet), pero nunca hacia el pesimista —
// si dice `false`, seguro no hay red. Como el indicador solo sirve para explicar por qué no se
// guarda en la nube, ese sesgo es el correcto: nunca alarma de más.
import { useEffect, useState } from 'preact/hooks'

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    // Re-sincroniza al montar por si el estado cambió entre el render inicial y el efecto.
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
