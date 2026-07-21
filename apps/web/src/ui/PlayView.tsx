// Pantalla de juego (Fase 2, Task 4 + Task 5): tablero Shudan + panel lateral + bucle de juego
// humano↔IA, árbol de variaciones, Export/Import SGF y persistencia automática. El color del humano
// (`config.humanColor`, elegido en el formulario — negro/blanco/nigiri) y el de la IA (`aiColor`, el
// opuesto) se derivan UNA vez y reemplazan los literales de color; con handicap≥2 el humano es Negro
// (validateConfig lo fuerza) y la IA (Blanco) abre. El color viaja en el SGF (`TGHC`), así reabrir
// una partida conserva el color sin re-sortear el nigiri.
//
// ── Ciclo de vida ────────────────────────────────────────────────────────────────────────────
// El `GameTree` y el `EngineManager` viven en refs creados UNA sola vez (no en cada render).
// Preact no re-renderiza porque se mute un ref, así que cada mutación del árbol (jugada o
// navegación) va seguida de `bump()` (un contador en useState que solo existe para forzar el
// repintado); el tablero/turno/capturas se derivan en cada render leyendo `tree.current` fresco —
// no hay estado duplicado del árbol. `initialTree` (Task 5) es el árbol de partida: si viene
// (restauración desde localStorage o import de SGF), el ref arranca en ÉL en vez de un árbol fresco
// desde `config`; el remonte que produce ese árbol nuevo lo maneja `main.tsx` con `key` (ver ese
// archivo — Task 5 R4).
//
// `staleRef` sigue el mismo patrón que `ModelGate`: marca el componente desmontado. Toda
// continuación async (tras `await` a `ensureReady`/`genMove`/`analyzeToScore`) lo comprueba antes
// de tocar el árbol o el estado, para no mutar un árbol ya descartado (p.ej. "Nueva partida" a
// mitad de la jugada de la IA) ni actualizar un componente ya desmontado.
//
// ── Modo exploración (Task 5) ───────────────────────────────────────────────────────────────
// Task 4 solo permitía jugar en el tip de una partida viva (navegar fuera de él era view-only).
// Task 5 añade variaciones: cuando el cursor está FUERA del tip de su rama, O la partida ya
// TERMINÓ (`endedRef`), un clic legal (o "Pasar") agrega una jugada del color que le toca al
// CURSOR (`currentTurnAt`, no necesariamente Negro) — dedup/ramifica vía `addMove` — y avanza el
// cursor SIN disparar la IA: así se construyen variaciones a mano, alternando colores libremente.
// Fuera de ese modo (partida viva, cursor en el tip) rige el comportamiento de Task 4 sin cambios:
// solo Negro humano juega, y tras su jugada la IA responde si le toca. `isExploring()` centraliza
// esa condición (se llama fresca en cada handler y en el render, nunca se cachea en un state).
import { useEffect, useRef, useState } from 'preact/hooks'
import { BoundedGoban } from '@sabaki/shudan'
import type { GhostStone, Marker } from '@sabaki/shudan'
import { applyElapsed } from '@tengen/engine'
import type { BoardSize, ClockConfig, ClockState, Move, NetworkId, RankLevel, StoneColor } from '@tengen/engine'
import { EngineManager } from '../engine/engineManager'
import { createWorkerManagedEngine } from '../engine/workerManagedEngine'
import type { GameSnapshot } from '../cloud/api'
import { SyncBadge } from '../cloud/SyncBadge'
import { buildGameSnapshot } from '../cloud/snapshot'
import { useCloudSync } from '../cloud/useCloudSync'
import { formatResult, isGameOverByTwoPasses } from '../game/endgame'
import type { GameConfig } from '../game/gameConfig'
import { networkForOpponent, oppositeColor, validateConfig } from '../game/gameConfig'
import { kataStrengthLabel } from '../game/opponentStrength'
import { GameTree, type GameNode } from '../game/gameTree'
import { saveGame } from '../game/persistence'
import { capturesOf, isMoveSequenceLegal, signMapOf, validateMove } from '../game/rules'
import { exportSgf, importSgf } from '../game/sgf'
import { colorToSign, engineToSabakiVertex, sabakiToEngineVertex } from '../game/coords'
import { ModelGate } from '../models/ModelGate'
import { GameTreePanel } from './GameTreePanel'
import { useBoundedBoardSize } from './useBoundedBoardSize'

interface PlayViewProps {
  config: GameConfig
  /** Árbol inicial (Task 5): restauración desde localStorage o import de SGF. Si no viene, se crea
   * un árbol fresco desde `config` (comportamiento de Task 4). */
  initialTree?: GameTree
  /** Id de D1 (Fase 5): presente al restaurar/reabrir una partida que ya vive en la nube — los
   * guardados hacen PUT sobre esa fila desde el arranque en vez de crear una nueva. */
  cloudId?: string
  onNewGame(): void
  /** Bubblea un SGF importado hacia `main.tsx`, que remonta este componente con el árbol nuevo
   * (ver Task 5 R4: el remonte real ocurre por `key`, no por un cambio de props). */
  onImport(config: GameConfig, tree: GameTree): void
  onBack(): void
}

/** Visitas fijas para la estimación de score de fin de partida (`analyzeToScore`). Valor modesto:
 * suficiente para una estimación razonable sin bloquear la UI muchos segundos al terminar. */
const SCORE_VISITS = 100

/** vertexSize por tamaño de tablero: mantiene un ancho físico de tablero similar entre 9/13/19
 * (más grande en 9×9, donde hay pocas líneas y conviene que se vea cómodo). */
const VERTEX_SIZE: Record<BoardSize, number> = { 9: 44, 13: 32, 19: 24 }

