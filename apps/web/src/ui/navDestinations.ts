// Los destinos del marco de navegación, como DATOS y no como estructura.
//
// Por qué un módulo propio y no un array dentro de `AppFrame`: el marco se dibuja en dos formas de
// viewport (conmutador arriba en el ancho, barra abajo en el angosto-y-alto) y las dos tienen que
// ofrecer LOS MISMOS destinos. Con la lista acá, agregar o quitar uno es una línea y las dos formas
// cambian juntas; con la lista inline serían dos sitios que se desincronizan en silencio.
//
// El corolario práctico es que este archivo absorbe los cambios de producto que están en
// evaluación: si el login se va, "Mis partidas" se borra de un array y la navegación no se entera.
// Todo acá es puro (sin DOM, sin router), así que se testea en Node.

export interface NavDestination {
  id: string
  label: string
  path: string
}

/** Los destinos que el marco ofrece, en el orden en que se dibujan.
 *
 * "Mis partidas" va SIEMPRE, con o sin sesión: sin ella lleva a la pantalla que ya existe e invita
 * a loguearse. Ocultarlo haría saltar el layout de 2 a 3 celdas al iniciar sesión — un marco que
 * cambia de forma según el estado de la cuenta deja de ser un marco. */
export const NAV_DESTINATIONS: readonly NavDestination[] = [
  { id: 'jugar', label: 'Jugar', path: '/jugar' },
  { id: 'analizar', label: 'Analizar', path: '/analizar' },
  { id: 'partidas', label: 'Mis partidas', path: '/partidas' },
]

/** Etiqueta de UBICACIÓN ("dónde estás"), que no siempre coincide con la del destino: `/` no es un
 * destino del marco pero sí un lugar, y `/diagnostico` es un lugar al que el marco no lleva (vive
 * fuera del router a propósito — ver la nota de alcance en `AppFrame.tsx`). */
const LOCATION_LABELS: Readonly<Record<string, string>> = {
  '/': 'Inicio',
  '/jugar': 'Jugar',
  '/analizar': 'Analizar',
  '/partidas': 'Mis partidas',
  '/diagnostico': 'Diagnóstico',
}

/** Ruta desconocida = lo que el router realmente pinta ahí. `<ModeMenu path="/" default />` hace que
 * cualquier URL sin ruta propia caiga en el menú, así que la ubicación honesta es la del menú —
 * nunca una cadena vacía, que dejaría la marca colgando de un separador sin nada al lado. */
const FALLBACK_LABEL = LOCATION_LABELS['/']!

/** Reduce lo que devuelve `getCurrentUrl()` (pathname + query) a la ruta con la que comparar.
 *
 * Normaliza tres cosas que sí llegan en producción: la query (`?code=…` del retorno de OAuth), la
 * barra final (`/jugar/` es la misma pantalla que `/jugar`) y el hash. Sin esto, volver del login
 * de Google mostraría la ubicación equivocada y ningún destino marcado como activo. */
export function normalizePath(url: string): string {
  const path = url.split('#')[0]!.split('?')[0]!
  if (path === '' || path === '/') return '/'
  return path.endsWith('/') ? path.slice(0, -1) : path
}

/** La etiqueta de "dónde estás" que va junto a la marca. */
export function locationLabelFor(path: string): string {
  return LOCATION_LABELS[normalizePath(path)] ?? FALLBACK_LABEL
}

/** El destino en el que estás parado, o `undefined` si la ruta no es ninguno (el menú, una ruta
 * desconocida). `undefined` es un estado legítimo del marco, no un error: en el menú ningún destino
 * se marca como activo. */
export function activeDestinationFor(path: string): NavDestination | undefined {
  const normalized = normalizePath(path)
  return NAV_DESTINATIONS.find((d) => d.path === normalized)
}
