# Sistema de diseño — tengen

> Atomic Design de la interfaz de tengen (Go/Baduk sobre Cloudflare). Vive en `apps/web/src/styles/app.css`
> (organizado por nivel atómico) y componentes en `apps/web/src/ui/`.
> Establecido 2026-07-25 · revisado a fondo 2026-07-26 (pasada de crítica).

## Dirección y feel

**"La interfaz es el salón alrededor del goban", variante SOBRIA.** El usuario está estudiando una
partida de Go, concentrado; el **tablero es el único héroe**. El calor y el color viven en el TABLERO
(madera *kaya* + piedras de pizarra/concha); el *chrome* lo rodea en **gris-tinta cálido casi-neutro**,
y el oro-kaya (`--kaya`) aparece **solo en estados activos/primarios**. Regla de craft: *gris construye
estructura, el color comunica*.

- **Profundidad:** UNA estrategia — **tinte de superficie**. La jerarquía se percibe sin bordes
  (`canvas → surface → surface-raised`, con `inset` para lo que recibe contenido); los bordes susurran
  y nunca cargan solos la estructura. Única sombra permitida: el lift de 1px del segmento activo.
- **Espaciado:** base **4px** (`--sp-1..6`), con un micro paso de 2px (`--sp-0`) para hairlines.
- **Densidad como decisión:** el rail tiene tres zonas — lectura (respira), contenido, herramientas
  (densa). El mismo 12px es correcto en una y perezoso en otra.
- **Un solo acento:** `--kaya`. Nunca un segundo hue decorativo, **en ninguna pantalla** (la de
  descarga del modelo tenía una barra azul; ya no).
- **Movimiento:** una sola duración (`--motion-fast`, 90ms). La UI *responde*; no se anima.

## Nivel 0 — Tokens (el ADN)

> Estado de aplicación: **100% tokenizado en color, espaciado, radios Y TIPOGRAFÍA**. Cero hex,
> `font-size`, `font-weight` o paso de espaciado suelto fuera de `:root`. Excepciones intencionales
> y documentadas en el propio archivo: `outline-offset: 1px` (hairline de foco), medidas de imagen
> (64px del ícono, 24px del avatar), anchos máximos de tarjeta (`28/32/40rem` — decisión por pantalla,
> no espaciado de componente), y el pill de pérdida en `em` (escala con el `vertexSize`).

Definidos en `:root` de `app.css`.

| Grupo | Tokens |
| --- | --- |
| Superficies | `--canvas` · `--surface` · `--surface-raised` · `--inset` |
| Tinta (4 niveles, gris cálido) | `--ink-1` · `--ink-2` · `--ink-3` · `--ink-4` |
| Bordes | `--border-1` · `--border-2` · `--border-strong` |
| Kaya (acento único) | `--kaya` (relleno) · `--kaya-hover` · `--kaya-press` · `--kaya-on` (tinta sobre el relleno) · **`--kaya-ink`** (texto en acento) · `--kaya-soft` · `--focus-ring` |
| Semántico | `--tone-success/warning/danger` (texto) · `--tone-*-solid` + `--tone-on-solid` (relleno sobre el goban) · `--tone-danger-soft` · `--analyzed` |
| Fuera del tema | `--stone-black` · `--stone-white` (una piedra negra es negra en cualquier tema) |
| Profundidad | `--shadow-1` (lift del segmento activo) · `--shadow-scroll` (afordancia del rail) |
| Controles | `--control-bg` · `--control-border` · `--control-hover` · `--control-press` |
| Espaciado / radios | `--sp-0..6` · `--radius-sm/md/lg` |
| **Tipografía** | `--text-xs/sm/md/base/lg` · `--weight-medium/semibold/bold` · `--leading-tight/normal` · `--tracking-tight/eyebrow` |
| Movimiento / chrome | `--motion-fast` · `--topbar-h` |
| Proporciones del template | `--board-max` (46rem) · `--rail-w` (18rem) · `--rail-w-min` |

