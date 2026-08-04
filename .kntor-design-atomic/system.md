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
  y nunca cargan solos la estructura. Las sombras son la excepción, y hay exactamente **dos**, ambas
  con una razón que el tinte no puede cubrir: el lift de 1px del segmento activo (`--shadow-1`) y la
  elevación del único elemento que FLOTA sobre el contenido, el aviso de la PWA (`--shadow-overlay`)
  — un elemento despegado del plano no tiene detrás un fondo fijo contra el cual contrastar.
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
| Profundidad | `--shadow-1` (lift del segmento activo) · `--shadow-scroll` (afordancia del rail) · `--shadow-overlay` (lo único que flota) |

**Los tokens de baja opacidad se DERIVAN, no se copian.** `--border-*`, `--kaya-soft`, `--focus-ring`,
`--tone-danger-soft` y `--control-press` usan `color-mix(… , transparent)` sobre el token del que
dependen, en vez de repetir sus canales en un `rgba()`. No es cosmética: un `rgba(202,147,58,.14)`
es una copia muda de `--kaya` que ninguna auditoría detecta —ni la de `var()`, porque es un literal,
ni la de contraste, porque no es texto— y que se desincroniza en silencio la próxima vez que alguien
ajuste el acento. Como beneficio extra, los bordes derivados de `--ink-1` **se dan vuelta solos** con
el tema y el bloque oscuro no necesita redefinirlos. Las únicas rgba que quedan son las sombras, que
no derivan de nada: una sombra no es tinta.
| Controles | `--control-bg` · `--control-border` · `--control-hover` · `--control-press` |
| Espaciado / radios | `--sp-0..6` · `--radius-sm/md/lg` |
| **Tipografía** | `--text-xs/sm/md/base/lg` · `--weight-medium/semibold/bold` · `--leading-tight/normal` · `--tracking-tight/eyebrow` |
| Movimiento / chrome | `--motion-fast` · `--topbar-h` (3rem) · **`--navbar-h`** (3.5rem) · **`--nav-inset`** |
| Proporciones del template | `--board-max` (46rem) · `--rail-w` (18rem) · `--rail-w-min` |

**`--nav-inset` es un token CONDICIONAL, y es el único.** Vale `0px` en `:root` y sólo toma cuerpo
(`calc(var(--navbar-h) + env(safe-area-inset-bottom))`) dentro del media query donde la barra
inferior existe. Eso permite que el mismo `padding-bottom` sirva en las dos formas de viewport sin
un solo condicional en el CSS de contenido. Lo que **no** permite es leerlo desde JS:
`getComputedStyle(root).getPropertyValue('--nav-inset')` devuelve la string `calc(…)` sin resolver
(verificado en Chrome), así que `useBoundedBoardSize` mide el `offsetHeight` del nodo real — misma
disciplina que el auditor de contraste, se mide lo pintado.

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
- **`.link-button`** — un `<a href>` que ES un botón: mismo alto, mismos estados, y `.primary`/`.ghost`
  significan ahí lo mismo que en un `<button>`. Nació de un fallo concreto: era la regla de descendencia
  `.mode-menu a`, y en cuanto el menú tuvo un enlace que pedía `.ghost` (el que va al diagnóstico), le
  llegó el borde del menú igual — **una regla de descendencia se aplica por dónde está el elemento, no por
  lo que el elemento dice ser.** Lo usan las tres pantallas que navegan con enlace real en vez de router
  (menú, cartel de "hace falta WebGPU", diagnóstico). Trae el `:focus-visible` que los enlaces del menú
  nunca tuvieron.
- **Control de entrada** (`select`, `input[type=number]`, `textarea`): fondo `--inset`, focus-ring.
- **`.eyebrow`** — etiqueta que nombra un dato sin competir con él: xs + caja alta + tracking + `--ink-3`.
  Es el eje que faltaba: la jerarquía no la carga el tamaño solo.
