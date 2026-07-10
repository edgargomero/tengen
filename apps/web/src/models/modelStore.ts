// Contrato de almacenamiento de modelos (Fase 1 — caché OPFS con progreso).
//
// Esta interfaz es la SPEC AUTORITATIVA contra la que se mide la impl OPFS real
// (`createOpfsModelStore`, Task 3, se añade a este mismo archivo). En Task 2 solo se
// declaran los tipos: `ensureModel` (modelCache.ts) los consume con un store INYECTADO,
// lo que hace que la lógica de orquestación + ruta de fallo sea testeable en Node sin OPFS.
//
// Descomposición sink-based: el loop de streaming + progreso + validación de bytes +
// orquestación del marcador viven en `ensureModel`; `ModelStore` es un sink delgado sobre
// OPFS. `markComplete` está SEPARADO de `close()` y lo llama SOLO `ensureModel`, tras
// validar bytes → "marcador solo tras éxito + validación" vive en la unidad testeada.

/** Escritura incremental de un archivo. `close()` commitea; `abort()` descarta el parcial. */
export interface WritableSink {
  write(chunk: Uint8Array): Promise<void>
  /** Commit del archivo escrito. */
  close(): Promise<void>
  /** Descarta el parcial sin commitear (ruta de fallo). */
  abort(): Promise<void>
}

export interface ModelStore {
  /** true sii el marcador de completado está presente Y el tamaño del archivo === bytes. */
  isComplete(name: string, bytes: number): Promise<boolean>
  readArrayBuffer(name: string): Promise<ArrayBuffer>
  openWritable(name: string): Promise<WritableSink>
  /** Setea el marcador de completado. Lo llama SOLO ensureModel, tras validar bytes. */
  markComplete(name: string, bytes: number): Promise<void>
}
