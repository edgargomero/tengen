# Sistema de diseño — tengen

> Atomic Design de la interfaz de tengen (Go/Baduk sobre Cloudflare). Vive en `apps/web/src/styles/app.css`
> (tokens + átomos + moléculas/organismos por clase) y componentes en `apps/web/src/ui/`.
> Establecido 2026-07-25.

## Dirección y feel

**"La interfaz es el salón alrededor del goban", variante SOBRIA.** El usuario está estudiando una
partida de Go, concentrado; el **tablero es el único héroe**. El calor y el color viven en el TABLERO
(madera *kaya* + piedras de pizarra/concha); el *chrome* lo rodea en **gris-tinta cálido casi-neutro**,
y el oro-kaya (`--kaya`) aparece **solo en estados activos/primarios**. Regla de craft: *gris construye
estructura, el color comunica*.

- **Profundidad:** UNA estrategia — **tinte de superficie + borde-susurro** (rgba de baja opacidad). Sin
  sombras dramáticas. La única sombra permitida es el lift de 1px de la pestaña/segmento activo
  (`0 1px 2px var(--border-1)`).
- **Espaciado:** base **4px** (`--sp-1..6`).
- **Radios:** agudos para controles (`--radius-sm 5px`), más suave para tarjetas/paneles (`--radius-md 9px`),
  modales (`--radius-lg 12px`).
- **Un solo acento:** `--kaya` (el oro de la madera del goban). Nunca un segundo hue decorativo.

## Nivel 0 — Tokens (el ADN)

> Estado de aplicación: **color 100% tokenizado** (cero hex de color suelto en `app.css`, salvo el teal
> funcional del marcador "analizado"). **Espaciado/radios: escala definida pero aplicada parcialmente**
> — quedan ~91 valores de padding/gap y ~16 de border-radius literales (muchos fuera del grid 4px). Es
> deuda documentada abajo, no un bug: migrarlos snappea espaciados y cambia visuales, requiere pasada
> con verificación en navegador.

Definidos en `:root` de `app.css`.

| Grupo | Tokens |
| --- | --- |
| Superficies (elevación por tinte cálido) | `--canvas #f6f5f2` · `--surface #fdfcfa` · `--surface-raised #ffffff` · `--inset #efece7` |
| Tinta (4 niveles, gris cálido) | `--ink-1 #201d18` (primario) · `--ink-2` (secundario) · `--ink-3` (terciario) · `--ink-4` (muted/disabled) |
| Bordes (baja opacidad, susurran) | `--border-1` (estándar) · `--border-2` (suave) · `--border-strong` (énfasis) |
| Kaya (acento único) | `--kaya #ca933a` · `--kaya-hover` · `--kaya-on #fff` · `--kaya-soft` (fondo tenue) · `--focus-ring` |
| Semántico (calidad/estado) | `--tone-success` · `--tone-warning` · `--tone-danger` |
| Controles | `--control-bg` · `--control-border` · `--control-hover` |
| Espaciado / radios | `--sp-1..6` (base 4px) · `--radius-sm/md/lg` |

Aliases retrocompat: `--tengen-accent` → `var(--kaya)`.

## Nivel 1 — Átomos (consumen tokens; tienen sus estados)

- **Botón** (`button`): superficie + borde-susurro, quieto y recesivo por defecto. Estados: hover
  (`--control-hover`), focus-visible (`--focus-ring`), disabled (`--ink-4` + opacity .6).
  - `.primary` — la ÚNICA acción con relleno `--kaya` (texto `--kaya-on`). Una por pantalla.
  - `.ghost` — sin borde, texto `--ink-2`; para acciones que se apagan.
- **Control de entrada** (`select`, `input[type=number]`, `.analyze-comment-edit`): fondo `--inset`
  ("recibe contenido"), borde `--control-border`, focus-ring.
- **Pestaña / segmento** (átomo dentro de la molécula SegmentedControl): sin borde, `--ink-3`; activo =
  `--surface-raised` + `--ink-1` + lift 1px.
- **Pill de tono** (`.review-quality-badge`, `.tone-*`): color = `--tone-*`. Comunica calidad de jugada.
- **Glifo de piedra** (● / ○ en texto): motivo recurrente ("Tú: ● Negro").

## Nivel 2 — Moléculas (grupos de átomos, un propósito)

- **SegmentedControl** (`.analyze-tabs`, `.topbar-modes`): pista `--inset` + borde `--border-2`; ítem
  activo se ELEVA a `--surface-raised` (neutro — es cambio de vista, no "encendido").
