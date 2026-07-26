// Almacenamiento persistente (Storage API). Sin esto, los 110 MB del ONNX que `modelCache.ts` deja
// en OPFS viven en un bucket "best-effort": el navegador puede desalojarlos bajo presión de disco,
// en silencio y sin aviso. Medido en producción antes de este módulo: `navigator.storage.persisted()`
// devolvía `false`, mientras el gate de descarga prometía "se descarga una sola vez: queda guardada
// en este navegador". Esto es lo que hace cierta esa frase.
//
// Chrome no muestra un diálogo: concede o niega según heurísticas (app instalada como PWA, nivel de
// engagement, marcador). Por eso la respuesta se DEVUELVE y la UI la refleja en vez de asumirla —
// prometer durabilidad que el navegador no dio sería el mismo error, movido de lugar.
//
// Inyectable (mismo patrón que `modelStore`/`fetchImpl` del resto de la app) para poder testear los
// cuatro caminos sin navegador.

/** Subconjunto de `StorageManager` que este módulo usa. */
export interface PersistableStorage {
  persisted(): Promise<boolean>
  persist(): Promise<boolean>
}

export type PersistenceResult =
  /** El origen ya tenía almacenamiento persistente (no se volvió a pedir). */
  | 'already-persisted'
  /** Se pidió y el navegador lo concedió. */
  | 'granted'
  /** Se pidió y el navegador lo negó: los datos siguen siendo desalojables. */
  | 'denied'
  /** El navegador no expone la Storage API. */
  | 'unsupported'

/** true si el resultado garantiza que los datos NO serán desalojados automáticamente. */
export function isDurable(result: PersistenceResult): boolean {
  return result === 'already-persisted' || result === 'granted'
}

/** Pide almacenamiento persistente para el origen, si hace falta y si se puede.
 *
 * Idempotente y barato: consulta `persisted()` primero, así una recarga en un origen ya persistente
 * no vuelve a pedir nada. Nunca lanza — un fallo de la API (contextos no seguros, permisos raros)
 * se reporta como 'denied', porque a efectos del llamador significa lo mismo: no hay garantía. */
export async function ensurePersistentStorage(
  storage: PersistableStorage | undefined,
): Promise<PersistenceResult> {
  if (!storage || typeof storage.persist !== 'function' || typeof storage.persisted !== 'function') {
    return 'unsupported'
  }
  try {
    if (await storage.persisted()) return 'already-persisted'
    return (await storage.persist()) ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}
