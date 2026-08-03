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

/** Desde esta versión mayor del SISTEMA, WKWebView también expone WebGPU — o sea, cualquier navegador
 * del dispositivo sirve. Por debajo, sólo Safari. */
export const IOS_WEBGPU_ALL_BROWSERS = 26

/**
 * Desde esta versión mayor de SAFARI hay WebGPU por defecto.
 *
 * Es un umbral SEPARADO del anterior a propósito, y eso lo enseñó un dispositivo real: un iPhone 12
 * reportó **Safari 26.5.2 sobre iOS 18.7**, con WebGPU funcionando. Las dos versiones van por caminos
 * distintos, así que tratarlas como una sola —el error que tenía este archivo— hace que a alguien cuyo
 * Safari YA sirve se le diga que necesita actualizar el sistema.
 */
export const SAFARI_WEBGPU_DEFAULT = 26

/** Versión mayor declarada, o `null` si no viene o no es un número. */
function major(version: string | undefined): number | null {
  if (version === undefined) return null
  const parsed = Number.parseInt(version, 10)
  return Number.isNaN(parsed) ? null : parsed
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

  // Un UA congelado NO significa iOS 18: significa iOS 26 o superior, porque el congelamiento arranca
  // justamente en 26. Leer el número al pie de la letra mandaría a actualizar un sistema que ya está al
  // día — el error que este dispositivo destapó.
  const iosMajor = ua.iosVersionFrozen ? IOS_WEBGPU_ALL_BROWSERS : major(ua.iosVersion)
  const iosVersion = ua.iosVersion ?? 'esta versión'

  if (iosMajor !== null && iosMajor >= IOS_WEBGPU_ALL_BROWSERS) {
    // Con un sistema 26+ cualquier navegador del dispositivo debería exponer WebGPU: si igual falla, el
    // dato está en el diagnóstico y es información nueva para nosotros, no un problema de configuración.
    // Nunca se cita el número crudo cuando está congelado: sería repetirle al usuario un "18.7" que no
    // es su versión.
    const label = ua.iosVersionFrozen ? 'iOS 26 o superior' : `iOS ${iosVersion}`
    return [
      `Este dispositivo tiene ${label}, que ya incluye WebGPU en todos sus navegadores, así que algo más está fallando.`,
      'Abre el diagnóstico y comparte el resultado: ahí está el motivo exacto.',
    ]
  }

  const lines: string[] = []
  if (isSafari(ua.browser)) {
    // En Safari lo que manda es la versión de SAFARI, no la del sistema. Un iPhone 12 real corre Safari
    // 26.5.2 sobre iOS 18.7 y ahí WebGPU funciona: decirle "actualiza a iOS 26" sería mandarlo a hacer
    // algo que no cambia nada.
    const safariMajor = major(ua.browserVersion)
    lines.push('Estás en Safari, que es el navegador correcto en un iPhone o iPad.')
    if (safariMajor !== null && safariMajor >= SAFARI_WEBGPU_DEFAULT) {
      lines.push(
        `Tu Safari (${ua.browserVersion}) ya trae WebGPU, así que el problema es otro: comparte el diagnóstico completo.`,
      )
    } else {
      lines.push(
        `Tu Safari es la versión ${ua.browserVersion ?? '(no declarada)'} y WebGPU viene activado desde Safari ${SAFARI_WEBGPU_DEFAULT}. ` +
          'Actualiza Safari, o prueba a habilitarlo en Ajustes → Safari → Avanzado → Funciones experimentales.',
      )
    }
  } else {
    // El caso del iPhone 12 con iOS 18.7: Chrome iOS reporta que no existe `navigator.gpu`, aunque el
    // Safari del MISMO teléfono sí lo tenga.
    lines.push('En iPhone y iPad, abre esta página en Safari.')
    lines.push(
      `Chrome, Edge y Firefox en iOS usan WKWebView, que lo trae el sistema y no expone WebGPU hasta iOS ${IOS_WEBGPU_ALL_BROWSERS} — este dispositivo tiene iOS ${iosVersion}. El Safari del mismo teléfono sí puede: no es una limitación del hardware.`,
    )
  }
  return lines
}