**Los colores de TEXTO se eligen por contraste medido, no a ojo.** Cuatro correcciones salieron de
medir en vez de mirar — y las últimas dos, de medir el DOM **renderizado** en vez de la paleta:

- `--ink-3` (eyebrows, hints, pestañas inactivas) pasa AA sobre las tres superficies claras:
  surface 5.31 · canvas 4.99 · inset 4.62. El valor anterior daba **3.18** sobre `inset`.
- **El acento se parte en dos:** `--kaya` es RELLENO/borde y `--kaya-ink` es TEXTO. Usar el kaya de
  relleno como tinta daba 3.42 sobre `--kaya-soft` y 4.13 sobre `--surface` — el reloj del jugador
  activo, el dato más urgente de la pantalla de Jugar, era el texto **menos** legible del rail.
  `--kaya-ink` pasa AA en las cuatro combinaciones reales (6.00 · 5.64 · 5.30 · 4.71). Sigue
  habiendo un solo hue de acento.
- **La acción primaria lleva tinta OSCURA sobre el oro, no blanca.** El oro es un color claro:
  blanco sobre `--kaya` da **2.71** — fallaba AA de largo, en ambos temas, en el botón más
  importante de la app. Con `--kaya-on: #201d18` da 6.19. Consecuencia coherente: hover **aclara**
  (7.31) en vez de oscurecer, porque con texto oscuro el relleno que se hunde es el que se vuelve
  ilegible; press baja, pero solo hasta 5.10.
- **`--tone-success` y `--tone-warning` también fallaban** (4.30 y 4.01 sobre `inset`). Y warning se
  movió de hue 39 a 29: en hue 39 era el mismo color que el acento (kaya 37 / kaya-ink 39) y el canal
  semántico se perdía — en tema oscuro llegaban a ser indistinguibles píxel a píxel.

Lección de método, no de color: **la paleta se audita sobre el DOM pintado.** Los tres últimos
fallos sobrevivieron a una ronda de aritmética sobre valores sueltos (un `#` faltante en un parser
de hex daba 6.18 donde el navegador medía 2.71) y solo cayeron al recorrer los nodos reales
resolviendo el fondo efectivo capa por capa.

**Las proporciones dicen algo:** tablero hasta 46rem contra un rail de 18rem (~2.5:1) declara *"el rail
sirve al tablero"*, no *"son pares"*. El par centrado no lleva ancho máximo propio: la suma ya lo acota.

## Nivel 1 — Átomos

- **Botón** (`button`): superficie + borde-susurro, quieto y recesivo. Estados **obligatorios**: hover,
  **press** (`--control-press`), focus-visible, disabled. Sin los tres, la interfaz es una foto de software.
  - `.primary` — la ÚNICA acción con relleno `--kaya`. Una por pantalla (ni una ficha de árbol se la roba).
  - `.ghost` — sin borde, `--ink-2`; para lo que se apaga. Es una clase real en el markup, no una regla
    de descendencia escondida en una molécula.
- **Control de entrada** (`select`, `input[type=number]`, `textarea`): fondo `--inset`, focus-ring.
- **`.eyebrow`** — etiqueta que nombra un dato sin competir con él: xs + caja alta + tracking + `--ink-3`.
  Es el eje que faltaba: la jerarquía no la carga el tamaño solo.
- **`.stat` / `.stat-value`** — la cifra que el usuario mira: lg, semibold, tabular.
- **`.notice`** (+ `--accent` / `--danger` / `--quote`) — UN átomo para todo mensaje en caja. Reemplaza
  a `.play-error` / `.play-exploring` / `.analyze-editing` / `.play-result` / `.form-error` / `.analyze-comment`.
- **`.hint`** — texto de apoyo y estados vacíos. Reemplaza a seis clases casi idénticas.
- **Pill de tono** (`.tone-*`): calidad de jugada.
- **Glifo de piedra** (● / ○): motivo recurrente ("Tú: ● Negro", "● 0 · ○ 0", "WINRATE ●").

## Nivel 2 — Moléculas

