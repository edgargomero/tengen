// Manifest de redes descargables de apps/web (Fase 1 — caché OPFS con progreso).
// En dev, sourceUrl apunta al middleware serve-models (vite.config.ts); en prod (Fase 4) cambiará
// a una URL de R2 sin tocar el resto del pipeline. opfsName lleva versión (`.v1`) porque un bump
// de versión = nueva entrada de caché (no invalida transparentemente la anterior).
import type { NetworkId } from '@tengen/engine'

export interface ModelManifestEntry {
  /** Nombre en OPFS, plano y VERSIONADO (bump = nueva entrada de caché). */
  opfsName: string
  /** Fuente de descarga. Dev: '/models/<archivo real>'. Prod (Fase 4): URL de R2. */
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