- **`.stat` / `.stat-value`** — la cifra que el usuario mira: lg, semibold, tabular.
- **`.notice`** (+ `--accent` / `--danger` / `--quote` / **`--warning`**) — UN átomo para todo mensaje en
  caja. Reemplaza a `.play-error` / `.play-exploring` / `.analyze-editing` / `.play-result` / `.form-error`
  / `.analyze-comment`. `--warning` (fase Aprender) es el veredicto intermedio de la refutación del motor:
  texto en `--tone-warning` sobre la caja neutra, sin fondo tintado propio — la gravedad la dice el texto.
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
- **`.menu-footer`** — el pie del menú: la zona que habla del PROGRAMA (quién sos, qué versión corre),
  separada del contenido por una línea. **Una molécula con dos usos** —identidad/login y
  versión/actualizar—, no dos clases parecidas: antes era `.session-box`, y al aparecer el segundo pie la
  alternativa era duplicar su tratamiento con otro nombre. Variantes: `--session` (reserva alto mientras
  el get-session vuela) y `--stacked` (segundo renglón para el resultado del chequeo).
- **BrandNav** (`.topbar-brand`) — marca (home) + `·` + ubicación.
- **`.field-row`** — campos que comparten fila (komi + handicap; los tres números del reloj). Reparto
  parejo con `wrap`: en un teléfono angosto la fila se parte sola, sin media query.
- **`.exercise-row`** (fase Aprender) — fila-botón de la lista de tsumegos: hereda TODOS los estados del
  átomo botón y solo ajusta la anatomía interna (glifo de estado + nombre + objetivo como metadata en caja
  alta). La FIRMA de la sección es el estado como el motivo ●○ del sistema: `●` resuelto (`--tone-success`
  — success acá es un hecho consumado del usuario, no una promesa del motor), `○` intentado y `·` pendiente
  (ambos `--ink-3`: **"pendiente" es información, no un placeholder** — con `--ink-4` daba 2.91 en oscuro,
  atrapado por contrast-audit; la distinción intentado/pendiente la carga el glifo, no el color).
- **`.form-details`** — la liturgia con defaults correctos, plegada. `<details>` nativo (teclado,
  lector de pantalla y estado gratis) con DOS voces en el summary: el nombre (eyebrow) y el estado
  actual de lo plegado (`.form-details-current`) — **cerrado sigue siendo honesto** sobre con qué se
  va a jugar. Trampa aprendida: `display: flex` en el summary lo saca del modo list-item y el
  navegador deja de pintar el marcador nativo — el pliegue queda sin ningún indicio de que se abre;
  el `::before` (▸/▾, tinta terciaria) lo repone. Nació en Nueva partida: 1325px de documento para
  CUATRO decisiones reales (tamaño, rival, fuerza, color) → con la liturgia plegada, el formulario
  entero entra en un viewport de teléfono (844px) con la acción primaria visible sin scrollear.

## Nivel 3 — Organismos

- **TopBar** (`.topbar`, dentro de `ui/AppFrame.tsx`): **chrome de la VENTANA, no del contenido** — la
  banda cruza el viewport entero. Antes compartía el ancho centrado del contenido y quedaban dos bordes
  compitiendo, uno más ancho que el otro (la "deuda de alineación" que este cambio elimina, no documenta).
  Alto fijo (`--topbar-h`) porque el cálculo no-scroll del tablero depende de que no cambie con su
  contenido — por eso el badge de sesión usa los tokens compactos `--ctl-*` y no el padding por defecto
  del átomo botón, que la desbordaría en vez de agrandarla. Es `sticky`, no `fixed`: se queda arriba
  al scrollear sin salir del flujo ni obligar a compensar su alto con un padding paralelo.
  **Ya NO la montan las vistas.** Ese era el fallo estructural: `PlayView` y `AnalyzeView` eran sus dos
  únicos usos, así que una pantalla nueva no heredaba nada y las cuatro sin tablero (menú, nueva partida,
  mis partidas, picker de SGF) se quedaron sin chrome. Ahora la monta el marco.
