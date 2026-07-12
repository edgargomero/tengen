# Navegación por URL + mejoras UX (menú, Volver, formulario de nueva partida)

**Fecha:** 2026-07-12 · **Estado:** aprobado por Edgar · **Extiende:** conmutador Jugar/Analizar (Task 11, `apps/web/src/main.tsx`) · **Precede a:** Fase 5 — Cuentas + nube (`docs/superpowers/plans/2026-07-10-tengen-v1-roadmap.md`)

## Contexto y objetivo

Hoy la navegación entre modos vive **solo en memoria**: `ModeApp` (`main.tsx:172-187`) guarda un `useState<Mode>('menu'|'play'|'analyze')`, sin ningún reflejo en la URL. Consecuencias:

- Recargar la página SIEMPRE vuelve al menú, sin importar dónde estabas.
- El botón atrás/adelante del navegador no hace nada dentro de la app.
- No hay forma de compartir o marcar como favorito un link directo a "Jugar" o "Analizar".
- Modo Jugar no tiene ningún botón para volver al menú (asimetría deliberada de una fase anterior — ver comentario en `main.tsx:172-181` — porque en ese momento no había forma de que fuera seguro).

Edgar pidió una mejora de UX y navegación por URL "corta y simple", **antes de** empezar Fase 5 (cuentas + nube). Durante el brainstorm el pedido creció a dos frentes relacionados: navegación coherente por URL, y agregar (o mejorar) el botón "Volver" donde falta — lo que a su vez expuso que `NewGameForm` tampoco tiene salida, y que el formulario de nueva partida no tiene ningún pulido visual.

## Alcance

**Dentro de esta extensión:**
- Ruteo de **nivel superior únicamente**: `/` (menú), `/jugar`, `/analizar`. Con `preact-router`.
- Fix de infraestructura en el Worker para que las rutas sobrevivan un refresh en producción (`apps/worker/wrangler.jsonc`).
- Botón "Volver" agregado en los **3** puntos donde falta o donde ya existe pero había que revisarlo: `NewGameForm` (nuevo), `ReadyPlayView`/`PlayView` (nuevo), `AnalyzeView` (ya existe, sin cambios).
- Pulido visual de `NewGameForm` — mismo flujo y campos, solo jerarquía/espaciado.

**Explícitamente fuera de esta extensión** (decisiones tomadas en el brainstorm, no re-litigar en el plan):
- **Deep-linking del estado interno de Analizar** (qué SGF está cargado, en qué jugada estás) — recargar en `/analizar` siempre vuelve al picker de SGF. Confirmado con Edgar.
- **Rutas con parámetros** (`/analizar/:id` para cargar una partida pro o una partida propia guardada en la nube) — NO se implementan ahora. La elección de `preact-router` (en vez de un router hecho a mano) es justamente para que agregarlas en Fase 5 sea incremental, no una migración.
- **Rediseño estructural del formulario** (esconder campos avanzados detrás de un toggle) — descartado explícitamente; el flujo y los campos visibles quedan igual.
- **Cualquier cambio a la lógica de juego** (reglas, turnos, IA, persistencia de partida) — esta extensión es 100% navegación + presentación.

## Arquitectura

### Librería de ruteo: `preact-router`

Se evaluaron 3 enfoques (hand-rolled con History API, `preact-router`, `wouter`). Edgar eligió explícitamente una librería en vez de hand-rolled, pensando en las rutas con parámetro que va a necesitar Fase 5 para cargar partidas pro/cloud por id.

Entre librerías, `preact-router` (no `wouter`) por verificación directa contra el registro de npm:
- `preact-router@4.1.2`: peer dependency `preact: >=10` — coincide exacto con `apps/web/package.json` (`preact: ^10.24.0`). Cero configuración de bundler adicional.
- `wouter@3.10.0`: peer dependency declarada es `react: >=16.8.0` (sin export dedicado para Preact en su `package.json`) — usarla exigiría alias `react`/`react-dom` → `preact/compat` en `vite.config.ts`, fricción que no se justifica para 3 rutas.
- `preact-router` soporta segmentos dinámicos (`/analizar/:id`) nativamente vía su matcher — listo para cuando Fase 5 lo necesite, sin cambiar de librería.

Agregar a `apps/web/package.json`: `"preact-router": "^4.1.2"`.

### Rutas

