// Formulario de nueva partida (Fase 2, Task 4). Controla los campos, arma un `GameConfig` y lo
// valida con `validateConfig` (única fuente de verdad de las reglas M-4 + clamp de visitas) antes
// de emitirlo por `onStart`. La UI ya limita handicap>1 a 19×19, así que `validateConfig` no
// debería lanzar en uso normal; el catch es una red de seguridad, no el camino esperado.
import { useState } from 'preact/hooks'
import type { BoardSize, HumanRank, RankLevel, Rules } from '@tengen/engine'
import { HUMAN_RANKS } from '@tengen/engine'
import type { GameConfig } from '../game/gameConfig'
import { validateConfig } from '../game/gameConfig'

interface NewGameFormProps {
  onStart(config: GameConfig): void
  onBack(): void
}

const BOARD_SIZES: BoardSize[] = [9, 13, 19]
const KATA_VISIT_PRESETS = [50, 200, 500] as const
const HANDICAP_OPTIONS_19 = [0, 2, 3, 4, 5, 6, 7, 8, 9]

// Komi por defecto según reglas (chino 7, japonés 6.5). Se re-aplica al cambiar de reglas
// SOLO si el usuario no tocó el campo de komi a mano (ver `komiTouched`).
function defaultKomi(rules: Rules): number {
  return rules === 'chinese' ? 7 : 6.5
}

// Tiempo principal sugerido por tamaño de tablero (minutos) — mismo orden de magnitud que KGS
// (spec 2026-07-16-reloj-partida-design.md §UI). El byoyomi (5×30s) NO varía por tamaño.
function defaultMainTimeMin(size: BoardSize): number {
  if (size === 9) return 10
  if (size === 13) return 20
  return 30
}
const DEFAULT_BYOYOMI_PERIODS = 5
const DEFAULT_BYOYOMI_SECONDS = 30

