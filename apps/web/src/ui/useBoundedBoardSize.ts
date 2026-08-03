import { useEffect, useState } from 'preact/hooks'

/** Espejo del breakpoint de `app.css` (`@media (min-width: 768px)`): arriba de este ancho el shell
 * ocupa el viewport y el alto del tablero lo fija el LAYOUT; abajo, la página scrollea y hay que
 * derivarlo de la ventana. Si cambia en el CSS, cambia acá. */
const DESKTOP_MIN_WIDTH = 768

/** Margen vertical reservado SOLO en la ruta mobile, donde el wrapper no está acotado por el layout
 * y medirlo sería circular: barra superior + padding de la vista + colchón. En desktop no se usa
 * ningún número mágico — se mide la caja real (ver abajo). */
const MOBILE_HEIGHT_MARGIN = 96

/** Alto que la barra inferior de destinos (`.appbar`) le quita al viewport.
 *
 * Se MIDE el nodo renderizado en vez de espejar el token, y las dos alternativas fallan por razones
 * distintas: una constante en TS tendría que duplicar el media query (la barra sólo existe en el
 * viewport angosto-y-alto), y `getComputedStyle(root).getPropertyValue('--nav-inset')` devuelve la
 * string `calc(3.5rem + env(safe-area-inset-bottom))` SIN resolver, que no sirve para sumar.
 *
 * Funciona porque `AppFrame` renderiza la barra SIEMPRE y el CSS la apaga con `display: none` donde
 * no corresponde: ahí `offsetHeight` da 0 solo. Es la misma disciplina que el resto del proyecto ya
 * adoptó para el contraste — se mide el DOM pintado, no se recalcula la regla. */
function navBarHeight(): number {
  const el = document.querySelector('.appbar')
  return el instanceof HTMLElement ? el.offsetHeight : 0
}

export interface BoundedBoardSize {
  maxWidth: number
  maxHeight: number
}

/** Mide el espacio disponible para el tablero en el wrapper (`ref`, `.study-board`).
 *
 * El ancho siempre se mide con `ResizeObserver`: el wrapper lo tiene fijado por CSS (`flex: 3 1 …`
 * con `max-width`), nunca por su contenido.
 *
 * El ALTO depende del modo del template:
 *   - **desktop (≥768px)**: `.study-shell` es `height: 100vh; overflow: hidden` y `.study-main` es
 *     `flex: 1 1 auto; min-height: 0`, así que el alto del wrapper lo impone el shell y NO puede
 *     crecer con el goban — medirlo es legítimo y elimina el fudge de "innerHeight menos ~96px",
 *     que adivinaba el alto de la TopBar y del padding. Además el tablero ahora aprovecha el alto
 *     REAL disponible en vez de una estimación conservadora.
 *   - **mobile (<768px)**: la vista se apila y la página scrollea, así que el wrapper SÍ crece con
 *     su contenido: medir su alto sería circular. Ahí se conserva `innerHeight - margen`, más el
 *     alto MEDIDO de la barra inferior de destinos (ver `navBarHeight`).
 *
 * Devuelve `null` hasta la primera medición útil (ancho y alto > 0): `BoundedGoban` no debe montarse
 * con un `maxWidth` de 0. */
export function useBoundedBoardSize(ref: { current: HTMLElement | null }): BoundedBoardSize | null {
  const [size, setSize] = useState<BoundedBoardSize | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function measure(): void {
      const width = el!.offsetWidth
      if (width <= 0) return
      const isDesktop = window.innerWidth >= DESKTOP_MIN_WIDTH
      const height = isDesktop
        ? el!.clientHeight
        : window.innerHeight - MOBILE_HEIGHT_MARGIN - navBarHeight()
      if (height <= 0) return
      setSize((prev) =>
        prev !== null && prev.maxWidth === width && prev.maxHeight === height
          ? prev // misma caja: no re-renderizar (el observer dispara en cada resize del goban)
          : { maxWidth: width, maxHeight: height },
      )
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref])

  return size
}