- **AppBar** (`.appbar`, dentro de `ui/AppFrame.tsx`): los destinos al alcance del pulgar, en el viewport
  **angosto y alto**. Es `fixed` porque en un formulario de 1196px una barra al final del documento
  estaría a 1,4 pantallas de scroll — exactamente el problema que existe para eliminar. **Sin sombra:**
  no flota sobre el contenido como el `PwaToast` (un aviso despegado del plano), está anclada a un borde
  de la ventana; un borde-susurro es toda la separación que necesita.
  - **El destino activo es la TERCERA expresión del mismo acento**, no un cuarto patrón: `.segmented`
    eleva a `--surface-raised` (*está adelante*) y `.choice-row` usa el kaya tenue de fondo (*está
    encendido*); acá no sirve ninguno — la barra es full-bleed, así que no hay superficie contra la
    cual despegarse, y pintar una celda de 56px sería el bloque de color más grande de la app en una
    interfaz cuya regla es que el color vive en el TABLERO. Queda la TINTA: `--kaya-ink` (6.00 sobre
    `--surface` en claro, 7.37 en oscuro) más el peso, que es el segundo eje de jerarquía del sistema.
  - **Se renderiza SIEMPRE y se apaga con CSS.** No es pereza: `useBoundedBoardSize` mide su
    `offsetHeight`, y con render condicional por JS esa medición daría 0 justo donde la barra sí existe.
  - **La etiqueta va en `--text-sm`, el mismo cuerpo que `.segmented button`** — las dos formas de los
    mismos destinos comparten paso tipográfico. No `--text-xs`: ese es el paso de metadata/eyebrows, y
    acá la etiqueta es TODO el afordance (no hay ícono encima, como en una tab bar nativa) — una acción
    no puede vestirse de metadata. Y el anillo de foco va hacia ADENTRO (`outline-offset: -2px`): la
    celda toca el borde del viewport y el offset positivo del átomo lo dibujaría recortado.
- **Badge de sesión** (`.topbar-session`): el estado de cuenta, presente en toda pantalla y no sólo en el
  menú. Dos formas del mismo lugar — `<button>` sin sesión (la única acción que el marco ofrece, porque
  es la que arregla el problema: sin ella la partida no se guarda en la nube y nada lo decía) y `<span>`
  no interactivo con ella. **"Cerrar sesión" se queda en el menú** a propósito: un toque accidental sobre
  el chrome no puede desconectarte a mitad de una partida.
  - **El email se apaga por debajo de 768px.** Con él, el badge mide 208px medidos contra los 24 de un
    avatar solo, y lo que cede por él es la UBICACIÓN — la mitad del punto del marco. Sin él, el peor
    caso a 390px (ubicación "Mis partidas" + sesión + chip de sin conexión) entra sin recortar nada.
    El avatar se queda porque lo que hay que leer de un vistazo es *"hay alguien logueado"*, no quién;
    el email completo sigue en el `title` y en el menú.
  - Verificado que **no mueve `--topbar-h`**: 48px con el badge puesto, que es el contrato del que
    depende el cálculo no-scroll del tablero.
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
- **PwaToast** (`.pwa-toast`, `pwa/PwaToast.tsx`): el ÚNICO elemento que flota sobre el contenido, y
  por eso el único con `--shadow-overlay`. Vive fuera del template de estudio (lo monta `Root` en
  `main.tsx`, junto al registro del service worker) porque no pertenece a ninguna pantalla: informa
  de la app, no de la partida. Dos mensajes, con tratamientos distintos a propósito — el de versión
  nueva trae `.primary` + `.ghost` y **no se autodescarta** (es una acción que el usuario toma cuando
  quiere); el de "listo sin conexión" es informativo y se va solo a los 6 s.
- **Chip de conexión** (`.offline-chip`, dentro de la TopBar): tinta terciaria y borde-susurro, NO el
  tono de peligro. Sin red se sigue jugando y analizando —el motor y los pesos están en el
  dispositivo—; lo único que se apaga es guardar en la nube. Pintarlo de rojo mentiría sobre la
  gravedad.

## Nivel 4 — Template "marco de app"

