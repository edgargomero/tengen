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

// Impl OPFS real (browser-only; 100% tengen, no adaptada de upstream). No hay unit test
// Node —OPFS no existe en Node—; se verifica por typecheck + en browser (Task 4).
//
// Semántica commit-vs-abort: un `FileSystemWritableFileStream` escribe a un archivo swap;
// los cambios NO se reflejan hasta `close()` (commit). Por eso `abort()` deja el archivo
// SIN el parcial —descarta el swap— y es la ruta de fallo correcta (stream roto o
// byte-mismatch en `ensureModel`). `close()`/`abort()` son idempotentes vía un flag `settled`
// que se marca ANTES de await: si `close()` rechaza (fallo real de commit) el sink queda
// settled, así un `abort()` defensivo posterior no dispara `writable.abort()` sobre un stream
// muerto. La PRIMERA llamada propaga su rechazo —`ensureModel` cuenta con que un `close()`
// que lanza salte `markComplete`.
//
// Chequeo de completitud = "marcador + tamaño" (anti-corrupción): el marcador en
// `localStorage` (`tengen:model:<name>` = bytes esperados) se setea SOLO tras commit +
// validación, pero por sí solo no basta —un archivo truncado con marcador viejo sería
// basura silenciosa (misma clase de falla que el fp16 NaN)—, así que `isComplete` exige
// ADEMÁS que `file.size === bytes`. El marcador vive en `localStorage` (solo hilo principal);
// `readArrayBuffer` NO lo toca, para que el worker (sin `localStorage`) pueda leer OPFS.

const MARKER_PREFIX = 'tengen:model:'

/** DOMException.name que lanza `getFileHandle` sin `{ create: true }` cuando el archivo no existe. */
function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError'
}

export function createOpfsModelStore(): ModelStore {
  return {
    async openWritable(name: string): Promise<WritableSink> {
      const dir = await navigator.storage.getDirectory()
      const handle = await dir.getFileHandle(name, { create: true })
      const writable = await handle.createWritable() // trunca por defecto (keepExistingData: false)
      let settled = false
      return {
        async write(chunk: Uint8Array): Promise<void> {
          // `Uint8Array` (bare) es `Uint8Array<ArrayBufferLike>` en TS ≥5.7, que incluye
          // `SharedArrayBuffer`; `write` exige `ArrayBuffer`-backed. Los chunks del stream de
          // fetch SIEMPRE respaldan un `ArrayBuffer` normal → estrecho el tipo (no `any`).
          await writable.write(chunk as Uint8Array<ArrayBuffer>)
        },
        async close(): Promise<void> {
          if (settled) return
          settled = true // ANTES del await: un rechazo deja el sink settled (no re-invocar stream muerto).
          await writable.close() // commit; si lanza, se propaga → ensureModel no llama markComplete.
        },
        async abort(): Promise<void> {
          if (settled) return
          settled = true
          await writable.abort() // descarta el swap: el archivo queda sin el parcial.
        },
      }
    },

    async markComplete(name: string, bytes: number): Promise<void> {
      localStorage.setItem(MARKER_PREFIX + name, String(bytes))
    },

    async isComplete(name: string, bytes: number): Promise<boolean> {
      // 1. Marcador (barato, solo hilo principal). Si falta o no coincide → false sin tocar OPFS.
      if (localStorage.getItem(MARKER_PREFIX + name) !== String(bytes)) return false
      // 2. El archivo debe existir con EXACTAMENTE el tamaño esperado (marcador viejo vs truncado).
      try {
        const dir = await navigator.storage.getDirectory()
        const handle = await dir.getFileHandle(name) // sin create: NotFoundError si no existe.
        const file = await handle.getFile()
        return file.size === bytes
      } catch (err) {
        if (isNotFound(err)) return false // archivo ausente → no completo (fuerza re-descarga).
        throw err
      }
    },

    async readArrayBuffer(name: string): Promise<ArrayBuffer> {
      // OPFS puro (sin localStorage) para que corra también en el worker. Si el archivo no
      // existe, getFileHandle lanza NotFoundError → se propaga; el caller lo maneja (Task 4).
      const dir = await navigator.storage.getDirectory()
      const handle = await dir.getFileHandle(name)
      const file = await handle.getFile()
      return file.arrayBuffer()
    },
  }
}
