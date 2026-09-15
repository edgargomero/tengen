# Fase Aprender — contenido y veredicto de licencias (T0)

> **Regla que este documento sirve** (patrón fase 0 de los pesos): el veredicto se escribe ANTES de
> empaquetar nada. Ningún dataset entra a `apps/web/src/learn/data/` ni al registro
> `learn/collections.ts` sin su veredicto acá. Los SGF de terceros viven fuera del repo
> (`~/dev/vendor/tsumego-sources/`, con `FUENTE.txt` por directorio).
>
> Investigado 2026-08-03/04 (research con agente + verificación directa sobre los archivos
> descargados; cada cita textual está copiada del archivo o página citada, no parafraseada).

## El hallazgo central

**No existe hoy una transcripción SGF de las colecciones clásicas que tenga a la vez árboles de
solución y licencia explícita.** Las dos mitades existen por separado:

- **Posiciones** con afirmación de dominio público razonable: sí (867 problemas).
- **Árboles de solución**: solo en transcripciones SIN licencia declarada (u-go.net y derivados).

La premisa del plan («el árbol del SGF es la verdad») queda sin materia prima licenciable para las
colecciones clásicas.

### Segunda pasada (2026-08-05): el patrón que explica todo el ecosistema

La primera pasada se cortó tres veces y quedó incompleta; esta la rehízo consultando la **licencia
SPDX real de cada repo por API** en vez de fiarse de descripciones. El resultado no es una lista de
fuentes: es un patrón.

> **La licencia del repositorio no es la licencia del contenido.** Casi todos los repos de tsumego
> con `LICENSE` permisivo licencian su CÓDIGO mientras sus SGF salen de libros con derechos vivos.
> Nadie puede licenciar —ni MIT, ni AGPL— lo que no le pertenece.

Evidencia directa (consultada 2026-08-05):

| Repo | Licencia declarada | Qué contiene de verdad |
| --- | --- | --- |
| `sanderland/tsumego` («Ten Thousand Tsumego», del autor de KaTrain) | MIT-like, pero el texto empieza *"**Code** is Copyright 2020 Sander Land"* y su `CONTRIBUTORS` agradece a *"Original Tsumego authors"* y *"TsumegoDojo for collecting many of the original files"* | 10.000+ problemas de **Cho Chikun, Ishigure, Fujisawa, Hashimoto Utaro, Lee Changho, Great Tesuji Encyclopedia** — libros con derechos vivos. Y **sin variaciones**: el formato es JSON con UNA jugada (`"SOL": [["B","ob","",""]]`) |
| `bsinglet/life_and_death_go_problems` | GPL-3.0 | Su propio README: *"taken from 'One Thousand and One Life-and-Death Problems' by Richard Bozulich"* (Kiseido, con derechos). Tiene variaciones, pero el copyleft no suple la falta de título |
| `d180cf/problems`, `d180cf/tsumego.js`, `cameron-martin/tsumego-solver`, `Seon82/tasuki2sgf`, `aaronslin/tsumego_clipper` | **NONE** (sin licencia) | — |
| `travisgk/tsumego-pdf`, `benjaminmantle/baduk-study-material` | NOASSERTION | El segundo es la fuente PD de posiciones ya evaluada arriba |
| `destinybird/MaedaNobuaki80` | Apache-2.0 | 80 problemas de Maeda Nobuaki en **texto plano de opción única**, no árboles |
| `Tengu712/tsumegolet` | CC0-1.0 | App Android; el CC0 cubre la app |

Ninguno aporta **árboles de variaciones con cadena de título**. Los que tienen licencia limpia no
tienen variaciones; los que tienen variaciones no tienen título.

### Qué cambia con tengen bajo AGPL (decidido 2026-08-05)

Adoptar AGPL-3.0 (ver `NOTICE.md`) **amplía qué podemos absorber** —ahora también GPL, AGPL y
CC BY-SA, además de lo permisivo— y de paso deja sin efecto la prohibición de licencia sobre
[kaya](https://github.com/kaya-go/kaya) (AGPL↔AGPL es compatible; su encoding sigue siendo
incompleto, así que la razón para no copiarlo pasa a ser técnica y no legal).

