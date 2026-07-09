# Fase engine — destilación de fuentes primarias

Fecha: 2026-07-09. Preparación del plan de la fase engine (encoding V7 + MCTS TypeScript + Web Worker).

Fuentes: código fuente de **lightvector/KataGo** (rama master, consultado 2026-07-09; licencia MIT) y **Sir-Teo/web-katrain** (commit `7a0a487`, 2026-07-02; licencia MIT verificada en su `LICENSE` — se puede adaptar código). Se citan rutas del repo KataGo (`cpp/...`, `python/...`). Kaya (AGPL) solo se cita como contraste, nunca como fuente de código.

Verificación local ya realizada (2026-07-09, este repo):

- **onnxruntime-web corre en Node puro**: el export map del paquete resuelve `import 'onnxruntime-web'` a `dist/ort.node.min.mjs` bajo Node. Con el `b18c384nbt-kata1.fp32.onnx` local: sesión en ~780 ms, inferencia batch 1 (EP wasm, 1 thread) ~714 ms. Sanity: tablero vacío 19×19 komi 7.5 → policy argmax = (3,3) hoshi con p=0.148, win% Negro = 0.443, lead = −0.64. **Los tests de encoding pueden correr en Vitest sin navegador y sin dependencias nuevas.**
- **Nuestros ONNX convertidos exponen outputs extra** con nombres numéricos (`'1967'`, `'1993'`, …) además de los 9 nombrados — artefacto de la conversión `torch.onnx.export`. Inofensivo; pedir siempre outputs explícitos (`fetches`) en `session.run`.
- No hay binario `katago` en la máquina (el de fase 0 no sobrevivió). `brew info katago` → **1.16.5 bottled** (misma versión usada en la investigación). Tampoco hay `.bin.gz`; hay que descargar los checkpoints oficiales para generar vectores de referencia.

## 1. Encoding de inputs V7 (`cpp/neuralnet/nninputs.cpp`, `NNInputs::fillRowV7`)

La red b18c384nbt (model version 8+, input version 7) espera `bin_input` [batch, 22, H, W] (NCHW en nuestros ONNX) y `global_input` [batch, 19]. Todos los planos son 0/1 salvo indicación; **todo se codifica desde la perspectiva de `pla` = jugador al turno**.

### 1.1 Planos espaciales (22)

| # | Contenido | Detalle |
|---|---|---|
| 0 | on-board | 1 en toda casilla del tablero (máscara para tamaños < nnLen) |
| 1 | piedras de pla | |
| 2 | piedras de opp | |
| 3 | piedra (cualquier color) con 1 libertad | libertades de la **cadena** |
| 4 | ídem con 2 libertades | |
| 5 | ídem con 3 libertades | |
| 6 | ko prohibido | `board.ko_loc` (ko simple) **más** toda casilla con `superKoBanned` (superko posicional/situacional según regla) |
| 7 | solo encore (koRecapBlocked) | **0 en reglas normales** |
| 8 | **sin uso en V7** | siempre 0 (solo lo usa fillRowV6) |
| 9–13 | última, penúltima, … 5.ª jugada atrás (one-hot en la casilla) | solo si la alternancia de colores es correcta (jugada 1-atrás de opp, 2-atrás de pla, …); si una jugada fue **pase**, se marca `global[i]` en vez del plano; la cadena se corta en la primera inconsistencia |
| 14 | piedras en escalera capturable (laddered), tablero actual | cadenas con 1–2 libertades resueltas con búsqueda de escalera (§1.3) |
| 15 | ídem sobre el tablero de hace 1 jugada | usa `hist.getRecentBoard(1)` |
| 16 | ídem sobre el tablero de hace 2 jugadas | |
| 17 | jugadas que capturan en escalera | casillas donde `pla` puede iniciar una escalera exitosa contra una cadena **de opp con >1 libertad** (`workingMoves` de la búsqueda attacker-first) |
| 18 | área/territorio actual de pla | ver §1.4; **solo** con area scoring (o territory en encore ≥2, que no implementamos) |
| 19 | ídem de opp | |
| 20–21 | second-encore starting stones | **0 en reglas normales** |

Supresión de historial (afecta planos 9–13, 15, 16 y `global[0..4]`, `global[14]`): si un pase terminaría la partida y (a) estamos en la raíz con `conservativePass` activo, o (b) hay passing-hacks activos y el final no sería victoria, entonces `maxTurnsOfHistoryToInclude = 0` (historial oculto por completo y `global[14] = 0`). Con `conservativePass = true` (default de uso real) esto aplica **en la raíz** siempre que el pase del rival deje la partida a un pase de terminar.