El esqueleto que envuelve a todos los demás (`.app-frame`, `ui/AppFrame.tsx`). Lo monta `ModeApp` una
sola vez **alrededor del `<Router>`**, así que toda ruta presente y futura lo hereda sin hacer nada.
Ese es el punto entero: antes el chrome era opt-in y por eso faltaba en cuatro pantallas; ahora es
opt-out.

```
ANCHO (≥768px, incluido cualquier teléfono APAISADO)   ANGOSTO Y ALTO (<768px y ≥480px de alto)
┌──────────────────────────────────────────┐           ┌───────────────────────┐
│ tengen · Jugar  [Jugar|Analizar|…]  (o)  │ topbar-h  │ tengen · Jugar    (o) │ topbar-h
├──────────────────────────────────────────┤           ├───────────────────────┤
│            .app-frame-main               │           │    .app-frame-main    │
└──────────────────────────────────────────┘           ├───────────────────────┤
                                                       │ Jugar Analizar Partidas│ navbar-h
                                                       └───────────────────────┘
```

**El criterio es la FORMA del viewport, no el dispositivo.** Un teléfono apaisado mide 844px de
ancho, así que cae del lado ancho y recibe los destinos arriba — que es justo donde hacen falta,
porque en apaisado el goban lo fija la ALTURA (844×390 → `min(828, 294)`) y 56px ahí serían un 19%
de tablero. En retrato manda el ANCHO (`min(374, 692)` en un iPhone 12, medido), así que la barra
podría comer 374px de alto antes de tocarlo: **cero píxeles perdidos**.

**Las dos condiciones son una y su complemento, y viven en UN media query.** El conmutador se ve por
defecto y se apaga *dentro* del mismo bloque que enciende la barra inferior. Escritas como reglas
independientes (`≥768` para uno, `<768 y ≥480` para la otra) dejan un hueco donde no aparece
**ninguna** — un iPhone SE apaisado (667×375) o una ventana a 700×400 se quedaban sin ningún destino,
que es la misma regresión que el marco existe para cerrar.

**La trampa del margen automático vuelve, y ahora en otro sitio.** El template de estudio ya
documentaba que un margen `auto` en el eje transversal **cancela el `stretch`** de un flex item (por
eso `.study-main` nunca lleva `margin-inline: auto`). Al meter todas las pantallas dentro del marco,
`.card-screen` y `.system-screen` pasaron de ser bloques a ser flex items — y las centra justamente
un `margin: … auto`, así que su ancho pasó a depender del contenido: **355px medidos donde el
contenedor daba 390**. Se arregla con `width: 100%`, que reproduce el comportamiento de bloque.
Lección: cuando un contenedor cambia de modo de layout, hay que **medir** a sus hijos; nada falla de
forma visible — una tarjeta algo angosta se ve como una tarjeta algo angosta.

**Regla estructural:** el marco lleva `min-height`, **nunca** `height` + `overflow: hidden`. El
contenido largo (la lista de partidas, el formulario de nueva partida) tiene que poder crecer y
scrollear la página; poner el viewport en el marco cortaría ambas en una pantalla corta. Quien toma
el viewport sigue siendo `.study-shell` en escritorio, ahora con `calc(100dvh - var(--topbar-h))`
(verificado: 48 + 852 = 900 exacto, sin scroll de página). Es también lo que hace seguro el
`justify-content: center` que despega las tarjetas del borde superior: como el contenedor no tiene
altura fija ni overflow propio, el centrado sólo actúa cuando SOBRA espacio y nunca corta el
principio de una pantalla larga.

**Cuatro pantallas quedan fuera del marco, a propósito** (documentado en `AppFrame.tsx`): el marco
envuelve el `<Router>`, así que cubre *rutas*. `/diagnostico` y el cartel de sin-WebGPU viven fuera
del router para poder abrir en un aparato donde la app no arranca; "Detectando WebGPU…" y el fallback
del `ErrorBoundary` se pintan por encima de `ModeApp`. Las cuatro conservan su propia salida.

## Sección Aprender (fase Aprender, 2026-08-04)

Cuarto destino del marco (`navDestinations`: las dos formas lo heredaron sin tocar nada — la prueba de
que el marco funciona como template). Dos niveles con estado interno, sin sub-rutas:

- **Lista** — `.card-screen.aprender-list` (32rem), misma superficie que el menú y Mis partidas. SIN
  ModelGate: navegar la lista no descarga ningún modelo. Filas `.exercise-row` (ver molécula).
- **Player** — reusa el template "estudio de tablero" ENTERO (tablero héroe + rail): la franja de
  feedback vive en el `.rail-header` y es UNA (enunciado `--quote` → feedback del intento → veredicto
  del motor), nunca una pila de mensajes. El veredicto del motor jamás usa `success` (sin ownership no
  se afirma vida/muerte; se dice cuántos puntos costó).
- **Burbuja de la solución numerada** (`.study-board--solution`): los números de la línea principal caen
  SOBRE piedras, así que llevan burbuja — misma técnica que la burbuja de pérdida de Analizar, pero con
  el acento (`--kaya` + `--kaya-on`, AA 6.19 en ambos temas): la solución ES lo que el acento significa.
  Atrapado por contrast-audit: el label crudo sobre piedra negra daba 1.59.
- Contraste auditado sobre el DOM pintado: lista + player en los 6 estados de la franja × 2 temas,
  **cero fallos** (tras las dos correcciones de arriba, ambas atrapadas midiendo, no mirando).

## Nivel 4 — Template "estudio de tablero"

