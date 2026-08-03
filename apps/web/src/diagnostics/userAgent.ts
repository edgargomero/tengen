// Lectura del user agent: navegador, versión de iOS y versión de WebKit. Puro, con test.
//
// Por qué se parsea algo que ya viaja crudo en el volcado: la pregunta abierta de este diagnóstico es de
// versiones ("¿WebGPU en iOS exige iPhone 15 Pro? ¿desde qué iOS?") y un UA crudo de 140 caracteres
// obliga a leerlo a ojo, en un teléfono, cada vez. El UA completo se manda igual — esto no lo reemplaza,
// lo resume.
//
// No es sniffing para decidir comportamiento: nada de la app rutea por estos valores. Es un informe.

export interface UserAgentSummary {
  /** Versión de iOS/iPadOS declarada ("26.0"). Ausente si el UA no la declara. */
  iosVersion?: string
  /** Versión del motor WebKit ("605.1.15"). En iOS es la de TODOS los navegadores. */
  webkitVersion?: string
  /** Navegador y versión tal como el propio UA los declara ("Safari 26.0"). */
  browser?: string
  /** Sólo la versión del navegador ("26.5.2"). Separada de `browser` porque hay que COMPARARLA: en iOS,
   * la versión de Safari y la del sistema van por caminos distintos — un iPhone 12 real reportó Safari
   * 26.5.2 corriendo sobre iOS 18.7, con WebGPU funcionando. Quien decide si hay WebGPU en Safari es la
   * versión de Safari; la del sistema sólo manda sobre WKWebView (Chrome, Edge, Firefox). */
  browserVersion?: string
  /** El UA declara un iPhone/iPod/iPad. */
  isIos: boolean
  /** iPadOS 13+ miente y dice "Macintosh". Un Mac con pantalla táctil no existe, así que
   * `maxTouchPoints > 1` sobre un UA de Mac es, en la práctica, un iPad. */
  iPadOsSuspected: boolean
  /**
   * `true` cuando `iosVersion` NO es la versión real del sistema sino el valor congelado de Apple.
   *
   * Desde iOS 26, Safari deja de publicar la versión del sistema y la fija en `18_7` para siempre, como
   * medida anti-fingerprinting. La consecuencia es contraintuitiva y hay que decirla al derecho: **ver
   * exactamente "18.7" junto a un Safari 26+ es evidencia de que el sistema es iOS 26 o SUPERIOR**, no
   * de que sea viejo. Es el mismo truco que Safari de escritorio lleva años haciendo con
   * "Mac OS X 10_15_7" (Catalina, 2019) en Macs modernos.
   */
  iosVersionFrozen: boolean
}

/** El valor exacto en el que Apple congeló la versión del sistema en el UA de Safari. */
export const FROZEN_IOS_VERSION = '18.7'
/** Desde esta versión mayor de Safari rige el congelamiento (es decir, desde iOS 26). */
export const FROZEN_SINCE_SAFARI = 26

/** En iOS el UA escribe la versión con guiones bajos ("26_0_1"). */
function dotted(version: string): string {
  return version.replace(/_/g, '.')
}

/** Versión mayor de un "26.5.2", o 0 si no se puede leer. */
function majorOf(version: string): number {
  const parsed = Number.parseInt(version, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * El orden de las ramas es lo único delicado acá: el UA de Chrome contiene "Safari", y el de Edge
 * contiene "Chrome" *y* "Safari". Se va de lo más específico a lo más genérico; invertirlo hace que todo
 * se reporte como Safari.
 */
function readBrowser(ua: string): { name: string; version: string } | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/Edg(?:iOS|A)?\/([\d.]+)/, 'Edge'],
    [/CriOS\/([\d.]+)/, 'Chrome iOS'],
    [/FxiOS\/([\d.]+)/, 'Firefox iOS'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    // Safari declara su versión de producto en `Version/`, no en el token `Safari/` (que es de WebKit).
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ]
  for (const [pattern, name] of patterns) {
    const match = pattern.exec(ua)
    if (match?.[1]) return { name, version: match[1] }
  }
  return undefined
}

export function summarizeUserAgent(input: { userAgent: string; maxTouchPoints?: number }): UserAgentSummary {
  const ua = input.userAgent
  const isIos = /iPhone|iPad|iPod/.test(ua)
  // "CPU iPhone OS 26_0 like Mac OS X" · "CPU OS 26_0" (iPad) · "iPhone OS 18_5".
  const ios = /(?:iPhone )?OS (\d+(?:_\d+)*) like Mac OS X/.exec(ua)?.[1]
  const webkit = /AppleWebKit\/([\d.]+)/.exec(ua)?.[1]

  const browser = readBrowser(ua)
  const iosVersion = ios === undefined ? undefined : dotted(ios)

  const summary: UserAgentSummary = {
    isIos,
    iPadOsSuspected: !isIos && /Macintosh/.test(ua) && (input.maxTouchPoints ?? 0) > 1,
    // El congelamiento se reconoce por la COMBINACIÓN, no por el número suelto: el valor fijo exacto
    // ("18.7", sin tercer componente) junto a un Safari que ya es 26+. Un iPhone que de verdad corre
    // iOS 18.7 lleva un Safari 18.x, así que no cae acá.
    iosVersionFrozen:
      iosVersion === FROZEN_IOS_VERSION && browser?.name === 'Safari' && majorOf(browser.version) >= FROZEN_SINCE_SAFARI,
  }
  if (iosVersion !== undefined) summary.iosVersion = iosVersion
  if (webkit !== undefined) summary.webkitVersion = webkit
  if (browser !== undefined) {
    summary.browser = `${browser.name} ${browser.version}`
    summary.browserVersion = browser.version
  }
  return summary
}