Lo que **no** cambia: el problema de las colecciones clásicas nunca fue de compatibilidad de
licencias, sino de **ausencia de cadena de título**. Ninguna licencia de destino arregla eso.

### La vía que ninguna licencia bloquea: generar las variaciones

Un árbol de solución computado a partir de una posición de dominio público es trabajo mecánico
sobre material libre — no obra derivada de la transcripción de nadie. Y existen herramientas
open source para hacerlo bien:

- **`frostburn/tinytsumego` y `tinytsumego2` (MIT)** — *"Algorithms for solving tiny go problems"*:
  solvers **exactos** (no aproximación estadística) para problemas de tablero pequeño.
- **KataGo desktop** (MIT, ya instalado) con búsqueda restringida al área — el método que
  `scripts/spotcheck-tsumego.mjs` ya usa y que en el spot-check de «Primeros pasos» dio gaps
  inequívocos de 8–19 puntos entre solución y ramas incorrectas.

Es decir: las 867 posiciones PD + generación propia es una vía **entera** (posición libre + árbol
propio + verificación reproducible), no un parche.

## Fuentes evaluadas

| Fuente | Qué tiene | Licencia declarada | Veredicto |
|---|---|---|---|
| `benjaminmantle/baduk-study-material` (GitHub) → `importable-sgf/` | Gokyo Shumyo 520 + Xuanxuan Qijing 347, **solo posiciones** (verificado: 0 nodos de jugada) | LICENSE.md, textual: *«Original content in this repo → public domain (CC0)»* y sobre los clásicos: *«centuries old and their positions are public domain. Specific modern scans, typesetting, or translations may carry their own rights.»* | **Apto como set de POSICIONES** (transcripción mecánica de obras de 1812/1349, sin aporte creativo). Sin árboles: no alcanza solo. Linaje: tasuki2sgf → PDFs de tsumego.tasuki.org → u-go.net/Flygo. |
| u-go.net (Ulrich Görtz) — `qjzm-a.sgf` (Gokyo Shumyo, 87 con solución y refutaciones), `xxqj.sgf` (XXQJ 347 con solución), `qjzm.tar.gz` (520; 86 con solución) | **Árboles de solución** (verificado: 318 y 434 nodos de jugada) | **Ninguna.** La página solo documenta permiso de Flygo hacia u-go.net y autoría: *«I added solutions and refutations of certain wrong answers»* (Görtz), *«This file was compiled by Jean-Pierre Vesinet»* (xxqj) | **NO APTO para redistribuir sin permiso.** Contacto publicado: ug@geometry.de. Borrador de mail más abajo. |
| `d180cf/problems` (GitHub, paquete npm `sgf-problems`) | cc1–cc3 (Cho Chikun), gop (goproblems.com), scp | **Ninguna** (sin LICENSE, sin campo `license` legible) | **NO APTO.** Además cc* es Cho Chikun (descartado por decisión previa) y gop es contenido de usuarios de goproblems.com sin cadena de derechos. |
| `tasuki/tsumego` (GitHub, fuente de tsumego.tasuki.org) | Fuentes TeX/SGF de sus PDFs | **Ninguna** | **NO APTO** como fuente directa (y sus libros con solución son el Cho Chikun). |
| `gpoo/scrapeGo` | SGF scrapeados de los PDF de tasuki (Cho, Gokyo, Hatsuyoron) | **Ninguna** | **NO APTO** (sin licencia; posiciones sin árbol). |
| Colecciones de puzzles de OGS (online-go.com) | Gokyo Shumyo / XXQJ subidos por usuarios, con árboles | La API de colecciones **no expone campo de licencia** (verificado contra `api/v1/puzzles/collections`); son subidas de usuarios (típicamente los archivos de u-go.net) | **NO APTO**: mismo problema de cadena de título, con un intermediario más. |
| Cho Chikun (Encyclopedia of Life and Death) | — | — | **Descartado por decisión previa con Edgar (2026-08-03)**: zona gris de licencia en un repo público. Nada de lo visto en este research la mejora (las copias circulantes tampoco declaran licencia). |

## Convención de etiquetado observada (insumo del conversor)