export function NewGameForm({ onStart, onBack }: NewGameFormProps) {
  // Tamaño por defecto: 9×9 (partida más corta y rápida — mejor primera experiencia jugable que
  // 19×19; además el usuario puede subir de tamaño cuando quiera).
  const [boardSize, setBoardSize] = useState<BoardSize>(9)
  const [opponentKind, setOpponentKind] = useState<'human' | 'kata'>('kata')
  const [humanRank, setHumanRank] = useState<HumanRank>('5k')
  const [kataVisits, setKataVisits] = useState<number>(200)
  const [rules, setRules] = useState<Rules>('chinese')
  const [komi, setKomi] = useState<number>(defaultKomi('chinese'))
  const [komiTouched, setKomiTouched] = useState(false)
  const [handicap, setHandicap] = useState(0)
  // Reloj (Fase reloj, 2026-07-16): activado por defecto con valores sugeridos, con un toggle "Sin
  // reloj". `clockTouched` seguido del mismo patrón que `komiTouched`: no pisar un valor de tiempo
  // principal que el usuario ya tocó a mano al cambiar de tamaño de tablero.
  const [clockEnabled, setClockEnabled] = useState(true)
  const [mainTimeMin, setMainTimeMin] = useState<number>(defaultMainTimeMin(9))
  const [clockTouched, setClockTouched] = useState(false)
  const [byoyomiPeriods, setByoyomiPeriods] = useState<number>(DEFAULT_BYOYOMI_PERIODS)
  const [byoyomiSeconds, setByoyomiSeconds] = useState<number>(DEFAULT_BYOYOMI_SECONDS)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handicapAllowed = boardSize === 19

  function handleRulesChange(next: Rules): void {
    setRules(next)
    if (!komiTouched) setKomi(defaultKomi(next))
  }

  function handleBoardSizeChange(next: BoardSize): void {
    setBoardSize(next)
    if (next !== 19) setHandicap(0) // M-4: handicap>1 solo en 19×19 (el motor lo rechazaría igual)
    if (!clockTouched) setMainTimeMin(defaultMainTimeMin(next))
  }

  function handleSubmit(evt: Event): void {
    evt.preventDefault()
    setErrorMsg(null)
    const opponent: RankLevel =
      opponentKind === 'human' ? { kind: 'human', rank: humanRank } : { kind: 'kata', visits: kataVisits }
    const config: GameConfig = {
      boardSize,
      komi,
      rules,
      handicap,
      opponent,
      ...(clockEnabled
        ? {
            clock: {
              mainTimeMs: mainTimeMin * 60_000,
              byoyomiPeriods,
              byoyomiPeriodMs: byoyomiSeconds * 1000,
            },
          }
        : {}),
    }
    try {
      onStart(validateConfig(config))
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <form class="new-game-form" onSubmit={handleSubmit}>
      <button type="button" onClick={onBack}>
        Volver
      </button>
      <h1>tengen</h1>
      <p class="new-game-subtitle">Nueva partida contra la IA (tú juegas Negro).</p>

      <div class="field-group">
        <label class="field">
          Tamaño del tablero
          <select
            value={boardSize}
            onChange={(e) => handleBoardSizeChange(Number((e.target as HTMLSelectElement).value) as BoardSize)}
          >
            {BOARD_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}×{size}
              </option>
            ))}
          </select>
        </label>

        <fieldset class="field">
          <legend>Oponente</legend>
          <label class="radio-option">
            <input
              type="radio"
              name="opponentKind"
              checked={opponentKind === 'kata'}
              onChange={() => setOpponentKind('kata')}
            />
            KataGo
          </label>
          {opponentKind === 'kata' && (
            <select
              value={kataVisits}
              onChange={(e) => setKataVisits(Number((e.target as HTMLSelectElement).value))}
            >
              {KATA_VISIT_PRESETS.map((visits) => (
                <option key={visits} value={visits}>
                  {visits} visitas
                </option>
              ))}
            </select>
          )}

          <label class="radio-option">
            <input
              type="radio"
              name="opponentKind"
              checked={opponentKind === 'human'}
              onChange={() => setOpponentKind('human')}
            />
            Human SL (estilo humano)
          </label>
          {opponentKind === 'human' && (
            <select
              value={humanRank}
              onChange={(e) => setHumanRank((e.target as HTMLSelectElement).value as HumanRank)}
            >
              {HUMAN_RANKS.map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
            </select>
          )}
        </fieldset>
      </div>

      <div class="field-group">
        <label class="field">
          Reglas
          <select value={rules} onChange={(e) => handleRulesChange((e.target as HTMLSelectElement).value as Rules)}>
            <option value="chinese">Chinas</option>
            <option value="japanese">Japonesas</option>
          </select>
        </label>

        <label class="field">
          Komi
          <input
            type="number"
            step="0.5"
            value={komi}
            onChange={(e) => {
              setKomiTouched(true)
              setKomi(Number((e.target as HTMLInputElement).value))
            }}
          />
        </label>

        <label class="field">
          Handicap
          <select
            value={handicap}
            disabled={!handicapAllowed}
            onChange={(e) => setHandicap(Number((e.target as HTMLSelectElement).value))}
          >
            {(handicapAllowed ? HANDICAP_OPTIONS_19 : [0]).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Sin handicap' : `${n} piedras`}
              </option>
            ))}
          </select>
          {!handicapAllowed && <span class="field-hint">Solo disponible en 19×19</span>}
        </label>
      </div>

      <div class="field-group">
        <label class="radio-option">
          <input
            type="checkbox"
            checked={!clockEnabled}
            onChange={(e) => setClockEnabled(!(e.target as HTMLInputElement).checked)}
          />
          Sin reloj
        </label>

        {clockEnabled && (
          <>
            <label class="field">
              Tiempo principal (minutos)
              <input
                type="number"
                min="0"
                step="1"
                value={mainTimeMin}
                onChange={(e) => {
                  setClockTouched(true)
                  setMainTimeMin(Number((e.target as HTMLInputElement).value))
                }}
              />
            </label>

            <label class="field">
              Byoyomi: períodos
              <input
                type="number"
                min="0"
                step="1"
                value={byoyomiPeriods}
                onChange={(e) => setByoyomiPeriods(Number((e.target as HTMLInputElement).value))}
              />
            </label>

            <label class="field">
              Byoyomi: segundos por período
              <input
                type="number"
                min="0"
                step="5"
                value={byoyomiSeconds}
                onChange={(e) => setByoyomiSeconds(Number((e.target as HTMLInputElement).value))}
              />
            </label>
          </>
        )}
      </div>

      {errorMsg && <p class="form-error">{errorMsg}</p>}

      <button type="submit" class="primary">
        Empezar partida
      </button>
    </form>
  )
}
