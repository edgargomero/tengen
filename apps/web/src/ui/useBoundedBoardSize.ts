import { useEffect, useState } from 'preact/hooks'

/** Margen vertical reservado fuera del tablero (panel/nav del navegador) al derivar `maxHeight` de
 * `window.innerHeight` — evita que el tablero quede pegado al borde en apaisado. */
const HEIGHT_MARGIN = 64

export interface BoundedBoardSize {
  maxWidth: number
  maxHeight: number
}

/** Mide el ancho disponible del wrapper (`ref`, p.ej. `.play-board`/`.analyze-board`) vía
 * `ResizeObserver` y el alto disponible vía `window.innerHeight` — dos mecanismos separados a
 * propósito: el wrapper tiene su ancho fijado por CSS (no por su contenido), pero SÍ crece con el
 * tablero en el eje vertical, así que medir su alto sería circular. Devuelve `null` hasta la
 * primera medición útil (ancho > 0): `BoundedGoban` no debe montarse con un `maxWidth` de 0. */
export function useBoundedBoardSize(ref: { current: HTMLElement | null }): BoundedBoardSize | null {
  const [size, setSize] = useState<BoundedBoardSize | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function measure(): void {
      const width = el!.offsetWidth
      if (width <= 0) return
      setSize({ maxWidth: width, maxHeight: Math.max(window.innerHeight - HEIGHT_MARGIN, 1) })
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