- **Estado seleccionado** (`.analyze-speed button.active`, `.analyze-tools button.active`): `--kaya-soft`
  + texto/borde `--kaya` (quieto, claramente "on"; el gold pleno se reserva a `.primary`).
- **Cluster de navegación** (`.play-nav`): fila de botones-icono ⏮◀▶⏭.
- **Paleta de marcas** (`.analyze-tools`): ● △ □ ○ ✕ A (tool activo = estado seleccionado kaya-soft).
- **Fila de acciones** (`.analyze-actions`, `.play-actions`): botones fantasma, comparten ancho — se apagan.
- **BrandNav** (`.topbar-brand`): marca `tengen` (home) + `·` + ubicación.

## Nivel 3 — Organismos (secciones distintas, se sostienen solas)

- **TopBar** (`.topbar`, `ui/TopBar.tsx`): nav de app arriba. Izquierda BrandNav (dónde estás), derecha
  SegmentedControl de modo (a dónde vas). Fijo en desktop. Compone: botón-fantasma + texto + SegmentedControl.
- **Panel con pestañas de Analizar** (`.analyze-panel`, `ReadyAnalyzeView`): header fijo (LíneaEstado +
  `.primary` + comentario) · SegmentedControl (Repaso/Editor/Adivinar/Árbol) · cuerpo de la pestaña activa
  (= modo de interacción del tablero) · footer fijo (cluster-nav + selector-velocidad + fila-acciones).
- **Panel de partida de Jugar** (`.play-panel`, `ReadyPlayView`): header fijo (estado) · cuerpo (árbol,
  scrollea) · footer fijo (controles + nav + io + acciones). Sin pestañas (una sola sección de contenido).
- **AnnotationEditor** (`ui/AnnotationEditor.tsx`): paleta + textarea + ops de árbol. Presentación pura;
  `showToggle` (default true) — false cuando el modo lo controla la pestaña.
- **Árbol de jugadas** (`GameTreeGraph` SVG en Analizar, `GameTreePanel` lista en Jugar): nodos en tinta,
  actual con halo `--kaya`, analizado con marcador teal (`#14b8a6`, único color funcional fuera de tokens).

## Nivel 4 — Template: "Estudio de tablero" (`.study-shell`)

Columna a `100vh` en desktop, `overflow: hidden` (la PÁGINA nunca scrollea). Estructura:

```
┌ TopBar (fijo) ───────────────────────────────┐
├ .play-view / .analyze-view (flex:1) ──────────┤
│  tablero (héroe, llena la altura) │ panel     │
│                                   │ (header/  │
│                                   │  cuerpo/  │
│                                   │  footer)  │
└───────────────────────────────────────────────┘
```

- El tablero se dimensiona por ALTURA (`useBoundedBoardSize`: `innerHeight - 96`, descuenta la barra),
  con techo `VERTEX_SIZE` (9→70, 13→50, 19→38). Reparto: board `flex: 3`, panel `flex: 1` (max 18rem).
- Solo el cuerpo del panel scrollea internamente si su contenido no entra; header/pestañas/footer fijos.
- Mobile (`< 768px`): se apila y la página scrollea (correcto ahí); el bloqueo a viewport es solo `≥768px`.

## Checks pasados (el mandato)

Swap (kaya vs azul → distinto) · Squint (tablero domina, nada estridente) · Signature (kaya primario,
panel del mundo del tablero, glifos ●○, kaya-soft, pestañas tipo kifu) · Token (`--kaya`/`--ink` suenan
al mundo) · Atomic (page → template estudio → organismos → moléculas → átomos → tokens, cadena limpia).

## Deuda conocida

- **Espaciado/radios parcialmente tokenizados:** las escalas `--sp-1..6` y `--radius-sm/md/lg` están
  definidas pero solo aplicadas en las reglas reescritas; quedan ~91 padding/gap y ~16 border-radius
  literales (varios fuera del grid 4px, p.ej. 0.3/0.4/0.6rem). Pasada pendiente: snappear al grid +
  aplicar la escala, verificando en navegador (cambia visuales). `--radius-lg`/`--sp-1`/`--sp-5`/`--sp-6`
  quedan definidos pero aún sin uso (los usará esa pasada; las tarjetas/modales deberían usar `--radius-lg`).
- Marcador "analizado" del árbol = teal `#14b8a6` hardcodeado (único color funcional sin token). A tokenizar
  como `--analyzed` si se quiere purismo total.
- Alineación del TopBar (ancho 80rem) vs board+panel (centrado, más angosto) — leve desfase, aceptable.