```
┌ .study-main (dentro del marco de app) ──────────────────────┐
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

> El auditor vive en `apps/web/scripts/contrast-audit.js` (documentado en CLAUDE.md). Correrlo de
> nuevo ante cualquier cambio de paleta: los tres fallos más graves (botón primario, success,
> warning) sobrevivieron a una ronda de cálculo sobre los tokens y solo cayeron midiendo lo pintado.
>
> **Marco de navegación (2026-08-03):** cero fallos en las 4 rutas × 2 temas, en móvil y escritorio.
> Los nodos de las dos barras se midieron **uno por uno** en vez de confiar en el "0 fallos" global:
> el filtro `offsetParent === null` del auditor también es cierto para `position: fixed`, así que la
> `.appbar` entera podría haber quedado fuera de la auditoría sin que nada avisara. Claro —
> marca 16.38 · ubicación 7.30 · destino activo 6.00 · inactivos 7.30. Oscuro — 14.89 / 9.49 / 7.37
> / 9.49.

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

## La app instalada (PWA)

El sistema tiene que sostenerse también fuera de la pestaña, porque tengen se instala y arranca sin
conexión (service worker en `apps/web/src/sw.ts`). Tres puntos donde eso toca al diseño:

- **Los iconos son piezas del sistema, no un export.** La marca es el JUEGO, no una pieza: piedra
  negra y blanca sobre el disco kaya — negra arriba-izquierda (negro juega primero), blanca DELANTE
  abajo-derecha (acaba de responder). Los gradientes son los de `stone_1.svg`/`stone_-1.svg` de
  @sabaki/shudan, las mismas piedras que dibuja el tablero real; legibilidad verificada a 16px (el
  tamaño de pestaña) sobre franja clara y oscura. El `favicon.svg` (disco a sangre) es la fuente:
  los cuatro PNG (`icons/icon-192/512`, `icon-maskable-512`, `apple-touch-icon`) se rasterizan de la
  misma composición vía canvas de Chrome — no hay script committeado; si el SVG cambia, se regeneran
  los cuatro. El *maskable* sigue siendo variante distinta y no una reescalada: Android recorta con
  máscara arbitraria y le comería el borde al disco, así que va oro a sangre en todo el cuadrado con
  la composición al ~58% (zona segura); el de iOS, al ~64%.
- **El color del chrome del sistema sale de los tokens.** Dos `<meta name="theme-color">` con
  `prefers-color-scheme` llevan el `--canvas` de cada tema a la barra del navegador y a la ventana de
  la app instalada. Sin eso, la app queda enmarcada en un color que no es de la paleta.
- **La superficie informativa de la app vive fuera del template.** `PwaToast` y el chip de conexión
  hablan del *programa* (hay versión nueva, no hay red), no de la partida; por eso no entran en el
  rail, que es la superficie del contenido.
- **La safe-area es parte del sistema desde que hay una barra pegada al fondo — y cubre los CUATRO
  bordes, no el que motivó el cambio.** El manifest es `display: standalone`, así que una barra fija
  cae **debajo del indicador de inicio** y queda parcialmente intocable. `viewport-fit=cover` es lo
  que hace que `env(safe-area-inset-*)` devuelva algo distinto de 0 — y expone **todos los bordes a
  la vez**: en la app instalada el viewport también se mete bajo la barra de estado (arriba) y bajo
  el recorte lateral en apaisado. Por eso: `.topbar` absorbe el inset de ARRIBA sumándolo a su alto
  (un `env()` es constante del aparato, no contenido, así que el contrato de `--topbar-h` se
  mantiene: la zona útil sigue midiendo 3rem) y lleva `max()` a los lados; `.app-frame-main` lleva
  `max(var(--nav-inset), env(safe-area-inset-bottom))` para el viewport ancho, donde la barra
  inferior no existe pero el indicador de inicio sí; y el `calc` del `.study-shell` de escritorio
  descuenta ambos insets verticales. En navegador y en escritorio todos valen 0 y nada cambia.
  Ningún test automático cubre esto y Chrome emulando 844×390 tampoco: **se verifica en la PWA
  instalada, en el aparato**.

## La pantalla que tiene que funcionar cuando nada funciona

`/diagnostico` (`.diagnostico`, `ui/DiagnosticoView.tsx`) reporta qué ve el dispositivo y por qué el motor
arranca o no. Tres decisiones de diseño que salen de ese requisito y no de la estética:

- **Se monta ANTES del gate de WebGPU**, fuera del router (`Root` mira el `pathname`). El gate está por
  encima del `<Router>`: sin adapter, la app entera se reduce a un mensaje, así que una ruta normal sería
  inalcanzable justo en el aparato que hay que diagnosticar. Se llega con `<a href>` — navegación completa
  del documento, no `<Link>`.
- **El volcado se muestra SIEMPRE**, aunque haya botón "Copiar todo". El botón depende de
  `navigator.clipboard`, que en un contexto degradado puede no existir; esconder el texto detrás de un
  toggle sería apostar a que el toggle funcione en el aparato roto. `.diagnostico-dump` lleva
  `user-select: all` para que un solo toque seleccione las sesenta líneas: es funcional, no cosmético.
- **Más ancha que las otras pantallas de sistema** (40rem contra 32rem): su contenido son líneas
  `clave: valor`, que partidas en dos se leen peor.

El cartel de "hace falta WebGPU" dejó de ser un callejón sin salida: ahora dice el MOTIVO concreto y
ofrece el enlace al diagnóstico. Una pantalla sin ninguna acción posible es cómo un iPhone nos dejó sin
datos para depurar.

## Decisiones que parecen deuda y no lo son

- **Sin toggle manual de tema.** La preferencia del sistema alcanza y no introduce estado que
  guardar, sincronizar ni testear.
- **El aviso de versión nueva no se autodescarta y nunca recarga solo.** Es la contracara de una
  decisión de producto: activar un shell nuevo mientras alguien piensa una jugada con el reloj
  corriendo, o a mitad de un review de 40 posiciones, cambiaría una partida por una mejora de CSS.
- **El glifo ● en "WINRATE ●" no se colorea.** En oscuro no existe un "punto negro" legible sobre
  fondo oscuro; lo que comunica es *relleno vs. hueco* (●/○), que sobrevive a los dos temas. La
  perspectiva va además en el `title`, y el `SCORE` de al lado ya nombra el color ("B+3.2").
- **`.rail-body` scrollea con sombras de fondo, sin JS.** Las capas `local` viajan con el contenido
  y tapan a las `scroll`, clavadas al borde: la sombra aparece solo del lado por el que hay más, y
  no aparece nunca si todo entra. Verificado en los tres estados (arriba, en medio, abajo).
