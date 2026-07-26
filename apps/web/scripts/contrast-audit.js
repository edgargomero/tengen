// Auditor de contraste del sistema de diseño (herramienta local, NO parte del producto).
//
// Recorre el DOM RENDERIZADO y compara cada nodo que pinta texto contra su fondo EFECTIVO, apilando
// los alfas de los ancestros hasta llegar a algo opaco. Existe porque calcular sobre la paleta no
// alcanza: tres fallos reales (el botón primario a 2.71, `--tone-success` sobre `--inset`,
// `--tone-warning` sobre `--canvas`) sobrevivieron a una ronda entera de aritmética sobre valores
// sueltos — uno de ellos por un parser de hex que leía los offsets corridos.
//
// Uso: pegar este archivo en la consola de Chrome (o inyectarlo con las devtools) sobre la app
// corriendo, y llamar `__contrastAudit()`. Devuelve el array de fallos: vacío = todo pasa AA.
// Hay que correrlo en CADA estado que se quiera cubrir (pestaña por pestaña, tema por tema): solo
// puede medir lo que está pintado en ese momento.
//
// Umbrales WCAG 2.1 AA: 4.5:1 para texto normal, 3:1 para texto grande (≥24px, o ≥18.66px en
// negrita). El texto deshabilitado está exento por la propia norma y se saltea.
;(function () {
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null
  }

  const luminance = ([r, g, b]) => {
    const c = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }

  const ratio = (a, b) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

  const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => Math.round(v * fg[3] + bg[i] * (1 - fg[3])))

  /** Fondo real detrás de un elemento: sube por los ancestros juntando capas semitransparentes
   * hasta encontrar una opaca, y después las compone de atrás hacia adelante. Sin esto, un texto
   * sobre `--kaya-soft` (14% de alfa) se mediría contra el token y no contra el píxel. */
  function effectiveBackground(el) {
    const layers = []
    let node = el
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c && c[3] > 0) {
        layers.push(c)
        if (c[3] === 1) break
      }
      node = node.parentElement
    }
    const root = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1]
    let base = root.slice(0, 3)
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base)
    return base
  }

  window.__contrastAudit = function contrastAudit(root = document.body) {
    const failures = []
    for (const el of root.querySelectorAll('*')) {
      // Solo nodos que pintan texto PROPIO (no el de sus hijos) y están visibles.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join('')
      if (!own || el.offsetParent === null || el.disabled) continue

      const style = getComputedStyle(el)
      const fg = parse(style.color)
      if (!fg) continue

      const bg = effectiveBackground(el)
      const contrast = ratio(blend(fg, bg), bg)
      const px = parseFloat(style.fontSize)
      const large = px >= 24 || (px >= 18.66 && +style.fontWeight >= 700)
      const min = large ? 3 : 4.5

      if (contrast < min) {
        failures.push({
          text: own.slice(0, 40),
          selector: el.className || el.tagName.toLowerCase(),
          color: style.color,
          background: `rgb(${bg})`,
          ratio: +contrast.toFixed(2),
          required: min,
          fontSize: px,
        })
      }
    }
    return failures
  }
})()
