// Etiquetas de fuerza amigables para el oponente KataGo. El usuario elige "visitas" de MCTS (jerga
// que no le dice nada); aquí las traducimos a "Fuerza baja/media/alta". Único origen de verdad,
// compartido por el dropdown de nueva partida (NewGameForm) y la etiqueta del oponente durante la
// partida + nombre del SGF exportado (PlayView). El `value` real que consume el motor sigue siendo
// el número de visitas; estas etiquetas son puramente presentacionales.
//
// ── Lo que se OFRECE depende del dispositivo; lo que se ETIQUETA, no ───────────────────────────
// Son dos preguntas distintas y separarlas es la decisión de diseño de este archivo:
//
//   `kataStrengthOptionsFor` (qué ofrece el formulario) → depende del user agent.
//   `kataStrengthLabel`      (cómo se llama un valor)   → depende SÓLO del número de visitas.
//
// Si la etiqueta dependiera del dispositivo, una partida guardada con 200 visitas se llamaría
// distinto según dónde la abras — y esta etiqueta alimenta el nombre del SGF exportado.
import { summarizeUserAgent } from '../diagnostics/userAgent'

/**
 * Un nivel de fuerza ofrecible: las visitas que corre el MCTS y cómo se le dice al usuario.
 *
 * Dos rótulos porque hay dos contextos, no por gusto: `label` es el nombre CANÓNICO (ficha del
 * oponente durante la partida, nombre del SGF exportado) y tiene que sostenerse solo; `short` es el
 * del botón dentro de un grupo ya rotulado "FUERZA", donde repetir la palabra la diría tres veces.
 */
export interface StrengthPreset {
  readonly visits: number
  readonly label: string
  readonly short: string
}

/** Presets ofrecidos en el formulario de "Modo Jugar". Orden ascendente de fuerza (= de visitas). */
export const KATA_STRENGTH_PRESETS = [
  { visits: 50, label: 'Fuerza baja', short: 'Baja' },
  { visits: 200, label: 'Fuerza media', short: 'Media' },
  { visits: 500, label: 'Fuerza alta', short: 'Alta' },
] as const

/**
 * El preset más próximo a un número de visitas arbitrario. No asume que `visits` sea uno de los 3:
 * partidas guardadas (D1) o el clamp de `validateConfig` (`visits < 1 → 1`, sin techo) pueden traer
 * cualquier valor, así que bucketizamos por cercanía (equivale a partir por los puntos medios: 125
 * entre baja↔media, 350 entre media↔alta). En un empate gana el más bajo, que es determinista.
 */
function nearestPreset(visits: number): StrengthPreset {
  return KATA_STRENGTH_PRESETS.reduce((best, p) =>
    Math.abs(visits - p.visits) < Math.abs(visits - best.visits) ? p : best,
  )
}

/** Etiqueta canónica de fuerza para un número de visitas arbitrario. 50/200/500 devuelven la suya
 *  exacta; cualquier otro valor cae en el preset más próximo. */
export function kataStrengthLabel(visits: number): string {
  return nearestPreset(visits).label
}

/**
 * Visitas del único preset que se ofrece en móvil.
 *
 * El motor corre a ~1,5 visitas/s en un iPhone 12 Pro Max (medido, ledger 2026-08-03), así que 25
 * visitas son ~15 s por jugada; 50 serían ~30 s y 200 —el default que había— dos minutos enteros.
 * Que el oponente sea MÁS DÉBIL casi no importa: el duelo de calibración midió que a 25 visitas
 * KataGo no regala más de 1,7 puntos en su peor turno de 200, sin un solo colapso táctico.
 *
 * Se exporta porque es lo que aserta el test cruzado contra `modelVariantFor` (ver más abajo), no
 * porque nadie de la app lo necesite suelto.
 */
export const MOBILE_VISITS = 25

/** Android no lo cubre `summarizeUserAgent` (que existe para diagnosticar WebGPU en iOS), así que se
 *  reconoce acá. El token `Android` aparece en el UA de Chrome, Firefox y Samsung Internet. */
const ANDROID = /Android/

/**
 * Criterio de "esto es un móvil" para la FUERZA. Deliberadamente NO es el mismo símbolo que usa
 * `models/modelVariant.ts` para la PRECISIÓN, aunque diga lo mismo y se apoye en la misma pieza ya
 * probada (`summarizeUserAgent`, llamada igual: sin `maxTouchPoints`).
 *
 * Por qué duplicar en vez de extraer un módulo compartido: `modelVariant.ts` decide qué binario se
 * descarga y su modo de fallo NO es suave — si el hilo principal y el worker resuelven distinto, el
 * worker busca en OPFS un archivo que nadie bajó y el motor no arranca. Refactorizar ese archivo
 * para ganar elegancia en un feature no relacionado es un mal negocio. Acá, en cambio, divergir
 * daría un aparato con presets de escritorio y modelo de móvil (o al revés): funciona igual, sólo
 * es subóptimo. Degradación suave contra app que no arranca; no merecen la misma protección.
 *
 * El acoplamiento se hace en el TEST, no en el código: `opponentStrength.test.ts` verifica sobre la
 * batería de UA reales que este criterio y `modelVariantFor(ua) === 'mixed16'` coinciden. Si alguien
 * cambia uno de los dos, el test avisa — sin que ninguno de los dos archivos dependa del otro en
 * tiempo de ejecución.
 */
function isMobileForStrength(userAgent: string): boolean {
  const { isIos } = summarizeUserAgent({ userAgent })
  return isIos || ANDROID.test(userAgent)
}

/** En móvil se ofrece UNA sola fuerza. Sus rótulos se DERIVAN del preset más próximo en vez de
 *  escribirse a mano, para que el nombre del preset ofrecido y el que muestra la partida en curso no
 *  puedan divergir nunca (25 bucketiza a "Fuerza baja": |25−50| < |25−200|). */
const MOBILE_PRESETS = [{ ...nearestPreset(MOBILE_VISITS), visits: MOBILE_VISITS }] as const

/**
 * Presets que el formulario ofrece en un dispositivo con este user agent. Pura y total.
 *
 * El tipo de retorno es una tupla NO VACÍA a propósito: `NewGameForm` usa el primer elemento como
 * valor inicial del formulario, y con `noUncheckedIndexedAccess` un `readonly StrengthPreset[]`
 * obligaría a un fallback para un caso que no existe.
 *
 * Móvil → sólo la fuerza baja de 25 visitas. Más opciones sería ofrecer esperas de 2 y 5,5 minutos
 * por jugada, que no es una elección sino una trampa. Escritorio → los tres de siempre.
 */
export function kataStrengthOptionsFor(userAgent: string): readonly [StrengthPreset, ...StrengthPreset[]] {
  return isMobileForStrength(userAgent) ? MOBILE_PRESETS : KATA_STRENGTH_PRESETS
}

/**
 * Los presets de ESTE dispositivo. Mismo patrón que `currentModelVariant()`: la función pura es la
 * que se testea y ésta es el único punto que lee el global.
 *
 * Se calcula en cada llamada, nunca al importar el módulo: cachearlo a nivel de módulo congelaría el
 * user agent al momento del import y haría que dos tests del mismo archivo se contradijeran según el
 * orden. Fuera de un navegador (Node) devuelve los presets de escritorio en vez de lanzar.
 */
export function kataStrengthOptions(): readonly [StrengthPreset, ...StrengthPreset[]] {
  if (typeof navigator === 'undefined') return KATA_STRENGTH_PRESETS
  return kataStrengthOptionsFor(navigator.userAgent)
}