### 1.2 Features globales (19)

| # | Contenido | Valor reglas chinas komi 7.5 (Negro al turno) | Japonesas komi 6.5 |
|---|---|---|---|
| 0–4 | jugada n-atrás fue pase | 0/1 según historial | ídem |
| 5 | `selfKomi/20` | `-7.5/20 = -0.375` (Blanco al turno: `+0.375`) | `-6.5/20` |
| 6,7 | regla de ko | simple: `0, 0`; posicional: `1.0, 0.5`; situacional: `1.0, −0.5` | simple: `0, 0` |
| 8 | suicidio múltiple legal | 0 | 0 |
| 9 | territory scoring | 0 (area) | **1** |
| 10,11 | tax | none: `0,0` | seki: `1,0` (all: `1,1`) |
| 12,13 | encore phase 1/2 | 0, 0 | 0, 0 |
| 14 | passWouldEndPhase | 0/1 (sujeto a supresión §1.1) | ídem |
| 15,16 | playoutDoublingAdvantage | `0, 0` si no se usa; si ≠0: `[15]=1, [16]=0.5·pda` | ídem |
| 17 | button go | 0 | 0 |
| 18 | komi parity wave | onda triangular (§ código, período 2 sobre `selfKomi − komiFloor`); **solo area scoring** (o encore ≥2) | 0 |

`selfKomi` = `hist.currentSelfKomi(pla, drawEquivalentWinsForWhite=0.5)`: para Blanco `komi + whiteHandicapBonusScore`, para Negro el negado; con komi de medio punto, `drawEquivalentWinsForWhite=0.5` no añade ajuste. Clip a ±(área+`KOMI_CLIP_RADIUS`). Reglas KataGo (`cpp/game/rules.cpp:276-296`, verificado): `chinese` = {ko **SIMPLE**, area, tax none, suicide no, **whiteHandicapBonus = N** → con handicap el komi efectivo de Blanco sube +N piedras}; `japanese`/`korean` = {ko **SIMPLE**, territory, tax seki, suicide no, whiteHandicapBonus = 0}. Consecuencias: con ambas reglas el plano 6 marca **solo** `board.ko_loc` (superKoBanned aplica a ko posicional/situacional, no a KO_SIMPLE) y `global[6,7] = 0, 0`; los ciclos largos (triple ko) terminan en "no result", que es exactamente lo que la cabeza `noResult` del value modela.

### 1.3 Escaleras (`iterLadders`, `cpp/neuralnet/nninputs.cpp:815`; búsquedas en `cpp/game/board.cpp:1581,1628`)

Para cada cadena con 1–2 libertades (memoizando por `chain_head`):

- 1 libertad → `searchIsLadderCaptured(loc, defenderFirst=true, buf)`: ¿la cadena muere aunque le toque huir?
- 2 libertades → `searchIsLadderCapturedAttackerFirst2Libs(loc, buf, workingMoves)`: prueba las 2 jugadas atacantes; las que funcionan van a `workingMoves` (plano 17).

La búsqueda es un solver dedicado (~250 líneas en `board.cpp`) con poda; **se porta tal cual de board.cpp (MIT)**, con presupuesto de nodos. Los planos 15/16 requieren poder reconstruir los 2 tableros anteriores (el board del engine guarda snapshots o aplica undo).

### 1.4 Área pass-alive (`Board::calculateArea`, `cpp/game/board.cpp:1853`; helper `calculateAreaForPla`:1932)

Con area scoring + tax none (chinas): `calculateArea(result, nonPassAliveStones=true, safeBigTerritories=true, unsafeBigTerritories=true, suicide)`. `calculateAreaForPla` implementa el **algoritmo de Benson** generalizado (regiones vitales, cadenas pass-alive por iteración a punto fijo) más las banderas de territorios grandes. Se porta de `board.cpp` (MIT). Para japonesas pre-encore los planos 18/19 quedan en 0 (no se necesita Benson para jugar con japonesas, pero sí para chinas).

### 1.5 Qué llenan las referencias browser (contraste)