- **`.segmented`** — cambio de VISTA (pestañas del rail, modo Jugar/Analizar). El activo se ELEVA a
  `--surface-raised` en neutro: está *adelante*, no *encendido*. `--fill` reparte el ancho.
- **`.choice-row`** — elegir un AJUSTE (velocidad, herramienta). Acá sí manda el kaya tenue: el elegido
  está *encendido*. Distinción deliberada frente a `.segmented`.
- **`.nav-cluster`** — ⏮ ◀ ▶ ⏭ y los saltos entre errores.
- **`.action-row`** — acciones que comparten ancho (el tratamiento fantasma lo pone cada botón).
- **`.meta-row` / `.rail-meta`** — pares etiqueta/valor densos (Oponente, Tú, Capturas).
- **`.rail-field`** — eyebrow + control (equivalente denso de `.field`).
- **`.progress-track` / `.progress-fill`** — barra de descarga, en kaya.
- **BrandNav** (`.topbar-brand`) — marca (home) + `·` + ubicación.

## Nivel 3 — Organismos

- **TopBar** (`.topbar`, `ui/TopBar.tsx`): **chrome de la VENTANA, no del contenido** — la banda cruza
  el viewport entero. Antes compartía el ancho centrado del contenido y quedaban dos bordes compitiendo,
  uno más ancho que el otro (la "deuda de alineación" que este cambio elimina, no documenta). Alto fijo
  (`--topbar-h`) porque el cálculo no-scroll del tablero depende de que no cambie con su contenido.
- **`.study-rail`** — la columna de trabajo. Es una **superficie** (`--surface`), no un borde: se percibe
  como panel aunque le quites las líneas. Sin padding propio: cada región trae el suyo, así los
  separadores cruzan el rail de lado a lado **sin un solo margen negativo**.
  - `.rail-header` (lectura: el dato + la acción primaria) · `.rail-tabs` · `.rail-body` (contenido,
    **la región de scroll**) · `.rail-footer` (herramientas, densa). Única sección con caja de scroll
    propia: el grafo del árbol, que es un lienzo de dos ejes (verificado: 660px de ancho con 20
    jugadas contra 262px de rail). Nunca hay dos barras apiladas.
- **AnnotationEditor** — bandeja HUNDIDA (`--inset`) dentro del rail. La paleta es una rejilla de 5
  celdas iguales; "jugar piedra" ocupa su propia fila (no es una marca).
- **Árbol de jugadas** — `GameTreeGraph` (SVG, Analizar) y `GameTreePanel` (lista, Jugar). El nodo del
  cursor usa el estado *seleccionado* (kaya tenue), nunca el relleno kaya pleno.

## Nivel 4 — Template "estudio de tablero"

```
┌ TopBar (chrome de la ventana, full-bleed) ──────────────────┐
├ .study-main ────────────────────────────────────────────────┤
│   .study-board (héroe, llena la altura)  │  .study-rail      │
└─────────────────────────────────────────────────────────────┘
```

UN esqueleto para Jugar y Analizar (antes eran dos copias idénticas con nombres distintos:
`.play-view`/`.analyze-view`, `.play-panel`/`.analyze-panel`…). En desktop el shell toma el viewport y
la PÁGINA nunca scrollea; en mobile se apila y la página scrollea.

**Regla estructural que hay que respetar:** `.study-main` **nunca** lleva `margin-inline: auto`. Un
margen automático en el eje transversal cancela el `stretch` del flex item; su ancho pasa a depender del
contenido, y como el tablero se dimensiona a partir de esa misma caja, eso es una **dependencia
circular** (se manifestaba como tablero minúsculo en desktop y desborde horizontal en mobile). El par se
centra con `justify-content: center`.

Por eso `useBoundedBoardSize` puede **medir** la caja real en desktop en vez de adivinar
`innerHeight - 96`: con el shell de alto definido y `nowrap`, el alto de `.study-board` lo fija el
layout. En mobile sí se deriva de la ventana (ahí el wrapper crece con su contenido y medirlo sería
circular). El breakpoint 768px está espejado en el CSS y en el hook — si cambia en uno, cambia en el otro.