- **Formato uliGo** (u-go.net, verificado contra `qjzm-a.sgf` y el manual de uliGo): `FF[3]`,
  setup con `AB[]`/`AW[]` + `PL[]`; la(s) variación(es) **sin marca = solución**; la primera jugada
  de una refutación va marcada con `TR[]` sobre sí misma. Fragmento real:
  `(;B[br]TR[br]` … — la rama que abre con triángulo es la línea errónea.
- `xxqj.sgf`: **una sola línea principal por problema, sin refutaciones** — incluso con permiso,
  todo desvío iría al motor (que es exactamente el diferencial de tengen).
- El conversor (`apps/web/scripts/convert-tsumego.mjs`) ya cubre el caso general que sí vamos a
  usar: `C[]` con correct/right/good ↔ wrong/bad/failure, `TE[]`/`BM[]`, y heurística
  «primera rama = solución» CON WARNING cuando no hay marca alguna. Si algún día entran los
  archivos uliGo, hay que añadirle la regla `TR`-sobre-la-propia-jugada = rama errónea.

## Decisión operativa tomada en ejecución (revisable en el PR)

Para que la v1 no shipee una sección vacía mientras se decide el contenido clásico:

- **Colección semilla «Primeros pasos», 100 % original de tengen.** Posiciones compuestas a mano
  para este proyecto (formas de manual: nakade de tres, tres doblado — las FORMAS son hechos del
  juego, no expresión ajena; la transcripción SGF es obra propia de tengen). Árboles de solución
  autorados a mano y **validados con KataGo desktop 1.16.5 local a visitas altas** (protocolo de
  spot-check de este mismo documento, aplicado a lo propio). Fuente en
  `apps/web/content/tsumego/primeros-pasos/` (committeada: es obra del repo).
- Las colecciones clásicas **no entran** hasta resolver una de las opciones de abajo. El registro
  `learn/collections.ts` solo importa la semilla.

## Opciones para el contenido clásico (decisión de Edgar)

**A. Pedir permiso a Ulrich Görtz** (ug@geometry.de) para redistribuir `qjzm-a`/`xxqj` con
atribución. Es el camino limpio hacia los árboles clásicos con refutaciones curadas a mano.
Borrador (en inglés, listo para enviar):

> Subject: Permission request: classical problem SGFs (qjzm-a, xxqj) in a free browser Go app
>
> Dear Ulrich, I'm building tengen, a free, open-source browser app for playing and studying Go
> (KataGo running fully client-side). I'd love to include the classical life-and-death collections
> you host at u-go.net/gamerecords-4/ — specifically qjzm-a.sgf (Gokyo Shumyo with your solutions
> and refutations) and xxqj.sgf (Xuanxuan Qijing compiled by Jean-Pierre Vesinet) — as built-in
> exercises, with attribution to you, J.-P. Vesinet and the Flygo project on the collection page.
> Since the page doesn't state a license for these transcriptions, I'm writing to ask whether you
> would grant permission to redistribute them this way (or under a license of your choice, e.g.
> CC BY). Happy to share the project. Thank you for keeping these classics available all these
> years. — Edgar Gomero

**B. Generar árboles propios sobre las 867 posiciones PD** (subset curado de ~100–150 donde el
veredicto sea inequívoco), con KataGo desktop a visitas altas y/o un solver exacto MIT
(`tinytsumego`). Cero riesgo de licencia y escalable, pero **revoca la cláusula del plan** «No se
regeneran árboles con el motor en v1» — por eso no se hizo sin preguntar. Los árboles serían
someros (solución + refutación top), con el motor en vivo cubriendo el resto, que ya es el modelo
de la sección.

**C. Quedarse solo con la semilla original** y crecer a mano (lento, control de calidad total).

A y B son combinables: B como puente hasta que A responda.

> **Elegido por Edgar el 2026-08-04: opción A** (mail a Görtz; la semilla propia crece a mano).
> La segunda pasada de research del 2026-08-05 no cambió esa decisión — solo la respaldó: no
> aparece ninguna colección con árboles y título limpio, y la única alternativa real sigue siendo
> generar (B), que Edgar descartó por ahora.

## Inventario de lo descargado (fuera del repo)