> **CORRECCIÓN 2026-07-09 (verificada contra el código de web-katrain, commit 7a0a487):** la versión anterior de esta sección afirmaba que web-katrain no implementaba ko/escaleras/Benson. **Es falso** — se leyó el archivo equivocado (`featuresV7.ts`, una variante simplificada/legacy). web-katrain **sí tiene el encoding V7 completo** en `featuresV7Fast.ts` + `fastBoard.ts`. Esto cambia la estrategia de la fase engine de "reimplementar desde cero" a **"adaptar web-katrain (MIT) y verificar contra `kata-raw-nn`"**.

- **kaya (AGPL)**: planos 0–6 y 9–13; globals 0–5. Sin escaleras, sin Benson, sin reglas. (No se usa como fuente: AGPL.)
- **web-katrain (MIT)** — encoding V7 **completo**, repartido en dos archivos:
  - `src/engine/katago/fastBoard.ts` (1427 líneas): simulación de tablero + **solver de escaleras** portado de `board.cpp` (`searchIsLadderCaptured`-equivalente con presupuesto de nodos, más `findLibertyGainingCaptures`, `countHeuristicConnectionLibertiesX2`, `wouldBeKoCapture`, `getBoundNumLibertiesAfterPlay`, `getNumLibertiesAfterPlay`) + **área de Benson** (`calculateAreaForPla`, `computeAreaMapV7KataGo` — con comentario explícito "following `Board::calculateArea`"). Multi-size vía `setBoardSize(size)`.
  - `src/engine/katago/featuresV7Fast.ts` (181 líneas): `fillInputsV7Fast` con planos 0–19 (incluye **6 ko**, **14–17 escaleras**, **18–19 área**) + globals 5, 9, 10, 14, 18. Recibe `ladderedStones`/`ladderWorkingMoves`/`areaMap` precomputados por `fastBoard.ts`.
  - `scoreValue.ts` (utilidad de score con tabla precomputada), `analyzeMcts.ts` (MCTS completo), `evalV8.ts` (postprocesado).
  - **Lo que web-katrain NO tiene** (queda como nuestro): (a) **Human SL / `meta_input` [192]** — no implementa Human SL en absoluto; (b) **inferencia por ONNX** — web-katrain corre la red con **TensorFlow.js** (`@tensorflow/tfjs` + backends webgpu/wasm), parseando el `.bin.gz` con su propio `parseKataGoModelV8`/`KataGoModelV8Tf`; tengen usa **onnxruntime-web + ONNX** (decisión ya medida en fase 0), así que la capa de evaluación es nuestra.
- **tengen**: adapta el encoding V7 y el MCTS de web-katrain (planos 7, 8, 20, 21 ≡ 0 por construcción; el resto ya exacto en su port), añade `meta_input` de Human SL y el evaluador ONNX, y **verifica todo contra `kata-raw-nn`** con tolerancia estrecha (la spec exige "mismas posiciones → mismos policy/value dentro de tolerancia"). El test contra KataGo desktop es el gate de correctitud tanto si adaptamos como si reimplementáramos.

## 2. `meta_input` [1,192] de Human SL (`python/sgfmetadata.py`, `cpp/neuralnet/sgfmetadata.cpp`)

Layout (índices, todo desde perspectiva de pla):

| Índices | Contenido |
|---|---|
| 0,1 | pla/opp es humano (0/1) |
| 2,3 | pla/opp unranked |
| 4,5 | pla/opp rank unknown |
| 6–39 | rango de pla: termómetro de 34 — se ponen a 1 los primeros `min(inverseRank, 34)` |
| 40–73 | ídem rango de opp |
| 74 | rated: 0 rated / 1 unrated / **0.5 unknown** |
| 75–81 | time control one-hot: unknown/none/absolute/simple/**byoyomi**/canadian/fischer (exactamente uno = 1) |
| 82 | `0.4·(ln(mainTimeSeconds+60) − 6.5)` (cap 3 días) |
| 83 | `0.3·(ln(periodTimeSeconds+1) − 3.0)` (cap 1 día) |
| 84 | `0.5·(ln(byoYomiPeriods+2) − 1.5)` (cap 50) |
| 85 | `0.25·(ln(canadianMoves+2) − 1.5)` (cap 50) |
| 86 | `0.5·ln(boardArea/361)` |
| 87–150 | fecha: 32 pares (cos, sin) de `2π·días_desde_1970-01-01/período`, con período inicial 7 días multiplicado sucesivamente por `80000^(1/31)` |
| 151–166 | source one-hot: 0=KataGo selfplay, 1=OGS, 2=KGS, 3=Fox, 4=Tygem, 5=GoGoD, 6=Go4Go |
| 167–191 | reservado, 0 |

