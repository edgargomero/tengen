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