`~/dev/vendor/tsumego-sources/`:
- `tasuki-importable-sgf/` — `gokyo-shumyo.sgf` (520 posiciones) + `xuanxuan-qijing.sgf` (347), con `FUENTE.txt`.
- `ugo-classic/` — `qjzm-a.sgf`, `xxqj.sgf`, `qjzm-full/` (520 sueltos), con `FUENTE.txt`. **No redistribuir.**
- `_inspect/` — repos clonados durante el research (baduk-study-material, d180cf/problems,
  tasuki/tsumego, scrapeGo, etc.), solo para consulta.

## Protocolo de spot-check (para CUALQUIER dataset que se empaquete)

Script: `apps/web/scripts/spotcheck-tsumego.mjs` (herramienta local; KataGo desktop 1.16.5 + la
b18 oficial `.bin.gz` de `setup-katago.sh`, 400 visitas). Dos criterios por ejercicio:

1. **La solución es (co-)óptima LOCAL**: top move con la búsqueda restringida al área del problema
   (`allowMoves`, bounding box del setup +1, `untilDepth:1`), o a ≤1.5 pts de él. La restricción
   local y la tolerancia NO son atajos: en un 19×19 por lo demás vacío el top global es una esquina
   de apertura (medido: Q4/Q16 en los cuatro), y en los problemas de VIVIR "vivir en gote" y "jugar
   afuera" son miai de timing con score idéntico (medido: Δ0.1) — Go normal, no defecto.
2. **Toda rama marcada incorrecta pierde ≥3 pts** contra la solución (misma perspectiva, mismo
   lado al turno). Este es el criterio pedagógico duro.

Discrepancias → lista → curaduría manual antes de publicar. Sin spot-check no se commitea dataset.

## Material de FEDIBERGO (referencia, no empaquetado)