## Contenido

Registro unificado en **tuteo** ("Elige", "Haz clic", "¿Qué quieres hacer?"). Había tres cadenas en
voseo conviviendo con el resto en tuteo entre pantallas adyacentes.

## Checks pasados (el mandato)

Swap · Squint (el tablero domina) · Signature (kaya primario, glifos ●○, pestañas tipo kifu) · Token ·
Atomic (page → template estudio → organismos → moléculas → átomos → tokens, cadena limpia, sin niveles
salteados) · **Contraste AA auditado sobre el DOM renderizado**, recorriendo cada nodo con texto y
resolviendo su fondo efectivo capa por capa: **cero fallos en los dos temas**, en las cuatro
pestañas de Analizar, la pantalla de Jugar, las tarjetas y las de sistema · **Cero literal suelto y
cero clase muerta** (auditado con script en ambas direcciones: markup→CSS y CSS→markup) · **Render
verificado en Chrome** a 500/820/1440/1600px de ancho, en claro y en oscuro.

> El auditor de contraste vive en el historial de esta sesión, no en el repo. Si se retoma el
> sistema, vale la pena volver a correrlo: los tres fallos más graves (botón primario, success,
> warning) sobrevivieron a una ronda de cálculo sobre la paleta y solo cayeron midiendo lo pintado.

## Tema oscuro

Sigue `prefers-color-scheme`, sin toggle ni estado que persistir. No es una segunda piel: es **la
misma dirección llevada a su conclusión** — si la interfaz es el salón alrededor del goban, con la
sala a oscuras el tablero pasa a ser lo único iluminado de la pantalla. Por eso el goban no se toca
(sigue siendo madera) y solo se apaga el chrome.

El bloque `@media (prefers-color-scheme: dark)` redefine **solo** los tokens que dependen del tema.
Espaciado, radios, tipografía, proporciones y todo lo que vive sobre el goban (`--stone-black/white`,
`--tone-*-solid`, `--tone-on-solid`, `--kaya`, `--kaya-on`) son los mismos — que es exactamente lo
que un nivel 0 bien hecho tiene que permitir.

Tres cosas que se invierten y una que no:

- **La escala de superficies se invierte**: elevar sigue siendo aclarar, así que `canvas → surface →
  raised` sube en luminancia igual que en claro. Los bordes pasan a ser luz sobre oscuro.
- **Hover y press aclaran**: en oscuro, "más cerca del dedo" es más luz. Siguen siendo colores
  opacos, no overlays translúcidos — un rgba reemplazaría el fondo del botón en vez de sumarse, y el
  átomo perdería su superficie justo al tocarlo.
- **`--kaya-ink` va hacia el otro lado**: más claro (`#d9a24a`), no más profundo.
- **El relleno kaya NO cambia**: es la madera, y su tinta oscura pasa AA en ambos temas.

Un detalle que solo aparece en oscuro: el nodo de piedra negra del grafo del árbol es negro sobre
fondo oscuro, así que `--stone-outline` es lo único de ese trío que sí cambia — es lo que la despega
del lienzo.

## Decisiones que parecen deuda y no lo son

- **Sin toggle manual de tema.** La preferencia del sistema alcanza y no introduce estado que
  guardar, sincronizar ni testear.
- **El glifo ● en "WINRATE ●" no se colorea.** En oscuro no existe un "punto negro" legible sobre
  fondo oscuro; lo que comunica es *relleno vs. hueco* (●/○), que sobrevive a los dos temas. La
  perspectiva va además en el `title`, y el `SCORE` de al lado ya nombra el color ("B+3.2").
- **`.rail-body` scrollea con sombras de fondo, sin JS.** Las capas `local` viajan con el contenido
  y tapan a las `scroll`, clavadas al borde: la sombra aparece solo del lado por el que hay más, y
  no aparece nunca si todo entra. Verificado en los tres estados (arriba, en medio, abajo).