`inverseRank`: `9d=1, 8d=2, …, 1d=9, 1k=10, 2k=11, …, 20k=29` (`sgfmetadata.cpp:292`).

Perfil oficial `rank_X` / `preaz_X` (`makeBasicRankProfile`): ambos jugadores humanos, mismo rango, `gameRatednessIsUnknown=true` (→ [74]=0.5), byo-yomi 1200 s + 30 s × 5 períodos, source=KGS, fecha `2020-03-01` (`rank_`) o `2016-09-01` (`preaz_`, pre-AlphaZero — **los configs oficiales de KataGo usan `preaz_`** para que el estilo imitado no esté contaminado por humanos que copian a las IAs). `proyear_YYYY`: inverseRank=1 ambos, tc unknown, source GoGoD (≤2020) o Go4Go (2021–2023), fecha 1 de junio del año.

## 3. Outputs del modelo y postprocesado

Contrato I/O ya verificado en fase 0 (`docs/research/fase0/contrato-io.md`). Interpretación (confirmada con `web-katrain/src/engine/katago/evalV8.ts`, port MIT del C++):

- `policy` [b, 6, H·W+1]: usar **cabeza 0**; índice `H·W` = pase. Logits → softmax **solo sobre jugadas legales** (KataGo pone −inf/NaN en ilegales antes del softmax). Cabeza 5 (si existiese) es la policy "optimista" — no se usa (policyOptimism=0 en v1).
- `value` [b, 3]: logits `[win, loss, noResult]` del jugador al turno → softmax.
- `miscvalue` [b, 10]: `[0]·20 = scoreMean` (selfplay), `[1]` pre-softplus → `softplus·20 = scoreStdev`, `[2]·20 = lead` (puntos del jugador al turno), `[3]` = varTimeLeft (no se usa). Tras calcular: multiplicar scoreMean/lead/scoreMeanSq por `(1 − noResultProb)`.
- `moremiscvalue` [b, 8]: `[0]·0.25 = shorttermWinlossError`, `[1]·30 = shorttermScoreError` (no imprescindibles en v1).
- `ownership` [b, 1, H, W]: tanh-like en perspectiva del jugador al turno (v1: solo para conteo final / análisis).

## 4. MCTS de KataGo (para la reimplementación simplificada)

Fuentes: `cpp/search/searchexplorehelpers.cpp`, `searchhelpers.cpp`, `searchupdatehelpers.cpp`, `searchresults.cpp`, `searchparams.cpp`. web-katrain `analyzeMcts.ts` tiene un port MIT casi completo (mismos valores) — referencia de adaptación directa.

### 4.1 Selección (PUCT)

```
cpuct(W)        = cpuctExploration + cpuctExplorationLog · ln((W + cpuctExplorationBase) / cpuctExplorationBase)
exploreScaling  = cpuct(W) · sqrt(W + 0.01) · parentUtilityStdevFactor      // W = totalChildWeight
score(hijo)     = exploreScaling · P(hijo) / (1 + w(hijo)) + U(hijo)_desde_pla
```

`P` = prob de policy del padre; `w(hijo)` = weight del hijo (≈ visitas; con uncertainty ≠). Hijo no visitado: `w=0`, `U = fpuValue`. `U` se niega si pla es Negro (KataGo mantiene utilidades en perspectiva de Blanco).

`parentUtilityStdevFactor = 1 + cpuctUtilityStdevScale · (parentUtilityStdev/cpuctUtilityStdevPrior − 1)` con la stdev empírica de utility del nodo (fórmula exacta en `getFpuValueForChildrenAssumeVisited`).

### 4.2 FPU

```
reduction = fpuReductionMax · sqrt(policyProbMassVisited)     // masa de policy de hijos ya visitados
fpu       = parentUtilityForFPU ∓ reduction                   // − si pla=Blanco, + si Negro
```

Con `fpuParentWeightByVisitedPolicy=true`: `parentUtilityForFPU = m·utilityAvg + (1−m)·utilityNN` con `m = policyProbMassVisited^1`. En raíz se usa `rootFpuReductionMax` (0.1).

### 4.3 Utilidad