| Ruta | Componente | Notas |
|---|---|---|
| `/` | `ModeMenu` | Existente, se simplifica (ver abajo) |
| `/jugar` | `PlayApp` | Existente, gana prop `onBack(): void` |
| `/analizar` | `AnalyzeView` | Existente — ya tiene `onBack`, sin cambios de interfaz |

Cualquier otra ruta: `preact-router` permite declarar un componente `default` como fallback (equivalente a 404 interno) — para esta app, el fallback razonable es redirigir a `/` (mismo criterio simple que "ruta desconocida → menú").

### Cambios en `main.tsx`

- `ModeApp` reemplaza su `useState<Mode>` por `<Router>` de `preact-router`, envolviendo:
  ```tsx
  <Router>
    <ModeMenu path="/" />
    <PlayApp path="/jugar" onBack={() => route('/')} />
    <AnalyzeView path="/analizar" onBack={() => route('/')} />
  </Router>
  ```
  (import `{ Router, route } from 'preact-router'`). El tipo `Mode` y el estado `mode`/`setMode` se eliminan — ya no hace falta, la URL es la fuente de verdad.
- `ModeMenu` deja de recibir `onSelect`. Los dos botones pasan a ser enlaces reales: `<a href="/jugar">Jugar</a>` / `<a href="/analizar">Analizar</a>` con la clase `.primary`/`.mode-menu` existente aplicada al `<a>` en vez del `<button>` — `preact-router` intercepta automáticamente los clicks de cualquier `<a href>` interno (documentado en su README: "automatically wires up `<a />` elements to the router"), así que NO hace falta el componente `<Link>` de `preact-router/match` para este caso (ese componente solo suma valor si se necesita una clase "activa"; no aplica a un menú de 2 opciones). Mejora gratis respecto a los `<button onClick>` de hoy: click derecho → abrir en pestaña nueva, el navegador muestra la URL al pasar el mouse.
- El comentario existente en `main.tsx:172-181` ("SIEMPRE arranca en 'menu'... para no dejar Analizar inalcanzable") queda obsoleto y se reemplaza: con "Volver" ahora presente en los 3 modos, ya no existe un modo sin salida, así que la ruta inicial la decide la URL sin ese riesgo.

### Fix de infraestructura (obligatorio): `apps/worker/wrangler.jsonc`

Agregar `"not_found_handling": "single-page-application"` dentro del bloque `"assets"` ya existente:

```jsonc
"assets": {
  "directory": "../web/dist",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application"
}
```

**Por qué es obligatorio, no una mejora opcional:** el fallback del Worker (`apps/worker/src/index.ts:52`, `app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))`) reenvía cualquier ruta no reconocida al binding de Static Assets. Sin este campo, Cloudflare Workers Static Assets devuelve 404 para un path como `/jugar` (no es un archivo real en `dist/`) — la app se vería rota en producción (recargar en `/jugar` → 404) aunque funcione perfecto en `vite dev` local, porque el dev server de Vite hace fallback a `index.html` por su cuenta y enmascara el problema. Valor confirmado contra el schema real instalado (`node_modules/wrangler/config-schema.json`, enum `single-page-application | 404-page | none`).

### Botón "Volver"

Mismo patrón en los 3 lugares: un botón (no un link — es una acción dentro del panel, mismo criterio que los demás controles de `PlayView`/`AnalyzeView`) que llama `route('/')` — **nunca `history.back()`**, porque si se entra directo a `/jugar` por URL (sin pasar por el menú) no hay una entrada previa segura en el historial; `route('/')` siempre funciona sin importar cómo se llegó.

- **`NewGameForm.tsx`** (nuevo prop `onBack(): void`): botón "Volver" cerca del título — mismo lugar/estilo que el botón "Volver" que ya existe en el `SgfPicker` de `AnalyzeView.tsx:152`.
- **`PlayView.tsx` → `ReadyPlayView`** (nuevo prop `onBack(): void`, encadenado desde `PlayView`): botón "Volver" en el panel, junto a "Nueva partida" (`PlayView.tsx:515-517`). Volver NO limpia la partida (a diferencia de "Nueva partida", que sí la borra) — el autosave a localStorage ya existente (`persist()`) hace que la partida siga ahí si el usuario vuelve a entrar a Jugar. **Sin `disabled={busy}`** — mismo criterio que el botón "Nueva partida" ya existente hoy, que tampoco se deshabilita mientras la IA piensa; navegar fuera desmonta `ReadyPlayView` y dispara su cleanup existente (`manager.dispose()`), abortando cualquier cálculo en vuelo — comportamiento ya aceptado hoy para "Nueva partida", no es un caso nuevo.
- **`AnalyzeView.tsx`**: ya tiene "Volver" (`SgfPicker` línea 152, `ReadyAnalyzeView` línea 466) — sin cambios de código, solo el `onBack` que recibe pasa a venir de `route('/')` en vez de `setMode('menu')`.

