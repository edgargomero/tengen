// Qué decirle a alguien cuyo dispositivo no pasa el gate de WebGPU. Puro, con test.
//
// Existe porque el cartel genérico ("abre esta página en Chrome o Edge") es, en un iPhone, el consejo
// exactamente CONTRARIO al correcto — y eso quedó confirmado por el volcado de un iPhone 12 real con iOS
// 18.7.8, donde Chrome iOS reporta `navigator.gpu: no` en los dos scopes.
//
// ── El detalle que se nos había pasado ─────────────────────────────────────────────────────────
// En iOS todos los navegadores usan WebKit, y de ahí se sigue la conclusión tentadora de que Safari y
// Chrome son la MISMA señal. Para WebGPU es falso: Chrome, Edge y Firefox en iOS corren sobre
// **WKWebView**, y las feature flags de Safari no lo alcanzan. Un ingeniero de Apple en los foros
// oficiales (developer.apple.com/forums/thread/770862): *"these feature flags only impact Safari and not
// WebKit generally. For WKWebView, the feature will work when its enabled by default"* — lo que ocurrió
// en iOS 26. Antes de eso, en el mismo dispositivo y el mismo día, Safari puede tener WebGPU y Chrome no.
//
// Por eso el consejo se parte por plataforma Y por navegador: mandar a alguien a Chrome en un iPhone es
// mandarlo al único navegador de ese aparato que no puede funcionar.
import type { UserAgentSummary } from './userAgent'

/** Desde esta versión mayor de iOS, WKWebView también expone WebGPU — o sea, cualquier navegador del
 * dispositivo sirve. Por debajo, sólo Safari (y según la versión, tras una feature flag). */
export const IOS_WEBGPU_ALL_BROWSERS = 26

/** Versión mayor de iOS declarada, o `null` si el UA no la trae o no es un número. */
function iosMajor(version: string | undefined): number | null {
  if (version === undefined) return null
  const major = Number.parseInt(version, 10)
  return Number.isNaN(major) ? null : major
}

function isSafari(browser: string | undefined): boolean {
  // "Safari 26.0" sí; "Chrome iOS 150…" y "Firefox iOS …" no. `startsWith` y no `includes` porque el
  // nombre de los navegadores de iOS contiene "iOS", no "Safari" (ver `readBrowser`).
  return browser !== undefined && browser.startsWith('Safari')
}

/**
 * Consejo accionable, en frases sueltas para que la UI las pinte como párrafos. La primera línea es la
 * acción; las siguientes, el porqué o el plan B.
 *
 * Nunca promete que algo va a funcionar: en un iPhone por debajo de iOS 26 sabemos que Chrome NO puede,
 * pero que Safari sí pueda depende de la versión y de una feature flag que no podemos leer desde acá. El
 * texto manda a probar, no afirma un resultado.
 */
export function webGpuAdvice(ua: UserAgentSummary): string[] {
  const onApple = ua.isIos || ua.iPadOsSuspected
  if (!onApple) {
    return ['Abre esta página en Chrome o Edge recientes, con WebGPU habilitado.']
  }

  const major = iosMajor(ua.iosVersion)
  const version = ua.iosVersion ?? 'esta versión'

  if (major !== null && major >= IOS_WEBGPU_ALL_BROWSERS) {
    // Con iOS 26+ cualquier navegador del dispositivo debería exponer WebGPU: si igual falla, el dato
    // está en el diagnóstico y es información nueva para nosotros, no un problema de configuración.
    return [
      `Este dispositivo tiene iOS ${version}, que ya incluye WebGPU en todos sus navegadores, así que algo más está fallando.`,
      'Abre el diagnóstico y comparte el resultado: ahí está el motivo exacto.',
    ]
  }

  const lines: string[] = []
  if (isSafari(ua.browser)) {
    lines.push('Estás en Safari, que es el navegador correcto en un iPhone o iPad.')
    lines.push(
      'Prueba habilitando WebGPU en Ajustes → Safari → Avanzado → Funciones experimentales. Si no aparece ahí, hace falta iOS 26 o superior.',
    )
  } else {
    // El caso del iPhone 12 con iOS 18.7.8: Chrome iOS reporta que no existe `navigator.gpu`.
    lines.push('En iPhone y iPad, abre esta página en Safari.')
    lines.push(
      `Chrome, Edge y Firefox en iOS usan WKWebView, que no expone WebGPU hasta iOS 26 — y este dispositivo tiene iOS ${version}. No es una limitación del hardware.`,
    )
  }
  return lines
}
