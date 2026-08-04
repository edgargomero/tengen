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

  // Lo que el pliegue muestra CERRADO: el estado real de lo que hay dentro. Un disclosure que
  // sólo dice "Reglas y reloj" obliga a abrirlo para saber con qué se va a jugar; con el resumen,
  // el formulario entero es honesto sin scrollear. Se recalcula en cada render — es concatenar
  // cinco strings.
  const ajustesResumen = [
    rules === 'chinese' ? 'chinas' : 'japonesas',
    `komi ${komi}`,
    handicap === 0 ? 'sin handicap' : `${handicap} piedras`,
    clockEnabled ? `${mainTimeMin} min + ${byoyomiPeriods}×${byoyomiSeconds} s` : 'sin reloj',
  ].join(' · ')

  return (
    <form class="card-screen new-game-form" onSubmit={handleSubmit}>
      {/* "Nueva partida" y no "tengen": la marca ya vive en el marco (arriba dice tengen · Jugar),
          y repetirla acá era un segundo membrete ocupando el primer golpe de vista. El título dice
          qué HACE esta pantalla; con eso el subtítulo tampoco hace falta. */}
      <h1>Nueva partida</h1>

      {/* Las CUATRO decisiones reales (tamaño, oponente, fuerza/nivel, color), todas con la misma
          molécula: `.choice-row` con las opciones a la vista. Los select se fueron de este bloque —
          un dropdown esconde 2–3 opciones detrás de un clic y las revela en el chrome del sistema
          operativo, que es exactamente lo contrario de "preparar el tablero". Todo lo que tiene
          default correcto (reglas, komi, handicap, reloj) baja al pliegue de abajo. */}
      <div class="field-group">
        <div class="field">
          <span class="eyebrow" id="new-game-size-label">Tamaño</span>
          <div class="choice-row" role="group" aria-labelledby="new-game-size-label">
            {BOARD_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                aria-pressed={boardSize === size}
                class={boardSize === size ? 'active' : ''}
                onClick={() => handleBoardSizeChange(size)}
              >
                {size}×{size}
              </button>
            ))}
          </div>
        </div>

        {/* El REPARTO DE ESPACIO es la decisión de diseño de este bloque, y usa las dos escalas que
            ya existen: la pista vive DENTRO del campo (`.field`, gap --sp-1 = agrupa) y el nivel
            —fuerza o rango— es HERMANO en el `.field-group` (gap --sp-3 = separa). Ese contraste
            4px adentro / 12px afuera es lo único que dice a qué fila pertenece cada eyebrow. */}
        <div class="field">
          <span class="eyebrow" id="new-game-opponent-label">Oponente</span>
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

        {/* Los glifos ●/○ son el motivo del sistema ("Tú: ● Negro", "● 0 · ○ 0"), y acá es donde
            más literales son: elegís la piedra que vas a tener en la mano. El nombre accesible es
            la palabra sola — para un lector de pantalla el glifo es ruido ("black circle"). */}
        <div class="field">
          <span class="eyebrow" id="new-game-color-label">Tu color</span>
          <div class="choice-row" role="group" aria-labelledby="new-game-color-label">
            <button
              type="button"
              aria-pressed={colorChoice === 'black'}
              aria-label="Negro"
              disabled={colorLocked}
              class={colorChoice === 'black' ? 'active' : ''}
              onClick={() => setColorChoice('black')}
            >
              ● Negro
            </button>
            <button
              type="button"
              aria-pressed={colorChoice === 'white'}
              aria-label="Blanco"
              disabled={colorLocked}
              class={colorChoice === 'white' ? 'active' : ''}
              onClick={() => setColorChoice('white')}
            >
              ○ Blanco
            </button>
            <button
              type="button"
              aria-pressed={colorChoice === 'nigiri'}
              aria-label="Nigiri, color al azar"
              disabled={colorLocked}
              class={colorChoice === 'nigiri' ? 'active' : ''}
              onClick={() => setColorChoice('nigiri')}
            >
              Nigiri
            </button>
          </div>
          {colorLocked && <span class="field-hint">Con handicap juegas Negro</span>}
        </div>
      </div>

      {/* La liturgia, plegada. Reglas, komi, handicap y reloj tienen defaults correctos — quien no
          los toca no debería pagar su espacio: eran dos tercios del scroll (1325px de documento para
          cuatro decisiones). <details> nativo: teclado, lector de pantalla y estado sin un solo
          handler. El resumen del summary mantiene el formulario honesto cerrado. */}
      <details class="form-details">
        <summary>
          <span class="eyebrow">Reglas y reloj</span>
          <span class="form-details-current">{ajustesResumen}</span>
        </summary>
        <div class="form-details-body">
          <div class="field">
            <span class="eyebrow" id="new-game-rules-label">Reglas</span>
            <div class="choice-row" role="group" aria-labelledby="new-game-rules-label">
              <button
                type="button"
                aria-pressed={rules === 'chinese'}
                class={rules === 'chinese' ? 'active' : ''}
                onClick={() => handleRulesChange('chinese')}
              >
                Chinas
              </button>
              <button
                type="button"
                aria-pressed={rules === 'japanese'}
                class={rules === 'japanese' ? 'active' : ''}
                onClick={() => handleRulesChange('japanese')}
              >
                Japonesas
              </button>
            </div>
          </div>

          <div class="field-row">
            <label class="field">
              <span class="eyebrow">Komi</span>
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
              <span class="eyebrow">Handicap</span>
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

          <label class="radio-option">
            <input
              type="checkbox"
              checked={!clockEnabled}
              onChange={(e) => setClockEnabled(!(e.target as HTMLInputElement).checked)}
            />
            Sin reloj
          </label>

          {clockEnabled && (
            <div class="field-row">
              <label class="field">
                <span class="eyebrow">Tiempo (min)</span>
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
                <span class="eyebrow">Byoyomi: períodos</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={byoyomiPeriods}
                  onChange={(e) => setByoyomiPeriods(Number((e.target as HTMLInputElement).value))}
                />
              </label>

              <label class="field">
                <span class="eyebrow">Byoyomi: seg.</span>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={byoyomiSeconds}
                  onChange={(e) => setByoyomiSeconds(Number((e.target as HTMLInputElement).value))}
                />
              </label>
            </div>
          )}
        </div>
      </details>

      {errorMsg && <p class="notice notice--danger">{errorMsg}</p>}

      {/* La acción que lidera cierra el formulario; "Cancelar" se apaga al lado — la SALIDA de
          navegación vive en el marco, siempre visible, así que esto no es navegación. */}
      <div class="action-row">
        <button type="submit" class="primary">
          Empezar partida
        </button>
        <button type="button" class="ghost" onClick={onBack}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
