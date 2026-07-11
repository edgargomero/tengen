// Panel de modo-adivinanza de "Modo Analizar" (Fase 3a, Task 10): consume `guessAgainstEngine.ts`
// (Task 8) vía props ya calculadas por `ReadyAnalyzeView`, que es quien posee el estado y decide si
// el tablero acepta clics. Presentación pura: no toca el motor ni el `Goban` directamente.
import type { GuessAgainstEngineResult } from '../analysis/guessAgainstEngine'

interface GuessMovePanelProps {
  waiting: boolean
  busy: boolean
  result: GuessAgainstEngineResult | null
  errorMsg: string | null
  /** Ya formateado por el caller (`AnalyzeView.tsx` conoce `boardSize`) — null si no hay resultado. */
  expectedLabel: string | null
  onStart(): void
  onCancel(): void
}

export function GuessMovePanel({ waiting, busy, result, errorMsg, expectedLabel, onStart, onCancel }: GuessMovePanelProps) {
  return (
    <div class="guess-panel">
      {waiting ? (
        <>
          <p class="guess-hint">Haz clic en el tablero con tu jugada.</p>
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </>
      ) : (
        <button type="button" onClick={onStart} disabled={busy}>
          {busy ? 'Adivinando…' : '¿Cuál jugaría el motor aquí?'}
        </button>
      )}
      {errorMsg !== null && <p class="play-error">{errorMsg}</p>}
      {result !== null && expectedLabel !== null && (
        <p class={`guess-result tone-${result.verdict.tone}`}>
          El motor jugaría {expectedLabel} — {result.verdict.label}
        </p>
      )}
    </div>
  )
}