```
U(nodo) = (winProb − lossProb) · winLossUtilityFactor                       // 1.0
        + scoreValue(scoreMean, scoreStdev, center=0,    scale=2.0)  · staticScoreUtilityFactor    // 0.1
        + scoreValue(scoreMean, scoreStdev, recentScoreCenter, dynamicScoreCenterScale=0.75) · dynamicScoreUtilityFactor  // 0.3
scoreValue(s; c, k) = E_{x~N(s,stdev)}[ atan((x − c)/(k·sqrt(boardArea))) · 2/π ]
```

web-katrain `scoreValue.ts` (MIT) implementa la esperanza con la misma tabla precomputada que `cpp/game/scorevalue.cpp`. `recentScoreCenter` se actualiza tras cada búsqueda con el scoreMean raíz amortiguado (`dynamicScoreCenterZeroWeight=0.2`). Simplificación v1 aceptable: empezar solo con `staticScoreUtilityFactor=0.1` + winloss y añadir dynamic después; **no** omitir score utility por completo (KataGo la considera esencial para juego natural).

### 4.4 Virtual loss (batching)

Al descender se incrementa `virtualLosses` del camino; el hijo con VL se evalúa como si tuviera `virtualLossWeight = nVL · numVirtualLossesPerThread (3.0)` de peso extra con utilidad = pérdida total (`±(winLoss+static+dynamic factors)`), interpolada: `U' = U + (U_loss − U)·vlw/(vlw + max(0.25, w))`, `w' = w + vlw`. Al terminar la evaluación del batch se retiran. Batch objetivo: 8 (medido en fase 0: 4.6–4.9 inf/s).

### 4.5 Backup

KataGo **no** hace backup incremental por camino: tras cada playout, cada nodo del camino **recalcula** sus stats como promedio ponderado de sus hijos + su propia eval NN (`recomputeNodeStats`): `weightSum = Σ w_hijo (+w_propio)`, promedios de winLoss/noResult/scoreMean/scoreMeanSq/lead/utility ponderados por `w`. Refinamientos: `downweightBadChildrenAndNormalizeWeight` (pondera hijos según `valueWeightExponent=0.25` castigando utilidades malas) y `useNoisePruning` (limita peso no justificado por la policy). v1: replicar el esquema recompute con downweighting (web-katrain lo tiene portado); uncertainty weighting opcional (post-v1).

### 4.6 Selección de jugada final

`playSelectionValues` ≈ visitas de cada hijo raíz (con LCB opcional: `useLcbForSelection=true, lcbStdevs=5, minVisitPropForLCB=0.2` — un hijo con ≥20% de las visitas del top puede ganar por LCB). Temperatura:

```
temp(turno) = temp_final + (temp_early − temp_final) · 0.5^(turno/halflife · 19/sqrt(boardArea))
elegir jugada ~ visitas^(1/temp), aplicando temperatura solo bajo chosenMoveTemperatureOnlyBelowProb
```

Defaults GTP: `chosenMoveTemperature=0.1`, `Early=0.5`, `halflife=19`. Con temp→0, argmax de visitas.

### 4.7 Parámetros v1 (de `basicDecentParams()` + defaults GTP de `setup.cpp`)

```
winLossUtilityFactor=1.0   staticScoreUtilityFactor=0.1   dynamicScoreUtilityFactor=0.3
dynamicScoreCenterZeroWeight=0.2   dynamicScoreCenterScale=0.75
cpuctExploration=1.0   cpuctExplorationLog=0.45   cpuctExplorationBase=500
cpuctUtilityStdevPrior=0.40   cpuctUtilityStdevPriorWeight=2.0   cpuctUtilityStdevScale=0.85
fpuReductionMax=0.2   rootFpuReductionMax=0.1   fpuParentWeightByVisitedPolicy=true
valueWeightExponent=0.25   useNoisePruning=true
useLcbForSelection=true   lcbStdevs=5   minVisitPropForLCB=0.2
chosenMoveTemperature=0.1   chosenMoveTemperatureEarly=0.5   chosenMoveTemperatureHalflife=19
numVirtualLossesPerThread=3.0   conservativePass=true
rootNoiseEnabled=false   rootPolicyTemperature=1.0   nnPolicyTemperature=1.0
```

**Se omite en v1** (documentado, no olvidado): graph search/transposiciones (`useGraphSearch`), subtree value bias, uncertainty weighting (`useUncertainty`), antiMirror, rootEndingBonusPoints/rootPruneUselessMoves (revisar al calibrar pases), futile visits pruning, time control.

