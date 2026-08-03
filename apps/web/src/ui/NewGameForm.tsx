// Formulario de nueva partida (Fase 2, Task 4). Controla los campos, arma un `GameConfig` y lo
// valida con `validateConfig` (única fuente de verdad de las reglas M-4 + clamp de visitas) antes
// de emitirlo por `onStart`. La UI ya limita handicap>1 a 19×19, así que `validateConfig` no
// debería lanzar en uso normal; el catch es una red de seguridad, no el camino esperado.
import { useState } from 'preact/hooks'
import type { BoardSize, HumanRank, RankLevel, Rules } from '@tengen/engine'
import { HUMAN_RANKS } from '@tengen/engine'
import type { GameConfig, HumanColorChoice } from '../game/gameConfig'
import { resolveHumanColor, validateConfig } from '../game/gameConfig'
import { kataStrengthOptions } from '../game/opponentStrength'

interface NewGameFormProps {
  onStart(config: GameConfig): void
  onBack(): void
}

const BOARD_SIZES: BoardSize[] = [9, 13, 19]
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
  // Qué fuerzas se ofrecen depende del dispositivo: en móvil hay UNA (25 visitas ≈ 15 s por jugada
  // a las ~1,5 visitas/s medidas en un iPhone 12); en escritorio siguen las tres. Se calcula en cada
  // render —es un reduce sobre 3 elementos— y nunca al importar el módulo, que congelaría el UA.
  const kataOptions = kataStrengthOptions()
  // El formulario arranca SIEMPRE en la opción más débil, que es la primera de la lista (el test de
  // `kataStrengthOptionsFor` fija ese orden). Antes eran 200 visitas hardcodeadas: en un teléfono,
  // dos minutos de espera por jugada como primer contacto con el motor.
  //
  // Invariante que un cambio futuro puede romper sin que nada avise: `kataVisits` tiene que ser
  // siempre un valor de `kataOptions`. Hoy se cumple por construcción —arranca en el primero y sólo
  // lo cambian los botones de esa misma lista—, y en móvil, donde no se dibujan botones, se queda en
  // el único ofrecido.
  const [kataVisits, setKataVisits] = useState<number>(kataOptions[0].visits)
  const [rules, setRules] = useState<Rules>('chinese')
  const [komi, setKomi] = useState<number>(defaultKomi('chinese'))
  const [komiTouched, setKomiTouched] = useState(false)
  const [handicap, setHandicap] = useState(0)
  // Color del humano: negro (default, = comportamiento histórico) / blanco / nigiri (al azar). El
  // sorteo del nigiri ocurre en `handleSubmit`, sin pantalla intermedia (decisión de producto: como
  // OGS, ves el color que te tocó al arrancar la partida, no una ceremonia de adivinanza).
  const [colorChoice, setColorChoice] = useState<HumanColorChoice>('black')
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
  // Con handicap≥2 el color queda forzado (el humano toma las piedras de handicap = Negro), así que
  // el selector se deshabilita. Al salir de 19×19, `handleBoardSizeChange` ya resetea handicap→0, lo
  // que re-habilita el selector sin código extra.
  const colorLocked = handicap >= 2

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
    // El sorteo del nigiri (único Math.random() del feature) ocurre ACÁ, una sola vez. Con el color
    // bloqueado (handicap≥2) forzamos negro sin sortear (validateConfig lo forzaría igual).
    const humanColor = colorLocked ? 'black' : resolveHumanColor(colorChoice)
    const config: GameConfig = {
      boardSize,
      komi,
      rules,
      handicap,
      opponent,
      humanColor,
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
    <form class="card-screen new-game-form" onSubmit={handleSubmit}>
      <h1>tengen</h1>
      <p class="new-game-subtitle">Nueva partida contra la IA.</p>

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

        {/* Antes eran dos radios, cada uno con un <select> que se montaba y desmontaba debajo: el
            layout saltaba al cambiar de oponente y la relación radio↔select se leía por proximidad y
            nada más. `.choice-row` es la molécula del sistema para elegir un AJUSTE —el elegido va en
            kaya tenue, "encendido", nunca elevado como una pestaña—, la misma que ya usan Analizar y
            el diagnóstico. `role="group"` + `aria-labelledby` reponen la agrupación semántica que el
            <fieldset>/<legend> daba gratis.

            El REPARTO DE ESPACIO es la decisión de diseño de este bloque, y usa las dos escalas que
            ya existen: la pista vive DENTRO del campo (`.field`, gap --sp-1 = agrupa: es el tercer
            slot que `.field` define, igual que "Solo disponible en 19×19" en Handicap), y el nivel
            —fuerza o rango— es HERMANO en el `.field-group` (gap --sp-3 = separa). Ese contraste 4px
            adentro / 12px afuera es lo único que dice a qué fila pertenece el eyebrow: con el mismo
            gap arriba y abajo, "FUERZA" queda equidistante y la agrupación no se lee. */}
        <div class="field">
          <span id="new-game-opponent-label">Oponente</span>
          <div class="choice-row" role="group" aria-labelledby="new-game-opponent-label">
            <button
              type="button"
              aria-pressed={opponentKind === 'kata'}
              class={opponentKind === 'kata' ? 'active' : ''}
              onClick={() => setOpponentKind('kata')}
            >
              KataGo
            </button>
            <button
              type="button"
              aria-pressed={opponentKind === 'human'}
              class={opponentKind === 'human' ? 'active' : ''}
              onClick={() => setOpponentKind('human')}
            >
              Human SL (estilo humano)
            </button>
          </div>

          {/* Con una sola fuerza posible no se dibuja una fila de un botón: una elección de una
              opción no es una elección. Va la pista que dice POR QUÉ, para que nadie busque los
              niveles que faltan. */}
          {opponentKind === 'kata' && kataOptions.length === 1 && (
            <span class="field-hint">
              En este dispositivo KataGo juega a fuerza baja: así responde en ~15 s por jugada.
            </span>
          )}
        </div>

        {opponentKind === 'kata' && kataOptions.length > 1 && (
          <div class="field">
            <span class="eyebrow" id="new-game-strength-label">
              Fuerza
            </span>
            <div class="choice-row" role="group" aria-labelledby="new-game-strength-label">
              {kataOptions.map(({ visits, short, label }) => (
                <button
                  key={visits}
                  type="button"
                  aria-pressed={kataVisits === visits}
                  // El texto visible es el corto ("Baja") porque el eyebrow ya dice FUERZA; fuera de
                  // ese contexto visual no significa nada, así que el nombre accesible es el largo.
                  // Lo CONTIENE, que es lo que pide "Label in Name" (WCAG 2.5.3).
                  aria-label={label}
                  class={kataVisits === visits ? 'active' : ''}
                  onClick={() => setKataVisits(visits)}
                >
                  {short}
                </button>
              ))}
            </div>
          </div>
        )}

        {opponentKind === 'human' && (
          <label class="field">
            <span class="eyebrow">Nivel</span>
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
          </label>
        )}

        <fieldset class="field">
          <legend>Tu color</legend>
          <label class="radio-option">
            <input
              type="radio"
              name="colorChoice"
              checked={colorChoice === 'black'}
              disabled={colorLocked}
              onChange={() => setColorChoice('black')}
            />
            Negro (yo)
          </label>
          <label class="radio-option">
            <input
              type="radio"
              name="colorChoice"
              checked={colorChoice === 'white'}
              disabled={colorLocked}
              onChange={() => setColorChoice('white')}
            />
            Blanco (yo)
          </label>
          <label class="radio-option">
            <input
              type="radio"
              name="colorChoice"
              checked={colorChoice === 'nigiri'}
              disabled={colorLocked}
              onChange={() => setColorChoice('nigiri')}
            />
            Nigiri (al azar)
          </label>
          {colorLocked && <span class="field-hint">Con handicap juegas Negro</span>}
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

      {errorMsg && <p class="notice notice--danger">{errorMsg}</p>}

      {/* La acción que lidera va al final y sola en su peso; "Volver" se apaga debajo — antes
          encabezaba el formulario a ancho completo, compitiendo con el título. */}
      <button type="submit" class="primary">
        Empezar partida
      </button>
      <button type="button" class="ghost" onClick={onBack}>
        Volver
      </button>
    </form>
  )
}