**Fuente:** [fedibergo.org/ensananza](https://www.fedibergo.org/ensananza) — guías de talleres,
problemas y reglas del Go publicadas por la Federación Iberoamericana de Go para descarga gratuita.
Descargado el 2026-09-13 a `fedibergo-ensananza/` (50 PDFs, script en
`fedibergo-ensananza/download.sh`), committeado al repo por decisión de Edgar (2026-09-13, ver fila
siguiente).

| Hecho | Detalle |
| --- | --- |
| Afirmación de Edgar | «Es de uso público» (2026-09-13); decidió commitear los PDFs al repo bajo ese criterio |
| Licencia declarada en la página `/ensananza` | Ninguna explícita sobre el material de enseñanza |
| Footer del sitio | `© Copyright 2017 . All Rights Reserved` — boilerplate del template Joomla, sin fecha ni texto propios del material |
| Contenido actualmente en el producto | La carpeta `fedibergo-ensananza/` vive en el repo como material de referencia; **no** está enlazada desde `apps/web/content/` ni `learn/collections.ts` |

**Veredicto:** agradecimiento público sí (README, NOTICE.md, `/aprender`) — es cortesía por difundir
material de enseñanza del Go, no depende de que exista una licencia formal. Los PDFs en sí quedan en
el repo como referencia bajo el criterio de uso público de Edgar. **Convertir cualquier PDF en un
ejercicio interactivo dentro del producto (`apps/web/content/`, `learn/collections.ts`) sigue el
mismo protocolo que las colecciones clásicas de arriba** — spot-check con el motor como mínimo, y
si hace falta más certeza, escribirle a la federación (mismo formato que el borrador a Ulrich
Görtz).

### Spot-check ejecutado — «Primeros pasos» (2026-08-04): TODO OK

| Ejercicio | Criterio 1 (Δ vs top local) | Criterio 2 (gap por rama incorrecta) |
|---|---|---|
| 001 nakade matar | B19 == top (Δ 0.0) | A19: 7.9 · C19: 7.5 |
| 002 nakade vivir | Δ 0.3 vs O16 | T19: 17.7 |
| 003 tres doblado matar | A1 == top (Δ 0.0) | B1: 8.2 · A2: 8.2 |
| 004 tres doblado vivir | Δ −0.1 vs P5 | S1: 19.1 · T2: 19.1 |

El spot-check además atrapó un bug real de la primera versión de las posiciones: los muros
exteriores tenían huecos diagonales y el motor contraatacaba por ahí (gap −10.9 en el 003; sus
"top moves raros" E17/P17 eran exactamente los puntos de corte). Se reforzaron los cuatro muros
con las piedras conectoras — la lección del método: **el veredicto del motor se mide, las
posiciones no se verifican solo a ojo.**

### Veredicto — Bloque 1 del currículo (talleres 1-5), 100% original

Mismo criterio que «Primeros pasos»: **posiciones compuestas a mano para este proyecto**, inspiradas
en la estructura pedagógica de FEDIBERGO (orden de temas, tipo de problema) pero SIN reproducir sus
diagramas ni su texto. La teoría de cada lección es redacción original de tengen, no traducción ni
resumen ceñido del PDF.

Árboles de solución de las Lecciones 1-3 (jugada, captura, ko) validados por reglas puras
(`objectiveCheck.ts`, sin motor — ver spec `2026-09-15-aprender-curriculo-design.md`, Pieza 3).
Lecciones 4-5 (ojos, técnicas): el spike de la Task 8 (ver entrada de abajo) **descartó** el
spot-check con KataGo desktop para estas dos lecciones — el score del motor no es un árbitro
fiable en posiciones tan dispersas. Se validan con el mismo chequeo de reglas de las Lecciones 1-3
(`objectiveCheck.ts`) + revisión manual de Edgar.

Fuente committeada en `apps/web/content/tsumego/bloque-1/` (obra del repo). El registro
`learn/curriculum.ts` solo importa después de que esta entrada exista — misma regla que
`collections.ts` aplica a `COLLECTIONS`.

### Spike de spot-check -- Lecciones 4-5 (2026-09-15)

**Qué se probó.** 3 posiciones borrador de "ojos" en 9×9 (formato `Exercise`, sin comprometer
contenido final), corridas contra KataGo desktop 1.16.5 con una COPIA adaptada de
`spotcheck-tsumego.mjs` (`boardXSize/YSize: 9`, `komi: 5.5`, mismo `maxVisits=400`, misma config
`analysis_example.cfg` y modelo `b18c384nbt.bin.gz` — la copia vivió fuera del repo y se borró al
terminar; nada de este spike es código de producto):

1. **Ojo simple en atari** — anillo blanco de 8 piedras sellado por un muro negro, una sola
   libertad (el propio ojo en (1,1)). Correcta: capturar ahí. Incorrectas: 2 tenukis.
2. **Ojo grande con punto vital** — ojo de tres en línea (straight-three) sellado, 12 piedras
   blancas. Correcta: el punto vital central. Incorrectas: los dos extremos.
3. **Control** — grupo blanco de 16 piedras con DOS ojos reales confirmados por cómputo (4/4
   diagonales propias en ambos), sin negras en el tablero. Sin sellar por fuera (a propósito: un
   grupo con 2 ojos reales es invulnerable pase lo que pase afuera).

**Resultado crudo (gaps en puntos, criterio 2 — el "criterio pedagógico duro" del protocolo).**

| Posición | Comparación | Resultado |
|---|---|---|
| 1 (ojo simple) | capturar vs. tenuki cercano (4,4) | **gap −7,1** (tenuki gana) |
| 1 (ojo simple) | capturar vs. tenuki lejano (7,7) | **gap −14,9** (tenuki gana, por más) |
| 2 (punto vital) | centro vs. extremo izquierdo | gap 3,7 (centro gana, roza el umbral ≥3) |
| 2 (punto vital) | centro vs. extremo derecho | gap 3,9 (centro gana, roza el umbral ≥3) |
| 3 (control) | tenuki (7,2) vs. toque ocioso cerca de un ojo (×2) | gap 20,4 / 20,0 (tenuki gana claro) |
| 3 (control, re-medido) | 3 toques ociosos LOCALES entre sí (sin tenuki de por medio) | scoreLead −85,3 / −84,2 / −84,8 — **dispersión ≤1,0 pt entre sí** |

El criterio 1 (co-optimalidad local vía `allowMoves`+`untilDepth:1`) falló en las 3: top local
Δ7,0 / Δ18,0 / Δ∞. Diagnóstico manual (`rootInfo.scoreLead` sin restricción) confirmó que no es un
artefacto de script: capturar el ojo simple puntúa 21,5; tenuki cercano 29,3; tenuki lejano 37,0;
el mejor movimiento libre del motor (ni siquiera dentro del área local) 46,3 — un gradiente limpio
y monótono, no ruido.

**Diagnóstico (no es ruido, es una magnitud distinta a la que gobierna la lección).** El motor
está midiendo bien — mide el score total de una partida de área en un 9×9 casi vacío, y esa
magnitud NO es la misma que "¿esta jugada resuelve el ejercicio de ojos?":

1. **El anillo de la posición 1 está incondicionalmente muerto** (una libertad, sellado, no puede
   hacer un segundo ojo) — bajo reglas de área, esos puntos ya son de negras al final de la
   partida sin necesidad de jugar ahí. Capturar ahora no suma nada que negras no tuvieran ya
   asegurado, y gasta un turno que vale ~25 puntos en un tablero casi vacío. El motor tiene razón:
   tenuki puntúa mejor. "Correcto para la lección" (reconocer y ejecutar la captura) y
   "score-óptimo" no son lo mismo — eso es estructural en un 9×9 disperso, no un defecto de esta
   posición particular.
2. **La restricción de área local no aísla nada en un 9×9 disperso.** El bounding box (setup ±1)
   de un puñado de piedras sueltas cubre la mayor parte de un tablero de 81 puntos, así que el
   criterio 1 termina comparando la jugada de la lección contra jugadas de apertura de tablero
   abierto (posición 2: top local Δ18) — o, en el caso de la posición 3, la solución cae directo
   FUERA del área local (Δ∞). El mecanismo que aísla bien un tsumego en 19×19 no tiene poder de
   aislamiento acá.
3. **El gap de 3,7/3,9 de la posición 2 "pasa" el umbral, pero por el motivo equivocado.** Matar un
   grupo sellado de 12 piedras con su espacio de ojo vale del orden de 30-40 puntos (ver el
   gradiente de la posición 1). Un gap de 3,7 libra el umbral ≥3 con un margen que es un orden de
   magnitud menor que lo que realmente está en juego — señal de que, a 400 visitas, la búsqueda
   reparte su presupuesto en jugadas de tablero abierto (que valen 10-20 puntos) y nunca termina de
   resolver la pelea de vida y muerte local. Es exactamente el error de "umbral que roza" que ya
   está en la memoria del proyecto: el número librado no mide la magnitud que gobierna la posición.
4. **El "control" tal como está armado (tenuki `correct`, toques ociosos `incorrect`) no controla
   lo que dice controlar** — mide "punto grande vs. jugada desperdiciada", no "nada funciona acá".
   El control real está en la fila re-medida: 3 toques ociosos LOCALES comparados ENTRE SÍ (sin
   tenuki de por medio) caen dentro de 1,0 punto uno de otro. Ahí sí el motor muestra que, cuando
   la respuesta correcta es "nada local funciona", no inventa gaps falsos entre jugadas locales
   igual de inútiles — la señal es limpia en ESE eje. El problema no es ruido aleatorio del motor;
   es que compara contra la magnitud equivocada (todo el tablero) en vez de la magnitud de la
   lección (la pelea local de vida y muerte).

**Veredicto: Protocolo B — mismo chequeo de reglas de las Lecciones 1-3 (`objectiveCheck.ts`) +
revisión manual de Edgar.** No por ruido del motor (el motor lee bien, y de hecho la posición de
control confirma que no fabrica gaps falsos entre jugadas locales). Es porque, en un 9×9 disperso,
el score total de KataGo mide el valor de toda la partida, dominado por el tablero abierto, y esa
magnitud sistemáticamente no coincide con "¿esta jugada resuelve el objetivo de vida y muerte de
la lección?" — ni el criterio 1 (co-optimalidad local, sin poder de aislamiento acá) ni el criterio
2 (gap ≥3, superable por un margen que no refleja el valor real de la posición) miden lo que
la lección necesita verificar. Aumentar visitas podría angostar el problema de presupuesto del
punto 3, pero no resuelve el 1 ni el 2, que son estructurales al tamaño y dispersión del tablero —
no vale la pena perseguirlo para 2 de 5 lecciones cuando el chequeo de reglas puro ya cubre 1-3 sin
depender del motor.
