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
  /** El UA declara un iPhone/iPod/iPad. */
  isIos: boolean
  /** iPadOS 13+ miente y dice "Macintosh". Un Mac con pantalla táctil no existe, así que
   * `maxTouchPoints > 1` sobre un UA de Mac es, en la práctica, un iPad. */
  iPadOsSuspected: boolean
}

/** En iOS el UA escribe la versión con guiones bajos ("26_0_1"). */
function dotted(version: string): string {
  return version.replace(/_/g, '.')
}

/**
 * El orden de las ramas es lo único delicado acá: el UA de Chrome contiene "Safari", y el de Edge
 * contiene "Chrome" *y* "Safari". Se va de lo más específico a lo más genérico; invertirlo hace que todo
 * se reporte como Safari.
 */
function readBrowser(ua: string): string | undefined {
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
    if (match?.[1]) return `${name} ${match[1]}`
  }
  return undefined
}

export function summarizeUserAgent(input: { userAgent: string; maxTouchPoints?: number }): UserAgentSummary {
  const ua = input.userAgent
  const isIos = /iPhone|iPad|iPod/.test(ua)
  // "CPU iPhone OS 26_0 like Mac OS X" · "CPU OS 26_0" (iPad) · "iPhone OS 18_5".
  const ios = /(?:iPhone )?OS (\d+(?:_\d+)*) like Mac OS X/.exec(ua)?.[1]
  const webkit = /AppleWebKit\/([\d.]+)/.exec(ua)?.[1]

  const summary: UserAgentSummary = {
    isIos,
    iPadOsSuspected: !isIos && /Macintosh/.test(ua) && (input.maxTouchPoints ?? 0) > 1,
  }
  if (ios !== undefined) summary.iosVersion = dotted(ios)
  if (webkit !== undefined) summary.webkitVersion = webkit
  const browser = readBrowser(ua)
  if (browser !== undefined) summary.browser = browser
  return summary
}
