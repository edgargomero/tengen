// Puente Preact ↔ GameSync (Fase 5). Una instancia de GameSync por montaje del componente que lo
// usa (mismo lenguaje de refs-una-vez que ReadyPlayView): el caller decide la granularidad de
// "una partida = un montaje" con su key — PlayView ya remonta por sessionKey; Analizar monta el
// hook en AnalyzeSession (que NO remonta al cambiar la velocidad, pero SÍ con otro SGF).
//
// Sin sesión activa, save/finish son NO-OPS: cero llamadas a /api/games/*, comportamiento idéntico
// a la app sin cuentas (spec §Manejo de errores). El gate se evalúa por llamada — si la sesión
// llega tarde (get-session en vuelo durante las primeras jugadas), el próximo persist() ya sube.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { GameSnapshot } from './api'
import { GameSync, type SyncStatus } from './gameSync'
import { useSession } from './useSession'

export interface CloudSyncHandle {
  /** true si hay sesión activa (gobierna badge y no-ops). */
  active: boolean
  status: SyncStatus
  /** Id de D1 de la partida (desde el primer POST exitoso, o initialGameId si se reabrió). */
  gameId: string | undefined
  save(snapshot: GameSnapshot): void
  /** Backup a Drive tras el último save (fin de partida / salida de análisis). */
  finish(): void
  retryNow(): void
}

export function useCloudSync(initialGameId?: string): CloudSyncHandle {
  const { user } = useSession()
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [gameId, setGameId] = useState<string | undefined>(initialGameId)

  const syncRef = useRef<GameSync | null>(null)
  if (!syncRef.current) {
    syncRef.current = new GameSync({ initialGameId, onStatus: setStatus, onGameId: setGameId })
  }
  const sync = syncRef.current

  useEffect(() => {
    return () => sync.dispose()
    // Una instancia por montaje; `sync` es fijo durante la vida del componente.
  }, [])

  const active = user !== null
  return {
    active,
    status,
    gameId,
    save: (snapshot) => {
      if (active) sync.save(snapshot)
    },
    finish: () => {
      if (active) sync.finish()
    },
    retryNow: () => sync.retryNow(),
  }
}
