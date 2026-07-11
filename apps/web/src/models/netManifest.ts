// Manifest de redes descargables de apps/web (Fase 1 — caché OPFS con progreso).
// sourceUrl es la MISMA ruta relativa '/models/<archivo>' en dev y en prod: en dev la sirve el
// middleware serve-models (vite.config.ts); en prod (Fase 4) la sirve el mismo path, ahora como
// ruta del Worker (GET /models/:filename, apps/worker/src/index.ts) que proxya el archivo real
// desde R2 — mismo origen en ambos casos, sin URL absoluta de R2 ni reconfiguración de CORS/COEP.
// opfsName lleva versión (`.v1`) porque un bump de versión = nueva entrada de caché (no invalida
// transparentemente la anterior).
import type { NetworkId } from '@tengen/engine'

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
export const netManifest: Partial<Record<NetworkId, ModelManifestEntry>> = {
  b18: {
    opfsName: 'b18c384nbt-kata1.fp32.v1.onnx',
    sourceUrl: '/models/b18c384nbt-kata1.fp32.onnx',
    bytes: 115800125,
  },
  humanv0: {
    opfsName: 'b18c384nbt-humanv0.fp32.v1.onnx',
    sourceUrl: '/models/b18c384nbt-humanv0.fp32.onnx',
    bytes: 108040143,
  },
}

export function requireManifestEntry(net: NetworkId): ModelManifestEntry {
  const entry = netManifest[net]
  if (!entry) throw new Error(`red ${net} aún no disponible en apps/web`)
  return entry
}
