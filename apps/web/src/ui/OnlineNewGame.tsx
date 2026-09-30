// Pantalla `/online/nueva`: crear una sala contra una persona sin pasar por el gate de WebGPU ni por
// el router (jugar online no necesita el motor). Reusa `NewGameForm` en modo `onlineOnly`; el error
// de red ya lo muestra el formulario. `createRoom` y `navigate` son inyectables para los tests.
import type { RoomConfig } from '@tengen/go-rules'
import { createRoom as defaultCreateRoom } from '../online/identity'
import { NewGameForm } from './NewGameForm'
import { OnlineFrame } from './OnlineFrame'

interface OnlineNewGameProps {
  createRoom?(config: RoomConfig): Promise<{ roomId: string }>
  /** Navegación completa del documento (el router no existe en esta ruta). */
  navigate?(url: string): void
}

export function OnlineNewGame({
  createRoom = (config) => defaultCreateRoom(config),
  navigate = (url) => window.location.assign(url),
}: OnlineNewGameProps) {
  async function handleStartOnline(config: RoomConfig): Promise<void> {
    const { roomId } = await createRoom(config)
    navigate(`/online/${encodeURIComponent(roomId)}`)
  }
  return (
    <OnlineFrame location="Nueva partida online">
      <NewGameForm onlineOnly onStartOnline={handleStartOnline} onBack={() => navigate('/')} />
    </OnlineFrame>
  )
}
