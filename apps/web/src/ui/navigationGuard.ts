// Contexto mínimo para que una VISTA pueda correr algo justo antes de que el MARCO navegue fuera.
//
// Existe por un solo caso real, y es un caso donde el atajo obvio falla en silencio: `AnalyzeView`
// dispara `cloud.finish()` al salir (el backup a Drive — Analizar no tiene un "fin de partida"
// natural, así que el trigger es la salida). Hasta ahora ese hilo colgaba del `onLeave` de la
// `TopBar`, que la propia vista montaba; con la navegación mudada al marco, el hilo se corta.
//
// Por qué NO el atajo de mover `cloud.finish()` al cleanup de un `useEffect` de la vista:
//
//     gameSync.ts:73   finish(): void {
//     gameSync.ts:74     if (this.disposed) return
//
// `useCloudSync` registra `sync.dispose()` en un `useEffect` DENTRO del mismo componente, y los
// cleanups corren en el orden en que se declararon los efectos: el `dispose()` del hook corre antes
// que cualquier cleanup que la vista declare después de llamarlo. `finish()` entraría ya dispuesto y
// retornaría sin hacer nada — el backup dejaría de ocurrir sin un solo error, que es el peor modo de
// fallo posible. El guard tiene que correr con el componente AÚN MONTADO, que es lo que hacía
// `onLeave` y lo que este contexto conserva.
//
// Alcance declarado: sólo cubre la navegación que pasa por el marco. El botón atrás del navegador
// (popstate) no lo dispara — igual que no disparaba `onLeave`, así que no es una regresión.
//
// Es el ÚNICO `createContext` de la app. Se introduce acá porque el dato que hay que compartir
// (una función que registra la vista y ejecuta el marco) cruza el árbol al revés: de un hijo
// arbitrariamente profundo hacia un ancestro que ni siquiera sabe qué ruta está montada.
import { createContext } from 'preact'
import { useContext, useEffect, useRef } from 'preact/hooks'

export interface NavigationGuardRegistry {
  /** Registra un cleanup y devuelve su función de baja (calza con el cleanup de `useEffect`). */
  register(fn: () => void): () => void
}

/** Fuera de un proveedor no hay marco que interceptar, así que registrar es un no-op. Un default
 * inerte y no un throw: un componente tiene que poder montarse en un test aislado sin el marco. */
const NO_GUARD: NavigationGuardRegistry = { register: () => () => {} }

export const NavigationGuardContext = createContext<NavigationGuardRegistry>(NO_GUARD)

/** Registra `onLeave` mientras el componente esté montado.
 *
 * `onLeave` puede ser una closure nueva en cada render (lo normal: captura estado de la vista) sin
 * provocar re-registros — lo que se registra es una función estable que lee la última versión de un
 * ref. Sin ese indirecto, la dependencia del efecto sería una identidad que cambia siempre y el
 * par registrar/dar de baja correría en cada render. */
export function useNavigationGuard(onLeave: () => void): void {
  const registry = useContext(NavigationGuardContext)
  const latest = useRef(onLeave)
  latest.current = onLeave
  useEffect(() => registry.register(() => latest.current()), [registry])
}