### 4.8 Terminales y pases

Dos pases consecutivos → nodo terminal: puntuar con área Benson-like (chinas) y utilidad exacta del resultado (win/loss ±1 + score utility del score final). `conservativePass=true`: en la raíz no se asume que el propio pase termina la partida (ver supresión de historial §1.1).

## 5. Human SL en juego (`cpp/configs/gtp_human5k_example.cfg`, `gtp_human9d_search_example.cfg`)

- Perfil: `humanSLProfile = preaz_5k` … `preaz_9d` (§2).
- Elección de jugada: `humanSLChosenMoveProp=1.0` → jugada muestreada de la **policy humana** (tras temperatura); `humanSLChosenMoveIgnorePass=true` → el **pase** lo decide la lógica normal de KataGo, no la red humana.
- 5k: `maxVisits=40` (búsqueda mínima de la red principal por detrás), `PiklLambda=1e8` (sin corrección por utilidad — juega lo que jugaría el humano), temperaturas 0.85→0.70 (halflife 80).
- 9d: `maxVisits=400`, `PiklLambda=0.08` (la búsqueda **sí** vetará jugadas claramente perdedoras), temperaturas 0.70→0.25, `humanSLRootExploreProbWeightless=0.8`.
- Implicación v1 tengen: niveles kyu = policy humana pura + temperatura (1 inferencia, ~350 ms medidos) con guarda de pase simple; niveles dan = policy humana + veto/blend con pocas visitas de b18 (calibrable). La interpolación exacta PiklLambda queda para calibración.

## 6. Vectores de referencia (`docs/GTP_Extensions.md`)

- **`kata-raw-nn SYMMETRY`** (GTP): evaluación cruda de la red, sin búsqueda. Con `SYMMETRY=0` (identidad) es directamente comparable con nuestro ONNX. Devuelve pares clave-valor: `whiteWin whiteLoss noResult whiteLead whiteScoreSelfplay whiteScoreSelfplaySq varTimeLeft shorttermWinlossError shorttermScoreError policy (H·W floats, NAN = ilegal) policyPass whiteOwnership`. **Perspectiva de Blanco** (nuestra red: jugador al turno) — convertir al comparar. Orden de claves no garantizado; parsear tolerante.
- **`kata-raw-human-nn SYMMETRY`**: ídem con el modelo `-human-model` y el `humanSLProfile` del config; reporta `whiteScore`/`whiteScoreSq` en vez de lead/selfplay.
- Posiciones arbitrarias: alimentar por GTP (`boardsize`, `komi`, `play B/W <vertex>`) antes de `kata-raw-nn 0`. Config mínima determinista: `numSearchThreads=1`, modelo `.bin.gz` oficial b18 + humanv0.
- Setup en el Mac: `brew install katago` (1.16.5) + descargar `kata1-b18c384nbt-s9996604416-d4316597426.bin.gz` (katagotraining.org, misma red exacta que nuestro ONNX) y `b18c384nbt-humanv0.bin.gz` (release v1.15.0 de lightvector/KataGo).
- Tolerancias esperadas: nuestro ONNX fp32 en CPU (wasm) vs KataGo Eigen fp32 — mismas features → diferencias solo por orden de flotantes y conversión de pesos; contrato razonable: `|Δpolicy| < 2e-3` por punto (softmax), `|Δwinrate| < 5e-3`, `|Δlead| < 0.2` puntos. Si katago-onnx introduce divergencia mayor (documentar al medir), ajustar y registrar aquí.

## 7. Notas para la implementación

- El board del engine necesita: cadenas con conteo de libertades O(1) por cadena (linked list circular estilo KataGo `chain_head/next_in_chain`), ko simple, hash Zobrist + historial para superko, undo o snapshots (planos 15/16 y árbol MCTS), solver de escaleras y Benson. **Todo esto ya está portado en `fastBoard.ts` de web-katrain (MIT)** → estrategia = adaptarlo, no reimplementarlo (ver §1.5). `@sabaki/go-board` sirve como **oráculo en tests** (capturas/legalidad), no como motor.
- **web-katrain clonado permanentemente en `~/dev/vendor/web-katrain` (commit `7a0a487`, 2026-07-09)** como fuente de adaptación MIT — mismo patrón que `katago-onnx`. KataGo no se clona: su binario llega por `brew install katago` (1.16.5) para generar vectores de referencia, y su C++ ya está destilado en este doc.
