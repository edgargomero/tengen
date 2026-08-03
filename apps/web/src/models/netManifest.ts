// Manifest de redes descargables de apps/web (Fase 1 — caché OPFS con progreso).
// sourceUrl es la MISMA ruta relativa '/models/<archivo>' en dev y en prod: en dev la sirve el
// middleware serve-models (vite.config.ts); en prod (Fase 4) la sirve el mismo path, ahora como
// ruta del Worker (GET /models/:filename, apps/worker/src/index.ts) que proxya el archivo real
// desde R2 — mismo origen en ambos casos, sin URL absoluta de R2 ni reconfiguración de CORS/COEP.
// opfsName lleva versión (`.v1`) porque un bump de versión = nueva entrada de caché (no invalida
// transparentemente la anterior).
//
// ── Variantes de precisión (2026-08-02) ────────────────────────────────────────────────────────
// Cada red se publica en DOS binarios con los mismos pesos entrenados y distinta precisión de
// almacenamiento. No son redes distintas ni juegan distinto; cambian de tamaño, que es lo único que
// se está optimizando:
//
//   · `fp32`    — el binario probado en producción desde el día uno. Lo sirve el escritorio.
//   · `mixed16` — pesos fp16 con I/O y el subgrafo `gpool` en fp32 (`scripts/convert-mixed16.py`).
//     Pesa la mitad. Lo sirve el móvil, donde el pico de carga de ~232 MB (el ONNX en un
//     ArrayBuffer de JS + la copia de ORT a su heap WASM) mata el proceso alrededor de la
//     inferencia 80 — medido en un iPhone 12 Pro Max, idéntico en Safari y en Chrome iOS, que es lo
//     que descarta al navegador como variable.
//
// Ambas variantes están VALIDADAS, no supuestas: `b18.mixed16` da 10/10 contra los vectores de
// KataGo desktop (`npm run -w @tengen/engine test:nn`), y `humanv0.mixed16` —que no tiene vectores
// de referencia propios— se validó contra su propio fp32 con
// `scripts/validate-humanv0-mixed.ts`: cero NaN, misma jugada y una distancia de variación total
// ≤ 1,1e-3 sobre la distribución de muestreo real, o sea que eligen distinto a lo sumo el 0,11 % de
// las veces.
import type { NetworkId } from '@tengen/engine'

/** Precisión del binario servido. Mismos pesos entrenados, distinto tamaño en disco. */
export type ModelVariant = 'fp32' | 'mixed16'

/** La variante que existe para TODA red disponible y es el fallback cuando falta otra. */
export const DEFAULT_VARIANT: ModelVariant = 'fp32'

export interface ModelManifestEntry {
  /** Nombre en OPFS, plano y VERSIONADO (bump = nueva entrada de caché). */
  opfsName: string
  /** Fuente de descarga: '/models/<archivo>', mismo path relativo en dev y prod (ver arriba). */
  sourceUrl: string
  /** Tamaño total en bytes, para validación de completitud. */
  bytes: number
}

// b10 aún no convertida → ausente (Partial). requireManifestEntry() lanza para redes no disponibles
// (preserva el comportamiento actual de appFactory: throw para b10).
//
// Los `bytes` son literales medidos con `stat -f%z` sobre los archivos de `packages/engine/models/`,
// y son los MISMOS que debe devolver el `content-length` de producción: `ensureModel` rechaza ante
// un solo byte de diferencia, así que un número copiado de memoria deja el modelo inservible.
export const netManifest: Partial<Record<NetworkId, Partial<Record<ModelVariant, ModelManifestEntry>>>> = {
  b18: {
    fp32: {
      opfsName: 'b18c384nbt-kata1.fp32.v1.onnx',
      sourceUrl: '/models/b18c384nbt-kata1.fp32.onnx',
      bytes: 115800125,
    },
    mixed16: {
      opfsName: 'b18c384nbt-kata1.mixed16.v1.onnx',
      sourceUrl: '/models/b18c384nbt-kata1.mixed16.onnx',
      bytes: 58093573,
    },
  },
  humanv0: {
    fp32: {
      opfsName: 'b18c384nbt-humanv0.fp32.v1.onnx',
      sourceUrl: '/models/b18c384nbt-humanv0.fp32.onnx',
      bytes: 108040143,
    },
    mixed16: {
      opfsName: 'b18c384nbt-humanv0.mixed16.v1.onnx',
      sourceUrl: '/models/b18c384nbt-humanv0.mixed16.onnx',
      bytes: 54194233,
    },
  },
}

/** Todas las variantes publicadas de una red, en orden de declaración. Vacío si la red no existe.
 *  Lo consume la limpieza de OPFS, que necesita saber qué NO se va a usar en este dispositivo. */
export function manifestVariantsOf(net: NetworkId): Array<{ variant: ModelVariant; entry: ModelManifestEntry }> {
  const byVariant = netManifest[net]
  if (!byVariant) return []
  return (Object.entries(byVariant) as Array<[ModelVariant, ModelManifestEntry]>).map(([variant, entry]) => ({
    variant,
    entry,
  }))
}

/**
 * Entrada del manifest para servir `net` en este dispositivo, CON fallback: si la variante preferida
 * no está publicada para esa red, cae a `fp32`.
 *
 * El fallback no es cosmético — es lo que evita romper una red entera por una conversión que no
 * pasó su validación. Si `humanv0.mixed16` hubiera sido rechazado, su entrada `mixed16` no existiría
 * y Jugar contra Human SL en un móvil llamaría igual con `variant: 'mixed16'`: sin fallback, el
 * modo se cae; con fallback, sirve el fp32 (más pesado, pero funciona).
 *
 * Devuelve la variante EFECTIVA además de la entrada: el caller la necesita para decir la verdad
 * sobre qué está sirviendo (diagnóstico) y para no borrar de OPFS el archivo que sí está usando.
 */
export function resolveManifestEntry(
  net: NetworkId,
  variant: ModelVariant,
): { variant: ModelVariant; entry: ModelManifestEntry } {
  const byVariant = netManifest[net]
  if (!byVariant) throw new Error(`red ${net} aún no disponible en apps/web`)
  const preferred = byVariant[variant]
  if (preferred) return { variant, entry: preferred }
  const fallback = byVariant[DEFAULT_VARIANT]
  if (fallback) return { variant: DEFAULT_VARIANT, entry: fallback }
  throw new Error(`red ${net} no tiene ninguna variante servible en apps/web`)
}

/**
 * Entrada EXACTA: la variante pedida debe existir, sin fallback. Es lo contrario de
 * `resolveManifestEntry` y la asimetría es deliberada.
 *
 * La usa la prueba del motor de `/diagnostico`, donde la variante es el eje del experimento. Ahí un
 * fallback silencioso sería peor que un error: reportaría "mixed16 aguantó 120 tandas" habiendo
 * medido el fp32, y esa medición es justamente la evidencia que decide si hace falta convertir una
 * red más chica. Un experimento que miente sobre qué midió no es un experimento.
 */
export function requireManifestEntry(net: NetworkId, variant: ModelVariant): ModelManifestEntry {
  const byVariant = netManifest[net]
  if (!byVariant) throw new Error(`red ${net} aún no disponible en apps/web`)
  const entry = byVariant[variant]
  if (!entry) throw new Error(`red ${net} no tiene variante ${variant} en apps/web`)
  return entry
}
