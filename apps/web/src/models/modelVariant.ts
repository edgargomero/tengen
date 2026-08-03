// Qué variante de precisión sirve este dispositivo. Puro + un único punto que lee el global.
//
// ── El riesgo que gobierna el diseño de este archivo ───────────────────────────────────────────
// La variante se necesita en DOS scopes que no comparten memoria: el hilo principal DESCARGA
// (`ModelGate` → `ensureModel`) y el worker LEE de OPFS por `opfsName` (`appFactory`). Si los dos
// resuelven distinto, el worker busca un archivo que nadie descargó y el motor no arranca — un
// fallo que sólo aparece en los dispositivos donde el criterio dé distinto, o sea el peor tipo de
// fallo: invisible en desarrollo, seguro en producción.
//
// Dos decisiones lo hacen imposible por construcción:
//
// 1. `modelVariantFor` toma SÓLO la cadena de user agent. Nada de `maxTouchPoints`: `WorkerNavigator`
//    expone `userAgent` pero NO `maxTouchPoints`, así que cualquier criterio que lo use daría
//    distinto en el worker (`undefined` → 0) sin que `tsc` lo note — apps/web tipa `navigator` con
//    la lib DOM, que promete un campo que en el worker no existe. `navigator.userAgent`, en cambio,
//    es exactamente el mismo string en ambos scopes.
// 2. `currentModelVariant()` es el ÚNICO lugar que lee el global. Los dos call sites la llaman sin
//    argumentos, así que no hay ningún input que se pueda pasar mal: no existe la pregunta
//    "¿le pasaron lo mismo los dos?".
//
// ── El criterio, y su límite conocido ──────────────────────────────────────────────────────────
// Móvil → mixto; escritorio → fp32. Por DISPOSITIVO, no por navegador: los dos navegadores del
// mismo iPhone mueren en las mismas ~80 inferencias (Safari 26.5.2 y Chrome iOS 150), así que el
// navegador está descartado como variable.
//
// Límite conocido y aceptado: **un iPad con iPadOS 13+ que se declara "Macintosh" cae en fp32.**
// Distinguirlo exige `maxTouchPoints`, que es justo lo que no se puede usar (ver arriba). El costo
// es acotado: fp32 es el comportamiento que esos aparatos ya tienen hoy, y ningún iPad reportó el
// fallo — la evidencia es de un iPhone de 6 GB. Preferir un criterio DEMOSTRABLEMENTE idéntico en
// los dos scopes por sobre uno más fino pero divergente es la decisión correcta: la variante
// equivocada hace la app más pesada, la variante DIVERGENTE la rompe.
import { summarizeUserAgent } from '../diagnostics/userAgent'
import { DEFAULT_VARIANT, type ModelVariant } from './netManifest'

/** Android no lo cubre `summarizeUserAgent` (que existe para diagnosticar WebGPU en iOS), así que se
 *  reconoce acá. El token `Android` aparece en el UA de Chrome, Firefox y Samsung Internet. */
const ANDROID = /Android/

/**
 * Variante para un user agent dado. Pura y total: cualquier string devuelve una variante válida.
 *
 * Se apoya en `summarizeUserAgent` —ya probada contra UA reales— en vez de re-derivar la detección
 * de iOS, y se la llama SIN `maxTouchPoints` a propósito (ver cabecera): así `iPadOsSuspected` es
 * siempre `false` y el resultado depende únicamente del string, que es lo que hace que el hilo
 * principal y el worker no puedan discrepar.
 */
export function modelVariantFor(userAgent: string): ModelVariant {
  const { isIos } = summarizeUserAgent({ userAgent })
  return isIos || ANDROID.test(userAgent) ? 'mixed16' : DEFAULT_VARIANT
}

/**
 * La variante de ESTE dispositivo. Único punto del código que lee `navigator.userAgent`, y por eso
 * el único que puede equivocarse: `ModelGate` (hilo principal) y `appFactory` (worker) la llaman sin
 * argumentos y obtienen el mismo valor por construcción.
 *
 * Fuera de un navegador (Node, tests de dominio) no hay `navigator`: devuelve la variante por
 * defecto en vez de lanzar, porque ningún camino de Node descarga ni lee modelos.
 */
export function currentModelVariant(): ModelVariant {
  if (typeof navigator === 'undefined') return DEFAULT_VARIANT
  return modelVariantFor(navigator.userAgent)
}