function opponentLabel(opponent: RankLevel): string {
  return opponent.kind === 'human' ? `Human SL ${opponent.rank}` : `KataGo (${kataStrengthLabel(opponent.visits)})`
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Texto de feedback para una jugada rechazada por `validateMove`. */
function illegalMoveMessage(reason: 'ko' | 'suicide' | 'overwrite'): string {
  switch (reason) {
    case 'ko':
      return 'Jugada ilegal: retoma un ko.'
    case 'suicide':
      return 'Jugada ilegal: es un suicidio.'
    case 'overwrite':
      return 'Jugada ilegal: esa intersección ya tiene una piedra.'
  }
}

/** Fecha del navegador en YYYY-MM-DD, para el nombre del archivo `.sgf` exportado. */
function formatDateForFilename(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** `mm:ss`, siempre 2 dígitos en ambos campos (`5:07` se ve como `05:07`). */
function formatClockMs(ms: number): string {
  const totalSeconds = Math.max(Math.ceil(ms / 1000), 0)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Envuelve la pantalla de juego en `ModelGate`: garantiza el ONNX de la red del oponente en OPFS
 * antes de montar nada que asuma el modelo listo (`ReadyPlayView`). */
export function PlayView({ config, initialTree, cloudId, onNewGame, onImport, onBack }: PlayViewProps) {
  const net = networkForOpponent(config.opponent)
  return (
    <ModelGate net={net}>
      <ReadyPlayView
        config={config}
        initialTree={initialTree}
        cloudId={cloudId}
        net={net}
        onNewGame={onNewGame}
        onImport={onImport}
        onBack={onBack}
      />
    </ModelGate>
  )
}

interface ReadyPlayViewProps {
  config: GameConfig
  initialTree?: GameTree
  cloudId?: string
  net: NetworkId
  onNewGame(): void
  onImport(config: GameConfig, tree: GameTree): void
  onBack(): void
}

/** Nombre autogenerado de la partida en la nube (sin UI de renombrar en esta fase — spec §Modelo
 * de datos): "9×9 vs Human SL 15k — 2026-07-14". Se genera UNA vez por montaje (el nombre solo
 * viaja en el POST inicial; los PUT no lo tocan). */
function cloudGameName(config: GameConfig): string {
  const size = `${config.boardSize}×${config.boardSize}`
  return `${size} vs ${opponentLabel(config.opponent)} — ${formatDateForFilename(new Date())}`
}

function ReadyPlayView({ config, initialTree, cloudId, net, onNewGame, onImport, onBack }: ReadyPlayViewProps) {
  // Árbol y motor: UNA instancia por montaje (una partida = un ReadyPlayView montado; "Nueva
  // partida"/import/restore desmontan este árbol vía main.tsx —con un `key` distinto— y montan uno
  // nuevo desde cero).
  const treeRef = useRef<GameTree | null>(null)
  if (!treeRef.current) treeRef.current = initialTree ?? GameTree.fromConfig(config)
  const tree = treeRef.current

  // Color del humano y de la IA, derivados UNA vez del config (fijo durante la vida del componente).
  // Reemplazan los literales 'black'/'white' que antes asumían humano=Negro fijo. Capturarlos en el
  // closure del ticker (useEffect deps []) es seguro: nunca cambian tras el montaje.
  const humanColor = config.humanColor
  const aiColor = oppositeColor(humanColor)
  const colorLabel = (c: StoneColor): string => (c === 'black' ? 'Negro' : 'Blanco')

  const managerRef = useRef<EngineManager | null>(null)
  if (!managerRef.current) managerRef.current = new EngineManager(createWorkerManagedEngine)
  const manager = managerRef.current

  const staleRef = useRef(false)
  // true desde el instante en que la partida terminó (resign o fin por dos pases), ANTES de que
  // el `setResult` correspondiente siquiera re-renderice. Es la guarda que usan las continuaciones
  // async (tras el `await` de `genMove`/`analyzeToScore`) para no pisar un resign con una jugada o
  // un score que ya no corresponden: sin esto, resignarse MIENTRAS la IA piensa (o mientras se
  // estima el score final) dejaría que esa operación en vuelo, al resolver, añadiera una jugada
  // post-resign o sobreescribiera el resultado. Los handlers síncronos (click/pasar/resign) la
  // usan como única fuente de verdad en vez de leer `result` (que puede ir un render por detrás).
  // Se inicializa desde `tree.meta.result` (Task 5): una partida restaurada/importada ya terminada
  // arranca marcada como terminada, sin pasar por resign/finishTurn de nuevo.
  const endedRef = useRef(tree.meta.result !== undefined)
  // Contador puramente para forzar el repintado tras mutar `tree` (ver nota de ciclo de vida
  // arriba); el valor en sí no se lee nunca.
  const [, setTick] = useState(0)
  const bump = (): void => setTick((t) => t + 1)
  const [busy, setBusy] = useState(true) // arranca ocupado: hasta que ensureReady (+ apertura IA) resuelva
  // `booting` distingue la fase de arranque (`ensureReady` del motor) de un turno real de la IA
  // (fix del Minor #1 de Task 4): mientras es true, el panel muestra "Preparando motor…" en vez de
  // "IA pensando…" aunque `busy` también sea true durante esa fase.
  const [booting, setBooting] = useState(true)
  const [scoring, setScoring] = useState(false) // solo para el texto del panel ("Estimando…" vs "IA pensando…")
  const [result, setResult] = useState<string | null>(tree.meta.result ?? null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [illegalMoveHint, setIllegalMoveHint] = useState<string | null>(null)
  const [hoveredVertex, setHoveredVertex] = useState<[number, number] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const boardBounds = useBoundedBoardSize(boardRef)
  // Reloj (Fase reloj, 2026-07-16): `turnStartedAtRef` marca cuándo arrancó el turno EN VIVO
  // actual — se resetea tras cada jugada aplicada a la partida viva (nunca en modo exploración, que
  // no consume reloj). Al restaurar (localStorage/Mis partidas), arranca fresco en el momento del
  // montaje: cerrar la pestaña y reabrir NO penaliza al jugador que estaba por mover (limitación
  // aceptada y documentada en la spec — Fase A es 100% client-side, sin autoridad de servidor).
  const turnStartedAtRef = useRef(Date.now())
  // true recién cuando `boot()` confirma el motor listo (Step 4, más abajo) — mismo patrón por-ref
  // que `staleRef`/`endedRef` (nunca `useState`, para no capturarlo obsoleto dentro del `setInterval`
  // del ticker de Step 5). Sin esto, el reloj arrancaría a descontar tiempo desde el MONTAJE del
  // componente, comiéndose el tiempo de "Preparando motor…" (bug encontrado en la autorevisión).
  const bootedRef = useRef(false)
  // Fuerza el repintado del reloj cada ~250ms (el valor en sí no se lee nunca — mismo patrón que el
  // `bump()` del árbol, pero separado: este NO representa una mutación del árbol).
  const [, setClockTick] = useState(0)

  /** No-op si la partida no tiene reloj. Muta `tree.meta.clock.state[color]` IN-PLACE (mismo patrón
   *  que `tree.meta.result`) y devuelve si ese color se quedó sin tiempo. */
  function consumeClock(color: 'black' | 'white', elapsedMs: number): boolean {
    const clock = tree.meta.clock
    if (!clock) return false
    const { state: next, timedOut } = applyElapsed(clock.state[color], clock.config, elapsedMs)
    clock.state[color] = next
    return timedOut
  }

  /** Presupuesto a pasarle a `manager.genMove` para el color dado. `undefined` sin reloj. */
  function clockOptsFor(color: 'black' | 'white'): { config: ClockConfig; state: ClockState } | undefined {
    const clock = tree.meta.clock
    if (!clock) return undefined
    return { config: clock.config, state: clock.state[color] }
  }

  /** Marca la partida terminada por tiempo (mismo canal que resign/score: `endedRef`, `tree.meta.result`,
   *  `persist()`, `cloud.finish()`) — factoriza el remate repetido en los 3 call sites que pueden
   *  detectar un timeout (clic humano, pase humano, jugada de la IA) + el ticker de abajo. */
  function declareTimeout(color: 'black' | 'white'): void {
    endedRef.current = true
    const resultStr = formatResult(0, undefined, color)
    tree.meta.result = resultStr
    setResult(resultStr)
    setBusy(false)
    persist()
    cloud.finish()
  }

  // FIX 2 (fix wave reloj — el timeout AFK detectado por el TICKER no sincronizaba a la nube): el
  // ticker vive en un `useEffect` con deps `[]` (a propósito: "una partida = un montaje"), así que su
  // closure captura el `declareTimeout` del PRIMER render — y ese `declareTimeout` cierra sobre el
  // `cloud` de ese primer render, cuyo `active` es `false` hasta que la sesión resuelve un render
  // después. Sin esto, cuando es el TICKER (no un clic/pase/jugada de IA, que sí usan closures
  // frescas por render) quien detecta el timeout de Negro, `cloud.finish()`/`cloud.save()` corren
  // contra ese `active===false` obsoleto y el resultado final (`W+T`) nunca sube a D1. Un ref
  // reasignado EN EL CUERPO en cada render (no dentro de un `useEffect`: la escritura durante el
  // render ya está vigente antes de cualquier callback/efecto posterior) mantiene
  // `declareTimeoutRef.current` apuntando al `declareTimeout` del render ACTUAL —que cierra sobre el
  // `persist`/`cloud`/`tree`/`result` vigentes— sin recrear el interval ni tocar sus deps `[]`.
  const declareTimeoutRef = useRef(declareTimeout)
  declareTimeoutRef.current = declareTimeout

  /** Color al que le toca jugar en el TIP VIVO de la partida (el final de `mainLine()`, o la raíz si
   *  aún no hay jugadas), NO en el cursor. Es "de quién es el turno EN VIVO": navegar/explorar mueve
   *  el cursor a otra posición pero no cambia el turno vivo, así que `tree.currentTurnAt()` (que lee
   *  el CURSOR) no sirve para "¿es genuinamente el turno vivo de X?". Base de la corrección del reloj
   *  en exploración (Fix 1, fix wave reloj). */
  function liveTurn(): 'black' | 'white' {
    const liveTip = tree.mainLine().at(-1) ?? tree.root
    return tree.currentTurnAt(liveTip)
  }

  /** Cuánto le queda al color dado AHORA MISMO, para mostrar (no muta nada). Descuenta en vivo el
   *  tiempo transcurrido desde `turnStartedAtRef` SI es genuinamente el turno vivo de ese color
   *  (`liveTurn()`, no el turno del cursor), la partida sigue viva y el motor ya arrancó; si no,
   *  muestra el último snapshot guardado. Clave (Fix 1, fix wave reloj — decisión de producto de
   *  Edgar): el reloj de Negro sigue corriendo EN VIVO aunque el jugador navegue/explore otra rama
   *  durante SU propio turno vivo. El tiempo de exploración se cuenta de verdad (no hay pausa ni
   *  exploit de esquivar el timeout quedándose a explorar), y el display no debe mentir mostrándolo
   *  congelado. `turnStartedAtRef` NUNCA se resetea navegando (solo al jugar), así que sigue siendo
   *  el inicio real del turno vivo. La cuenta regresiva EN VIVO se deriva de `applyElapsed` (la MISMA
   *  función pura que el ticker de timeout), no de una fórmula de una sola fase: así refleja al
   *  instante el cruce de tiempo principal→byoyomi y el consumo de períodos completos al pensar de
   *  más, en vez de congelarse en '00:00' (sin sufijo de byoyomi) hasta jugar. */
  function displayedClock(color: 'black' | 'white'): { ms: number; periodsRemaining: number; inByoyomi: boolean } {
    const clock = tree.meta.clock!
    const state = clock.state[color]
    const isLiveTurn = bootedRef.current && result === null && liveTurn() === color
    const elapsed = isLiveTurn ? Date.now() - turnStartedAtRef.current : 0
    if (elapsed <= 0) {
      // Sin turno vivo (partida terminada, explorando el turno del rival, o aún no booteó): snapshot
      // tal cual está persistido — mismo criterio que el ticker (Fix 3), nunca recomputar.
      return {
        ms: state.inByoyomi ? clock.config.byoyomiPeriodMs : state.mainTimeRemainingMs,
        periodsRemaining: state.byoyomiPeriodsRemaining,
        inByoyomi: state.inByoyomi,
      }
    }
    // Turno vivo: la cuenta regresiva sale de `applyElapsed` (la MISMA función pura que el ticker),
    // que sí hace el rollover de tiempo principal→byoyomi y consume períodos completos. Es pura (no
    // muta `state`, devuelve estado nuevo), así que llamarla solo para mostrar no tiene efecto.
    const { state: rolled } = applyElapsed(state, clock.config, elapsed)
    if (!rolled.inByoyomi) {
      // Sigue en tiempo principal: `rolled.mainTimeRemainingMs` es exactamente `mainTimeRemainingMs
      // - elapsed` (igual que la vieja fórmula para este caso, pero desde la función compartida).
      return { ms: rolled.mainTimeRemainingMs, periodsRemaining: rolled.byoyomiPeriodsRemaining, inByoyomi: false }
    }
    const period = clock.config.byoyomiPeriodMs
    if (clock.config.byoyomiPeriods === 0 || period <= 0) {
      // Sin byoyomi real (misma condición que `applyElapsed`, clock.ts): cualquiera de los dos en
      // 0 ya es "solo tiempo principal". Con solo `period <= 0` acá, `byoyomiPeriods:0` +
      // `byoyomiPeriodMs>0` (poner períodos en 0 y dejar segundos en su default) se colaba y
      // mostraba un contador fantasma ciclando en vez de un limpio "00:00".
      return { ms: 0, periodsRemaining: rolled.byoyomiPeriodsRemaining, inByoyomi: false }
    }
    // En byoyomi (ya sea que el color arrancó ahí, o recién cruzó desde tiempo principal en ESTE
    // cálculo): tiempo restante DENTRO del período vigente. `elapsedInByoyomi` excluye el tiempo
    // principal ya gastado antes de cruzar — mismo desplazamiento que usa `applyElapsed` internamente
    // al recursar de tiempo principal a byoyomi. `periodsRemaining` sale de `rolled` (el conteo ya
    // avanzado por el rollover), no del snapshot pre-turno.
    const elapsedInByoyomi = state.inByoyomi ? elapsed : elapsed - state.mainTimeRemainingMs
    const msInPeriod = period - (elapsedInByoyomi % period)
    return { ms: Math.max(msInPeriod, 0), periodsRemaining: rolled.byoyomiPeriodsRemaining, inByoyomi: true }
  }

  /** true si el cursor está fuera del TIP VIVO (`tree.isAtLiveTip()`), o la partida ya terminó: en
   * ese caso, jugar construye una VARIACIÓN a mano en vez de continuar/responder la partida viva
   * (ver nota de "Modo exploración" en la cabecera del archivo). Se llama fresca cada vez (nunca
   * cacheada).
   *
   * OJO (bug real, ya corregido): "tip vivo" NO es lo mismo que "el cursor está en una hoja"
   * (`current.children.length === 0`). Un nodo de variación recién creado TAMBIÉN es una hoja
   * (aún no tiene hijos) pero nunca es el tip vivo — con la heurística de hoja, tras la PRIMERA
   * jugada de una variación este método volvía a dar `false`, y el SEGUNDO clic de esa misma
   * variación se trataba como partida en vivo (la IA jugaba dentro de la variación, o el clic se
   * ignoraba en silencio si no era turno de Negro). `isAtLiveTip()` (gameTree.ts, con test propio)
   * resuelve esto comparando contra el tip real de `mainLine()`, no contra "sin hijos". */
  function isExploring(): boolean {
    return endedRef.current || !tree.isAtLiveTip()
  }

  // Guardado a la nube (Fase 5): no-op sin sesión. Vive acá (no en PlayView) porque cada partida
  // es un montaje de ReadyPlayView — nueva partida/import/restore ⇒ GameSync nuevo, con el
  // cloudId restaurado si la partida ya vivía en D1.
  const cloud = useCloudSync(cloudId)
  const cloudNameRef = useRef<string | null>(null)
  if (cloudNameRef.current === null) cloudNameRef.current = cloudGameName(config)

  /** Snapshot completo para la nube; se arma fresco en cada guardado (el árbol es mutable). */
  function cloudSnapshot(): GameSnapshot {
    return buildGameSnapshot(
      {
        sgf: exportSgf(tree),
        boardSize: config.boardSize,
        mode: 'jugar',
        ...(tree.meta.result !== undefined ? { result: tree.meta.result } : {}),
        opponent: config.opponent,
      },
      cloudNameRef.current!,
      cloudId !== undefined,
    )
  }

  /** Persiste la partida tras CADA jugada aplicada (humana, IA, o de exploración). Best-effort: un
   * storage bloqueado/lleno no debe romper el juego (ver `persistence.ts`, mismo espíritu que su
   * propio try/catch de lectura). El guardado a la nube (D1) sale en el MISMO punto, en paralelo
   * (spec §Flujo de guardado: mismo trigger, best-effort, no bloqueante). */
  function persist(): void {
    try {
      saveGame(window.localStorage, config.opponent, tree, cloud.gameId)
    } catch {
      // Fallo de guardado silencioso a propósito: no es un error del juego en sí.
    }
    cloud.save(cloudSnapshot())
  }

  /** Llamar SIEMPRE justo después de aplicar una jugada de la partida VIVA (humana o de la IA) y su
   * `bump()`. NO se usa en modo exploración (ese camino nunca dispara la IA ni el marcador de fin). */
  async function finishTurn(): Promise<void> {
    if (isGameOverByTwoPasses(tree.movesTo())) {
      setScoring(true)
      try {
        const analysis = await manager.analyzeToScore(tree.positionAt(), SCORE_VISITS)
        if (staleRef.current || endedRef.current) return
        endedRef.current = true
        const resultStr = formatResult(analysis.scoreLead)
        tree.meta.result = resultStr // Task 5 R2: persistir el fin de partida vía el canal RE del árbol.
        setResult(resultStr)
        persist()
        cloud.finish() // partida terminada → backup a Drive tras el último save (Fase 5)
      } catch {
        if (staleRef.current || endedRef.current) return
        endedRef.current = true
        // FIX 2 parte 2 (fix wave post-Fase 2): antes este catch dejaba `tree.meta.result` SIN
        // setear ("'No se pudo estimar…' NO es un RE válido"), lo que divergía memoria/storage —
        // localStorage quedaba con dos pases y SIN RE, abriendo la ventana de revival que cierra la
        // parte 1 (en `boot()`). 'Void' SÍ es un RE válido (SGF estándar de "sin resultado"), así
        // que se usa como marcador de fin persistible: el texto amigable de abajo sigue siendo lo
        // que ve el usuario en ESTA sesión; lo que se persiste (y se re-exporta como `RE[Void]`) es
        // sólo la marca de "partida terminada", no ese texto.
        tree.meta.result = 'Void'
        setResult('No se pudo estimar el resultado.')
        persist()
        cloud.finish() // también con RE[Void]: la partida terminó igual (Fase 5)
      } finally {
        if (!staleRef.current) {
          setBusy(false)
          setScoring(false)
        }
      }
      return
    }
    if (tree.currentTurnAt() === aiColor) {
      await aiTurn()
    } else {
      setBusy(false)
    }
  }

  /** Exactamente UNA jugada de la IA (Blanco) desde el tip actual; NO se auto-repite. El tiempo que
   *  REALMENTE tomó (medido acá, no reportado por el motor) es lo que se descuenta de su reloj —
   *  "ambos respetan el reloj" (spec 2026-07-16) sin que `genMove` necesite devolver un dato nuevo. */
  async function aiTurn(): Promise<void> {
    setBusy(true)
    const aiTurnStartedAt = Date.now()
    try {
      const move = await manager.genMove(tree.positionAt(), config.opponent, clockOptsFor(aiColor))
      if (staleRef.current || endedRef.current) return
      const elapsed = Date.now() - aiTurnStartedAt
      const timedOut = consumeClock(aiColor, elapsed)
      tree.addMove(move)
      bump()
      persist()
      if (timedOut) {
        declareTimeout(aiColor)
        return
      }
      turnStartedAtRef.current = Date.now()
      await finishTurn()
    } catch (e) {
      if (staleRef.current || endedRef.current) return
      setErrorMsg(`La IA no pudo jugar (${errorMessage(e)}). Puedes iniciar una nueva partida.`)
      setBusy(false)
    }
  }

  useEffect(() => {
    staleRef.current = false

    async function boot(): Promise<void> {
      try {
        await manager.ensureReady(net, config.boardSize)
        if (staleRef.current) return
        setBooting(false)
        // Reloj (Fase reloj, 2026-07-16): recién ACÁ arranca "de verdad" el turno en vivo — ni un
        // segundo de "Preparando motor…" debe comerse el tiempo del jugador.
        bootedRef.current = true
        turnStartedAtRef.current = Date.now()
        // Task 5 R1: con un árbol restaurado/importado, el cursor puede NO estar en el tip, o la
        // partida puede ya estar terminada. Arrancar la IA en cualquiera de esos casos corrompería
        // el árbol (addMove desde un cursor que no es el tip) o revivi­ría una partida terminada.
        //
        // R1 (brief) describe el guard como `children.length===0`; usamos `tree.isAtLiveTip()` en
        // su lugar a propósito (mismo predicado que `isExploring`, ver su comentario): si la
        // partida se guardó a media exploración (cursor en una variación, que puede ser una hoja
        // sin serlo del tip vivo), `children.length===0` dispararía la IA DENTRO de esa variación
        // al recargar — el mismo bug de raíz que `isExploring`, aplicado al arranque. `isAtLiveTip`
        // cubre el caso que R1 pide (no revivir una partida terminada, no corromper el árbol) y
        // además el caso restaurado-en-variación que la redacción literal de R1 no contemplaba.
        //
        // FIX 2 parte 1 (fix wave post-Fase 2): `endedRef` (arriba) nace de
        // `tree.meta.result !== undefined`, que sólo se persiste tras un `analyzeToScore` EXITOSO
        // (ver `finishTurn`). En la ventana de scoring (guardado justo tras el 2º pase, antes de que
        // resuelva) o si el scoring FALLA, el storage puede quedar con dos pases pero SIN `meta.result`
        // → `endedRef` arranca en `false` y se abren DOS caminos de revival según qué color pasó
        // último: IA-pasa-primero (`currentTurnAt()==='white'`) dispararía `aiTurn()` en el `if` de
        // abajo; humano-pasa-primero (`currentTurnAt()==='black'`) no dispara la IA aquí, pero deja
        // que `handleVertexClick`/`handlePass` traten el click como continuación de la partida VIVA
        // (`isExploring()` da `false` porque `endedRef` es falso y el cursor SÍ está en el tip).
        // Detectar el fin por dos pases AQUÍ y marcar `endedRef.current = true` cierra AMBOS: el
        // `if` de abajo ya no dispara `aiTurn` (su guarda `!endedRef.current` pasa a fallar), y esos
        // handlers pasan a tratar cualquier click como exploración (nueva variación) en vez de
        // continuación de la partida — nunca vuelven a llamar `finishTurn`/`aiTurn`. NO se re-corre
        // `analyzeToScore` aquí: añadiría ~30s de cómputo + una superficie de fallo nueva en CADA
        // restore para cubrir un caso raro; sólo se marca la partida terminada con un texto genérico
        // (el RE exacto, si se pudo calcular la primera vez, ya vive en `tree.meta.result`/el SGF).
        if (!endedRef.current && isGameOverByTwoPasses(tree.movesTo())) {
          endedRef.current = true
          setResult('Partida terminada')
          setBusy(false)
        } else if (!endedRef.current && tree.isAtLiveTip() && tree.currentTurnAt() === aiColor) {
          await aiTurn() // la IA abre/sigue cuando le toca: humano juega Blanco, o handicap≥2, o restauración a media mano
        } else {
          setBusy(false)
        }
      } catch (e) {
        if (staleRef.current) return
        setErrorMsg(`No se pudo inicializar el motor (${errorMessage(e)}). Puedes iniciar una nueva partida.`)
        setBooting(false)
        setBusy(false)
      }
    }
    void boot()

    return () => {
      staleRef.current = true
      manager.dispose()
    }
    // Se ejecuta una sola vez: `config`/`net`/`manager`/`tree` son fijos durante la vida de este
    // componente (una partida = un montaje).
  }, [])

  // Ticker del reloj (Fase reloj, 2026-07-16): re-pinta la cuenta regresiva cada ~250ms Y detecta
  // timeout del lado HUMANO (Negro) — el lado de la IA nunca "queda AFK" (su reloj se descuenta al
  // recibir su jugada, en `aiTurn`, no acá). Usa diferencia contra un timestamp ABSOLUTO
  // (`Date.now() - turnStartedAtRef.current`), no conteo de ticks: un tab en background/throttled
  // puede detectar el timeout TARDE, nunca de forma incorrecta-temprana (se autocorrige apenas
  // vuelve a tickear). `bootedRef.current` (Step 4) evita chequear timeout antes de que el motor
  // esté listo.
  //
  // FIX 1 (fix wave reloj — decisión de producto de Edgar): el chequeo de timeout de Negro se
  // gatea por el turno del TIP VIVO (`liveTurn()`), NO por el del cursor ni por `isExploring()`.
  // Mientras sea genuinamente el turno vivo de Negro, su reloj corre EN VIVO aunque el jugador esté
  // navegando/explorando otra rama, y el timeout se dispara igual — antes `isExploring()` saltaba
  // este chequeo, dejando que un jugador esquivara la derrota por tiempo quedándose a explorar (y,
  // al volver al tip, un timeout instantáneo sorpresa porque el display iba congelado pero el
  // cómputo de `turnStartedAtRef` NO estaba pausado). Las demás guardas (endedRef/bootedRef/staleRef,
  // que existen por otras razones) se conservan intactas.
  useEffect(() => {
    if (tree.meta.clock === undefined) return
    const id = setInterval(() => {
      if (staleRef.current || endedRef.current || !bootedRef.current) return
      if (liveTurn() !== humanColor) {
        setClockTick((t) => t + 1)
        return
      }
      const elapsed = Date.now() - turnStartedAtRef.current
      const clock = tree.meta.clock!
      const { state, timedOut } = applyElapsed(clock.state[humanColor], clock.config, elapsed)
      if (timedOut) {
        // FIX 3 (fix wave reloj): en el tick FATAL —y SOLO ahí, en la transición a `timedOut`—
        // escribe el estado ya consumido de vuelta a `clock.state.black` ANTES de declarar. Sin esto
        // el display (que se congela al fijar `result`) mostraría el tiempo de INICIO de turno junto
        // a "Resultado: W+T". Es el MISMO estado que `consumeClock` escribe en los otros 3 call sites
        // (clic/pase/IA), sólo que aquí lo reusamos del `applyElapsed` de arriba (no lo reconstruimos
        // ni lo escribimos en cada tick: `elapsed` es un diff ABSOLUTO recomputado fresco, aplicarlo
        // por tick sobre un estado ya reducido lo sobre-consumiría en cascada).
        clock.state[humanColor] = state
        // FIX 2 (fix wave reloj): via ref para llamar al `declareTimeout` del render ACTUAL (con el
        // `cloud` cuya sesión ya resolvió), no al capturado en el primer render (`cloud.active===false`).
        declareTimeoutRef.current(humanColor)
        return
      }
      setClockTick((t) => t + 1)
    }, 250)
    return () => clearInterval(id)
    // Se ejecuta una sola vez: mismo criterio que el useEffect de arranque (una partida = un montaje).
  }, [])

  function handleVertexClick(v: [number, number]): void {
    if (busy) return
    const vertex = sabakiToEngineVertex(v)
    const turnAtCursor = tree.currentTurnAt()

    if (isExploring()) {
      const validation = validateMove(tree.boardAt(), turnAtCursor, vertex)
      if (!validation.legal) {
        setIllegalMoveHint(illegalMoveMessage(validation.reason!))
        return
      }
      setIllegalMoveHint(null)
      tree.addMove({ color: turnAtCursor, vertex })
      bump()
      persist()
      return // modo exploración: nunca dispara la IA
    }

    // Partida viva, en el tip: comportamiento de Task 4 intacto (solo el humano juega, sea su color).
    if (turnAtCursor !== humanColor) return
    const validation = validateMove(tree.boardAt(), humanColor, vertex)
    if (!validation.legal) {
      setIllegalMoveHint(illegalMoveMessage(validation.reason!))
      return
    }
    setIllegalMoveHint(null)
    const elapsed = Date.now() - turnStartedAtRef.current
    const timedOut = consumeClock(humanColor, elapsed)
    tree.addMove({ color: humanColor, vertex })
    bump()
    persist()
    if (timedOut) {
      declareTimeout(humanColor)
      return
    }
    turnStartedAtRef.current = Date.now()
    setBusy(true)
    void finishTurn()
  }

  function handlePass(): void {
    if (busy) return
    const turnAtCursor = tree.currentTurnAt()

    if (isExploring()) {
      tree.addMove({ color: turnAtCursor, vertex: 'pass' })
      bump()
      persist()
      return
    }

    if (turnAtCursor !== humanColor) return
    const elapsed = Date.now() - turnStartedAtRef.current
    const timedOut = consumeClock(humanColor, elapsed)
    tree.addMove({ color: humanColor, vertex: 'pass' })
    bump()
    persist()
    if (timedOut) {
      declareTimeout(humanColor)
      return
    }
    turnStartedAtRef.current = Date.now()
    setBusy(true)
    void finishTurn()
  }

  function handleResign(): void {
    if (endedRef.current) return
    // El humano se rinde → gana la IA (color opuesto) → "W+R" si el humano es Negro, "B+R" si Blanco.
    // Detiene el bucle: no se dispara más genMove
    // (marca `endedRef` YA, antes del `setResult`, para que un genMove/analyzeToScore en vuelo que
    // resuelva después no pise este resultado — ver comentario de `endedRef` arriba). Puede
    // resignarse MIENTRAS la IA piensa (`busy===true`): `setBusy(false)` aquí es indispensable,
    // porque la continuación de `aiTurn` que sigue en vuelo va a cortar por `endedRef` ANTES de
    // llegar a su propio `setBusy(false)` — sin esto, `busy` quedaría pegado en true para siempre
    // (tablero/nav deshabilitados en una partida ya terminada).
    endedRef.current = true
    const resultStr = formatResult(0, humanColor)
    tree.meta.result = resultStr // Task 5 R2: mismo canal RE que la rama de score.
    setResult(resultStr)
    setBusy(false)
    persist()
    cloud.finish() // resign = fin de partida → backup a Drive (Fase 5)
  }

  function goFirst(): void {
    tree.toRoot()
    bump()
  }
  function goPrev(): void {
    if (tree.toParent()) bump()
  }
  function goNext(): void {
    if (tree.toChild(0)) bump()
  }
  function goLast(): void {
    let moved = false
    while (tree.toChild(0)) moved = true
    if (moved) bump()
  }
  function handleTreeNavigate(node: GameNode): void {
    if (busy) return
    if (tree.navigateToPath(tree.pathTo(node))) bump()
  }

  function handleExportSgf(): void {
    const text = exportSgf(tree)
    const blob = new Blob([text], { type: 'application/x-go-sgf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tengen-${formatDateForFilename(new Date())}.sgf`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(evt: Event): Promise<void> {
    const input = evt.target as HTMLInputElement
    const file = input.files?.[0] ?? null
    input.value = '' // permite reimportar el mismo archivo dos veces seguidas
    if (!file) return
    setImportError(null)
    try {
      const text = await file.text()
      const importedTree = importSgf(text)
      // UX: dejar el cursor al final de la línea principal (la posición final de la partida
      // importada), no en la raíz — así se ve la partida completa de inmediato en vez de un
      // tablero vacío. `importSgf` deja el cursor en la raíz por contrato; lo avanzamos aquí, ANTES
      // de validar, para que la validación (siguiente paso) cubra exactamente esa línea principal.
      while (importedTree.toChild(0)) {
        /* avanza hasta el tip de la línea principal */
      }
      // FIX 1 (Important, fix wave post-Fase 2): valida la línea principal DENTRO de este try,
      // ANTES de aceptar el árbol. `boardFromMoves` (vía `boardAt`/`isMoveSequenceLegal`) LANZA ante
      // overwrite/ko/suicidio; sin esta validación, ese throw sólo se descubría en el RENDER de
      // `ReadyPlayView` (`tree.boardAt()`, ya remontado), fuera de cualquier try — con la SPA sin
      // error boundary previo a esta fix wave, eso dejaba la pantalla en blanco. Disparadores
      // reales: SGF con jugadas overwrite/ko-inmediato/suicidio, o un SGF 19×19 con handicap de
      // colocación libre (varios servidores) cuyas piedras reales no coinciden con los hoshi
      // estándar que `boardFromMoves` siempre regenera. `isMoveSequenceLegal` es la versión
      // pura/no-lanzante (rules.ts, con test propio), así que este `throw` queda contenido aquí.
      if (
        !isMoveSequenceLegal(importedTree.meta.boardSize, importedTree.meta.handicap, importedTree.movesTo())
      ) {
        throw new Error('el SGF contiene jugadas ilegales en la línea principal')
      }
      // El SGF no lleva `opponent` (decisión de Task 5): se conserva el de la partida actual.
      const importedConfig = validateConfig({
        boardSize: importedTree.meta.boardSize,
        komi: importedTree.meta.komi,
        rules: importedTree.meta.rules,
        handicap: importedTree.meta.handicap,
        opponent: config.opponent,
        humanColor: importedTree.meta.humanColor,
      })
      // FIX 4 (fix wave post-Fase 2): persiste el árbol importado ANTES de remontar — sin esto, una
      // partida importada y recargada antes de la primera jugada se perdía (localStorage seguía
      // apuntando a la partida anterior). SECUENCIA OBLIGATORIA: validar (arriba) → saveGame →
      // onImport, para nunca persistir un árbol que la validación habría rechazado.
      //
      // El guardado es best-effort (igual que `persist()`): un fallo de storage (modo privado / quota)
      // en un import VÁLIDO no debe abortarlo cayendo al `catch` de abajo con el mensaje engañoso "No
      // se pudo importar el SGF" — el SGF estaba bien, lo que falló fue la persistencia. Al recargar
      // se perdería el import (revierte a la partida anterior), mismo trade-off que `persist()`.
      try {
        saveGame(window.localStorage, importedConfig.opponent, importedTree)
      } catch {
        // Guardado silencioso: no bloquea el import válido.
      }
      onImport(importedConfig, importedTree)
    } catch (e) {
      setImportError(`No se pudo importar el SGF (${errorMessage(e)}).`)
    }
  }

  const board = tree.boardAt()
  const signMap = signMapOf(board)
  const captures = capturesOf(board)
  const turn = tree.currentTurnAt()
  const exploring = isExploring()
  const markerMap = buildMarkerMap(config.boardSize, tree.current.move)
  // Piedra fantasma en hover: solo si un clic ahí realmente jugaría algo (mismo gate que
  // handleVertexClick — en exploración cualquier color puede jugar; en partida viva solo el humano).
  const canHoverPlace = !busy && (exploring || turn === humanColor)
  const hoverVertexEmpty =
    hoveredVertex !== null && signMap[hoveredVertex[1]]?.[hoveredVertex[0]] === 0
  const ghostStoneMap = buildHoverGhostStoneMap(
    config.boardSize,
    canHoverPlace && hoverVertexEmpty ? hoveredVertex : null,
    colorToSign(turn),
  )

  return (
    <div class="play-view">
      <div class="play-board" ref={boardRef}>
        {boardBounds && (
          <BoundedGoban
            signMap={signMap}
            markerMap={markerMap}
            ghostStoneMap={ghostStoneMap}
            maxWidth={boardBounds.maxWidth}
            maxHeight={boardBounds.maxHeight}
            maxVertexSize={VERTEX_SIZE[config.boardSize]}
            showCoordinates
            busy={busy}
            onVertexClick={(_evt, v) => handleVertexClick(v)}
            onVertexMouseEnter={(_evt, v) => setHoveredVertex(v)}
            onVertexMouseLeave={() => setHoveredVertex(null)}
          />
        )}
      </div>
      <aside class="play-panel">
        {tree.meta.clock && (
          <div class="play-clock">
            <p class={liveTurn() === 'black' ? 'play-clock-active' : ''}>
              Negro: {formatClockMs(displayedClock('black').ms)}
              {displayedClock('black').inByoyomi && ` · byoyomi ${displayedClock('black').periodsRemaining}`}
            </p>
            <p class={liveTurn() === 'white' ? 'play-clock-active' : ''}>
              Blanco: {formatClockMs(displayedClock('white').ms)}
              {displayedClock('white').inByoyomi && ` · byoyomi ${displayedClock('white').periodsRemaining}`}
            </p>
          </div>
        )}
        <p class="play-opponent">Oponente: {opponentLabel(config.opponent)}</p>
        {/* Indicador pasivo del color del humano: visible desde el montaje (incluso durante
            "Preparando motor…"), así "ver qué color te tocó" (nigiri) es legible antes del 1er turno. */}
        <p class="play-you">
          Tú: {humanColor === 'black' ? '●' : '○'} {colorLabel(humanColor)}
        </p>
        <p class="play-turn">
          {result !== null
            ? 'Partida terminada'
            : scoring
              ? 'Estimando resultado…'
              : booting
                ? 'Preparando motor…'
                : busy
                  ? 'IA pensando…'
                  : turn === humanColor
                    ? `Tu turno (${colorLabel(humanColor)})`
                    : `Turno de la IA (${colorLabel(aiColor)})`}
        </p>
        <p class="play-captures">
          Capturas — Negro: {captures.black} · Blanco: {captures.white}
        </p>
        {exploring && result === null && <p class="play-exploring">Modo exploración: construyendo variación.</p>}

        {errorMsg !== null && <p class="play-error">{errorMsg}</p>}
        {illegalMoveHint !== null && <p class="play-error">{illegalMoveHint}</p>}
        {result !== null && <p class="play-result">Resultado: {result}</p>}
        {cloud.active && <SyncBadge status={cloud.status} onRetry={cloud.retryNow} />}

        <div class="play-controls">
          <button onClick={handlePass} disabled={busy || (!exploring && turn !== humanColor)}>
            Pasar
          </button>
          <button onClick={handleResign} disabled={result !== null}>
            Rendirse
          </button>
        </div>

        <div class="play-nav">
          <button onClick={goFirst} disabled={busy} title="Primera jugada">
            ⏮
          </button>
          <button onClick={goPrev} disabled={busy} title="Jugada anterior">
            ◀
          </button>
          <button onClick={goNext} disabled={busy} title="Jugada siguiente">
            ▶
          </button>
          <button onClick={goLast} disabled={busy} title="Última jugada">
            ⏭
          </button>
        </div>

        <div class="play-io">
          <button onClick={handleExportSgf}>Exportar SGF</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={busy}>
            Importar SGF
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".sgf"
            style="display: none"
            onChange={(e) => void handleImportFile(e)}
          />
        </div>
        {importError !== null && <p class="play-error">{importError}</p>}

        <button class="play-new-game" onClick={onNewGame}>
          Nueva partida
        </button>
        <button class="play-back" onClick={onBack}>
          Volver
        </button>

        <GameTreePanel tree={tree} onNavigate={handleTreeNavigate} disabled={busy} />
      </aside>
    </div>
  )
}

/** markerMap boardSize×boardSize (indexado [y][x], igual que signMap) con un círculo en la última
 * jugada MOSTRADA (la del cursor, no necesariamente el tip real si se está revisando); sin marca
 * en la raíz (move===null) ni en un pase. */
function buildMarkerMap(boardSize: BoardSize, move: Move | null): (Marker | null)[][] {
  const map: (Marker | null)[][] = Array.from({ length: boardSize }, () =>
    Array<Marker | null>(boardSize).fill(null),
  )
  if (move && move.vertex !== 'pass') {
    const [x, y] = engineToSabakiVertex(move.vertex)
    const row = map[y]
    if (row) row[x] = { type: 'circle' }
  }
  return map
}

/** ghostStoneMap boardSize×boardSize con una única piedra semitransparente (`faint: true`, mismo
 * patrón que `buildPvOverlay` de Modo Analizar) en `hovered`, o vacío si `hovered` es null (nada
 * bajo el cursor, o el gate del caller decidió que ahí no se podría jugar). */
function buildHoverGhostStoneMap(
  boardSize: BoardSize,
  hovered: [number, number] | null,
  sign: 1 | -1,
): (GhostStone | null)[][] {
  const map: (GhostStone | null)[][] = Array.from({ length: boardSize }, () =>
    Array<GhostStone | null>(boardSize).fill(null),
  )
  if (!hovered) return map
  const [x, y] = hovered
  const row = map[y]
  if (row) row[x] = { sign, faint: true }
  return map
}
