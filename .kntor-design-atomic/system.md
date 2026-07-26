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
| Kaya (acento único) | `--kaya` (relleno) · `--kaya-hover` · `--kaya-press` · `--kaya-on` · **`--kaya-ink`** (texto) · `--kaya-soft` · `--focus-ring` |
| Semántico | `--tone-success` · `--tone-warning` · `--tone-danger` · `--tone-danger-soft` · `--analyzed` |
| Controles | `--control-bg` · `--control-border` · `--control-hover` · `--control-press` |
| Espaciado / radios | `--sp-0..6` · `--radius-sm/md/lg` |
| **Tipografía** | `--text-xs/sm/md/base/lg` · `--weight-medium/semibold/bold` · `--leading-tight/normal` · `--tracking-tight/eyebrow` |
| Movimiento / chrome | `--motion-fast` · `--topbar-h` |
| Proporciones del template | `--board-max` (46rem) · `--rail-w` (18rem) · `--rail-w-min` |

**Los colores de TEXTO se eligen por contraste medido, no a ojo.** Dos correcciones que salieron de
medir en vez de mirar:

- `--ink-3` (eyebrows, hints, pestañas inactivas) pasa AA sobre las tres superficies claras:
  surface 5.31 · canvas 4.99 · inset 4.62. El valor anterior daba **3.18** sobre `inset`.
- **El acento se parte en dos:** `--kaya` es RELLENO/borde (el oro del goban lo justifica como
  superficie; blanco sobre él da 6.18), y `--kaya-ink` es TEXTO. Usar el kaya de relleno como tinta
  daba 3.42 sobre `--kaya-soft` y 4.13 sobre `--surface` — el reloj del jugador activo, el dato más
  urgente de la pantalla de Jugar, era el texto **menos** legible del rail. `--kaya-ink` pasa AA en
  las cuatro combinaciones reales (6.00 · 5.64 · 5.30 · 4.71). Sigue habiendo un solo hue de acento.

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
salteados) · **Contraste AA verificado par por par** (`--ink-3` sobre las 3 superficies; `--kaya-on`
sobre relleno kaya; `--kaya-ink` sobre surface, canvas y `--kaya-soft` en sus dos fondos) · **Cero
literal suelto y cero clase muerta** (auditado con script en ambas direcciones: markup→CSS y
CSS→markup) · **Render verificado en Chrome** de las cuatro pestañas de Analizar, ambas pantallas de
tablero y las de sistema, a 500/820/1440/1600px de ancho.

## Deuda conocida

- Sin modo oscuro (`color-scheme: light`): decisión, no omisión — el goban de Shudan es una superficie
  clara y un chrome oscuro alrededor pelearía con él. Si algún día se hace, los tokens ya son el
  único punto de cambio.
- `.rail-body` scrollea sin afordancia visual explícita (se ve la fila cortada, que es el patrón
  estándar). Un fade condicional al overflow sería la mejora.