### Pulido visual: `NewGameForm.tsx` / `app.css`

Mismo flujo y mismos campos en el mismo orden (tamaño → oponente → reglas → komi → handicap → submit) — **cero cambios a la lógica** de `NewGameForm.tsx` (validación, defaults, submit) fuera de agregar el botón Volver. Solo CSS:

- Separación visual entre el grupo "básico" (tamaño de tablero, oponente) y "avanzado" (reglas, komi, handicap) — un `<div class="field-group">` envolviendo cada grupo, sin fieldsets anidados que compliquen el DOM.
- Más aire (`gap`/`padding`) entre grupos que el `gap: 1rem` uniforme de hoy.
- Reforzar el CTA primario (`button.primary` ya existe — revisar tamaño/contraste, no re-crear desde cero).
- Reusar la paleta ya establecida en `app.css` (azul primario `#2f6fed`, grises neutros `#e0e0e0`/`#777`) — no se introducen colores nuevos.
- Sin mockups en esta spec (no ameritó el companion visual) — el pulido se ejecuta directo en CSS durante la implementación, contra el criterio de "se ve más cuidado sin cambiar cómo se usa" acordado con Edgar.

## Testing / verificación

Sin tests de dominio nuevos (el ruteo y el pulido son 100% UI de presentación; este proyecto no tiene tests de componente Preact — mismo criterio ya aceptado para el resto de `apps/web/src/ui/`). Verificación manual:

**Local (dev server):**
1. `/` → click "Jugar" → URL cambia a `/jugar`; atrás del navegador vuelve a `/`.
2. `/` → click "Analizar" → URL cambia a `/analizar`; atrás vuelve a `/`.
3. Recargar estando en `/jugar` → se mantiene en `/jugar` (no salta al menú).
4. Recargar estando en `/analizar` → se mantiene en `/analizar` (vuelve al picker de SGF sin el árbol cargado — esperado, deep-link de estado fuera de alcance).
5. Navegar directo por URL a `/jugar` (sin pasar por el menú) y click "Volver" → vuelve a `/` sin errores — cubre el caso "sin historial previo en la app".
6. Click "Volver" en `NewGameForm` (antes de arrancar partida) → vuelve a `/`.
7. Click "Volver" en una partida en curso (`ReadyPlayView`) → vuelve a `/`; reentrar a "Jugar" restaura la misma partida (autosave intacto, sin pérdida).
8. Formulario de nueva partida: confirmar visualmente la separación básico/avanzado y que arrancar una partida sigue funcionando igual (jugada legal contra la IA).

**Producción (tras deploy):**
9. Recargar directo (tipeando la URL) en `https://tengen.kntor.io/jugar` y `https://tengen.kntor.io/analizar` → 200, NO 404 — verifica el fix de `not_found_handling`.

## Decisiones tomadas en el brainstorm (resumen)

1. Ruteo solo de nivel superior (`/`, `/jugar`, `/analizar`) — sin deep-link de estado interno de Analizar.
2. `preact-router`, no hand-rolled ni `wouter` — pensando en rutas con `:id` para partidas pro/cloud de Fase 5; verificado que es compatible sin alias de bundler.
3. Botón "Volver" agregado de forma coherente en los 3 modos (no solo Jugar) — incluye `NewGameForm`, que hoy tampoco tiene salida.
4. "Volver" siempre navega con `route('/')`, nunca `history.back()` — evita salir de la app si no hay una entrada previa segura en el historial (caso: entrada directa por URL).
5. Pulido visual del formulario de nueva partida: mismo flujo, solo jerarquía/espaciado — no se esconden campos avanzados detrás de un toggle.

## Fuera de alcance (recordatorio, no re-litigar en el plan)

Rutas con parámetros (`/analizar/:id`, `/partida/:id`), deep-linking de estado de Analizar, rediseño estructural del formulario de nueva partida (toggle de avanzado), y cualquier cambio a la lógica de juego/IA/persistencia — todas fuera de esta extensión. Las rutas con parámetro son la candidata natural para resolverse dentro de Fase 5 (Cuentas + nube), cuando exista de dónde cargar esas partidas (D1 / biblioteca de partidas pro).
