// Protocolo tipado del Web Worker del motor. Archivo 100% de tengen. `postMessage` ya hace
// structured-clone: NO se inventa un formato de serialización. Este módulo aporta (1) la unión
// discriminada de mensajes en ambos sentidos, (2) `transferablesOf` para ceder el ownership de los
// Float arrays (evita copiar el `ownership`), y (3) validación honesta que ESTRECHA la unión al
// cruzar el boundary (lanza ante un `type` desconocido; no son no-ops).

import type { Analysis, BoardSize, Move, NetworkId, Position, RankLevel } from '../types'

/** Hilo principal → Worker. `id` correlaciona la respuesta; el Worker encola init/genMove/analyze en
 *  serie (scratch del MCTS no reentrante) y trata `stop`/`stopAll` fuera de la cola (ver handler.ts).
 *  `stop` cancela SÓLO la operación `targetId` (cancelación por-id, Fase 3a Task 1); `stopAll` es el
 *  comportamiento global de antes (teardown/crash-recovery): cancela TODO lo en vuelo/encolado. */
export type WorkerRequest =
  | { type: 'init'; id: number; network: NetworkId; boardSize: BoardSize }
  | { type: 'genMove'; id: number; pos: Position; level: RankLevel }
  | { type: 'analyze'; id: number; pos: Position; visits: number }
  | { type: 'stop'; id: number; targetId: number }
  | { type: 'stopAll'; id: number }

/** Worker → hilo principal. `analysis` es un par streaming: `final:false` por chunk y `final:true` al
 *  completar de forma natural (la cancelación NO emite mensaje; se resuelve client-side). */
export type WorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'move'; id: number; move: Move }
  | { type: 'analysis'; id: number; analysis: Analysis; final: boolean }
  | { type: 'error'; id: number; message: string }

/**
 * Valida/estrecha una request antes de postearla. Con `req` ya tipado hace de guarda defensiva
 * (protege ante `as any` en el borde): exige `id` numérico y un `type` conocido. Devuelve la MISMA
 * referencia (no clona: `postMessage` clona).
 */
export function encodeRequest(req: WorkerRequest): WorkerRequest {
  if (typeof req !== 'object' || req === null || typeof (req as { id?: unknown }).id !== 'number') {
    throw new Error('WorkerRequest inválida: falta un id numérico')
  }
  switch (req.type) {
    case 'init':
    case 'genMove':
    case 'analyze':
    case 'stop':
    case 'stopAll':
      return req
    default:
      throw new Error(`WorkerRequest desconocida: ${String((req as { type?: unknown }).type)}`)
  }
}

/**
 * Estrecha `unknown` (lo que llega en `MessageEvent.data`) a `WorkerResponse`. Lanza si no es un
 * objeto, si le falta `id` numérico o si el `type` no es de respuesta. Así el cliente opera sobre una
 * unión ya validada.
 */
export function decodeResponse(data: unknown): WorkerResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('WorkerResponse inválida: no es un objeto')
  }
  const msg = data as { type?: unknown; id?: unknown }
  if (typeof msg.id !== 'number') {
    throw new Error('WorkerResponse inválida: falta un id numérico')
  }
  switch (msg.type) {
    case 'ready':
    case 'move':
    case 'analysis':
    case 'error':
      return data as WorkerResponse
    default:
      throw new Error(`WorkerResponse desconocida: ${String(msg.type)}`)
  }
}

/**
 * Transferables a ceder junto al mensaje (segundo argumento de `postMessage`). Hoy el único Float
 * array que viaja es `analysis.ownership`; cederlo evita copiar el buffer (el Worker desecha su copia
 * tras postear). El resto de mensajes no llevan buffers → `[]`. Nota: con `ownershipMode:'none'` en
 * Task 12 el `ownership` suele venir `undefined`, así que en la práctica devuelve `[]`; la maquinaria
 * queda lista para cuando se habilite ownership.
 */
export function transferablesOf(msg: WorkerResponse): Transferable[] {
  if (msg.type === 'analysis' && msg.analysis.ownership !== undefined) {
    return [msg.analysis.ownership.buffer as ArrayBuffer]
  }
  return []
}
