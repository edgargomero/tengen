# Guía de inicio

tengen es una app web pública y gratuita para jugar Go/Baduk contra la IA KataGo y analizar partidas, con el motor corriendo 100% en el navegador.

## Qué es tengen, en simple

tengen es una página web donde cualquiera puede jugar una partida de Go (un juego de mesa muy antiguo, de piedras blancas y negras sobre un tablero cuadriculado) contra una computadora que juega sola, o cargar una partida ya jugada para que esa misma computadora le muestre qué jugadas fueron buenas y cuáles no. Lo distinto de tengen es que todo ese cálculo pasa dentro del navegador de la persona que juega —su propia laptop o celular hace el trabajo—, no en un servidor central de la empresa, así que el servicio puede ser gratis sin ser caro de mantener. Es, además, software libre: el código es público y cualquiera puede leerlo o reutilizarlo, con la condición de que si alguien lo modifica y lo vuelve a publicar como servicio web, también tiene que publicar su versión modificada.

## Cómo se trabaja acá (la metodología)

Estas son las reglas de proceso que se repiten una y otra vez en la documentación del proyecto. No son formalidades: cada una existe porque en algún momento evitó (o hubiera evitado) un error concreto.

- **Investigar antes de decidir, con evidencia contrastada.** Las decisiones grandes (motor client-side vs. servidor, formato de red neuronal) se investigan primero en `docs/research/` con verificación adversarial contra fuentes primarias. Por qué: la investigación real *cambió* decisiones — descartó Cloudflare Containers como servidor de IA porque, medido, sale caro y es más débil que la GPU del propio navegador del usuario.
- **Spec antes de plan, plan antes de código.** Toda funcionalidad nueva pasa por `docs/superpowers/specs/` (qué y por qué) antes de `docs/superpowers/plans/` (cómo, en tareas). Por qué: deja el razonamiento de cada decisión escrito y consultable, no solo el resultado.
- **Medir antes de construir.** La Fase 0 no dejó avanzar a construir la interfaz hasta medir inferencias por segundo reales en WebGPU; el mismo patrón se repite después (gate de referencia antes de servir una red convertida, spot-check con el motor antes de publicar un ejercicio). Por qué: sin el dato real de hardware típico, no hay forma de saber si el producto es viable.
- **Gate de referencia 10/10 antes de servir una red neuronal convertida.** Por qué: una conversión (a precisión mixta, por ejemplo) puede introducir errores silenciosos que solo se ven en producción — el fp16 "roto" jugaba la esquina 1-1 por un `NaN` que ningún test hasta entonces cubría.
- **Los umbrales se fijan antes de mirar los resultados.** Por qué: evita la tentación de bajar el umbral después de ver que algo "casi" pasa; si un criterio falla por poco, la pregunta correcta es si mide lo que de verdad importa, no si conviene relajarlo.
- **Veredicto de licencia escrito antes de empaquetar cualquier contenido de terceros** (tsumegos, material de estudio). Por qué: la licencia del repositorio no es la licencia del contenido — nadie puede otorgar derechos que no tiene, y un `LICENSE` permisivo sobre el código no libera archivos que su autor recopiló sin derechos sobre ellos.
- **El contraste de diseño se mide sobre el DOM renderizado, no sobre la paleta de colores.** Por qué: tres fallos reales de contraste (botón primario, `--tone-success`, `--tone-warning`) sobrevivieron a una ronda entera de aritmética hecha sobre los valores sueltos de la paleta.
- **Testing dividido en dos: todo lo que no necesita el motor se automatiza; el motor real es un gate manual en navegador.** Por qué: el motor pesa ~115 MB y necesita WebGPU real, así que no puede correr en un runner de CI sin pantalla ni GPU.
- **El estado de ejecución vive solo en el ledger (`.superpowers/sdd/progress.md`), nunca hardcodeado en specs, planes o research.** Por qué: esos documentos quedan fijados en la fecha en que se escribieron y se desactualizan apenas el trabajo avanza — es justamente la razón por la que armar esta guía requirió cruzar varios documentos y la memoria del proyecto en vez de leer un solo lugar.
- **Monitoreo permanente de releases upstream** (KataGo, web-katrain, onnxruntime-web, `@sabaki/*`, better-auth, katago-onnx). Por qué: el producto depende de código de terceros que cambia; una release nueva puede romper un contrato que el motor da por sentado.
- **La re-adaptación de código de terceros sigue un runbook documentado, nunca "a ojo".** Por qué: cada archivo adaptado de web-katrain queda registrado (origen, commit fijado, cambios hechos) para poder re-sincronizar sin perder el rastro de qué se tocó y por qué.
- **La verificación manual atrapa lo que las herramientas automáticas no ven.** Por qué: hay bugs de validación HTML5 silenciosa y de timing en vivo que ni `tsc`, ni los tests, ni una revisión de código detectan.

## Estado por fase

> El estado real de ejecución no vive en los documentos de spec/plan/research (quedan fijados en la fecha en que se escribieron) sino en la memoria del proyecto y el historial de commits. Esta tabla se armó cruzando ambas fuentes, no copiando el campo "estado" de cada documento uno por uno.

| Fase / feature | Estado |
|---|---|
| Fase 0 — scaffold web + benchmark WebGPU | Completa y mergeada. Gate ≥2 inf/s cumplido; b18c384nbt confirmada como red principal. |
| Fase engine — encoding V7 + MCTS + Web Worker (adaptación de web-katrain) | Desplegada y en producción: Jugar y Analizar ya corren el motor. CLAUDE.md todavía dice "plan escrito, aún sin ejecutar" — esa frase quedó desactualizada, no hay que repetirla. |
| Fase 1 — modelos (OPFS + descarga con caché) | Completa; forma parte del despliegue en producción. |
| Fase 2 — Jugar | Desplegada. Mejoras posteriores (nigiri / elección de color) también desplegadas (Version 803b9736, 2026-07-21). |
| Fase 3a — Analizar (núcleo) | Desplegada, con features adicionales desplegadas después (Version 6d4ba866, 2026-07-21). Fase 3b (comentarios por posición + biblioteca de partidas) — no queda claro en la documentación si se llegó a hacer. |
| Fase 4 — deploy del Worker a tengen.kntor.io | Desplegada desde 2026-07-11. Sirve los modelos en fp32 (no fp16, por el bug de `NaN` — ver más abajo). |
| Fase 5 — cuentas (Google OAuth + D1 + backup a Drive) | Plan listo (Tasks 1-6); el Task 7 dependía de pasos operativos manuales de Edgar (crear proyecto en Google Cloud, publicar pantalla de consentimiento, etc.). No queda claro en la documentación si ya se completó y está en producción. |
| Precisión mixta por dispositivo (motor en móvil) | Desplegada (Version 3c7a59fc); gate del iPhone cumplido (6/6 tandas, 120 inferencias, donde el fp32 moría en ~80). La memoria interna anota que la rama seguía sin mergear y faltaban una corrida de control en fp32-en-PWA y una partida real — no queda claro si eso ya se cerró. |
| Editor de repaso (comentarios, marcas, operaciones de árbol) | Implementado y desplegado (PR #2 mergeado, Version f3064504, 2026-07-25). |
| Reloj de partida (tiempo principal + byoyomi) | Spec y plan aprobados por Edgar (brainstorm); el propio plan dice "aún sin implementar" y no hay confirmación de despliegue posterior — no queda claro en la documentación si se implementó. |
| Análisis persistido en SGF | Spec y plan aprobados; "aún sin implementar" según el propio documento — no queda claro si se hizo después. |
| Analizar desde cero (tablero vacío sin SGF) | Spec y plan listos para ejecutar; sin confirmación de despliegue en la documentación revisada. |
| Editor de variaciones en Analizar / navegación por URL amigable | Specs aprobadas y listas para ejecutar; sin confirmación explícita de despliegue en esta extracción (Analizar en general sí está desplegado). |
| Fase Aprender v1 — "Primeros pasos" (4 ejercicios) | Colección validada con el motor (spot-check 4/4 OK, 2026-08-04). La memoria interna la marca "sin mergear" en una rama propia (`feat/aprender-tsumego`), pero el historial de commits en `main` ya incluye tareas de esta fase (T0+T3, T7) — no queda claro en la documentación si es la misma rama ya integrada o trabajo en paralelo. |
| Fase Aprender v2 — formas de esquina + motor bajo demanda | Diseño acordado el 2026-08-06 (es el documento más reciente del proyecto, todavía con cambios sin commitear al momento de esta guía); el propio spec dice que 3 piezas requieren plan antes de implementarse. |
| Licencia AGPL-3.0-or-later | Decidida y vigente desde 2026-08-05. |
| Veredicto de licencias de contenido de terceros (tsumegos clásicos) | Sin colección licenciable encontrada; se optó por pedir permiso formal a un autor (Ulrich Görtz) y crecer una colección propia a mano. No queda claro en la documentación si Görtz ya respondió. |

## Decisiones que ya no se re-discuten

- **Motor 100% client-side** (sin Cloudflare Containers, sin compilar KataGo a WASM). *Por qué:* medido que un servidor sin GPU sale más caro y juega más débil que la GPU del propio navegador del usuario.
- **Chrome-first: WebGPU obligatorio en v1, sin fallback a WASM.** *Por qué:* WebGPU mide ~2.2× más rápido que WASM, y la cobertura de WebGPU (~84%) alcanza para un v1.
- **El mensaje de "no tenés WebGPU" depende del dispositivo, nunca dice "usa Chrome/Edge".** *Por qué:* en iPhone/iPad ese consejo es exactamente el contrario del correcto — ahí Chrome corre sobre WKWebView, que no expone WebGPU hasta iOS 26, mientras que Safari sí puede desde iOS 18.2.
- **UI en Preact sobre los componentes oficiales de Sabaki** (`@sabaki/shudan` para el tablero, `@sabaki/go-board` para las reglas, `@sabaki/sgf` para el formato de archivo). *Por qué:* reúso de código maduro y ya probado en vez de reimplementar reglas de Go desde cero.
- **Backend mínimo: un solo Worker de Cloudflare (Hono) + D1 (cuentas/partidas) + R2 (redes neuronales), cero cómputo de motor en el servidor.**
- **Las redes neuronales nunca van al repositorio git**; se sirven desde R2 y se cachean en el navegador de cada usuario.
- **Formato de red servido: fp32 en escritorio, precisión mixta en móvil — no fp16 puro.** *Por qué:* el fp16 puro producía `NaN` en la predicción de jugadas (una conversión ciega de los pesos, sin saturación); la precisión mixta lo resuelve manteniendo la misma fuerza (10/10 en el gate de referencia) y reduce a la mitad el pico de memoria que hacía morir a un iPhone alrededor de la inferencia 80.
- **tengen es AGPL-3.0-or-later.** *Por qué:* es una app web gratuita y la cláusula de red de esa licencia obliga a publicar el código a quien despliegue una versión modificada como servicio — la protección solo tiene sentido en un producto que se sirve por red, como este.
- **web-katrain (MIT) es la base de adaptación del motor, no una reimplementación desde cero.** Se copia con atribución MIT por archivo, documentando cada cambio.
- **La licencia del repositorio no es la licencia del contenido.** Todo dataset de terceros (tsumegos, material de estudio) pasa por un veredicto de licencia escrito antes de empaquetarse.
- **La variante de precisión por dispositivo se resuelve en un único punto** (`currentModelVariant()` en `apps/web/src/models/modelVariant.ts`), sin argumentos, basada solo en `navigator.userAgent` — nunca en `maxTouchPoints`, que no existe en el scope del Worker y `tsc` no lo detectaría.
- **La Fase 0 gatea la construcción de UI:** no se construye interfaz sin medir antes cuántas inferencias por segundo da el hardware real.

## Mapa de la documentación

### Raíz del repo
- `README.md` — presentación del proyecto: motor 100% client-side, monorepo de 3 workspaces, testing dividido en CI/gate manual.
- `NOTICE.md` — licencias de todo lo incorporado y la regla "licencia del repo ≠ licencia del contenido".
- `LICENSE` — texto completo de la AGPL-3.0 (2007): copyleft con cláusula de red, sin garantía.

### docs/
- `docs/TESTING.md` — cómo se prueba el código: dominio y UI presentacional en CI automatizado, motor real en navegador como gate manual.

### docs/research/ (raíz)
- `docs/research/2026-07-08-katago-rendimiento-dossier.md` — dossier de rendimiento de KataGo en CPU, navegador y nube, con clasificación de confianza dato por dato.
- `docs/research/2026-07-08-katago-rendimiento-informe.md` — informe de decisión: elige motor 100% client-side sobre servidor Cloudflare o híbrido.

### docs/research/fase0/
- `docs/research/fase0/contrato-io.md` — especificación exacta de entradas/salidas de las redes ONNX de KataGo, verificada contra 3 fuentes.
- `docs/research/fase0/inventario-onnx.md` — catálogo de qué redes de KataGo existen ya convertidas a ONNX en internet, y cuáles faltan convertir.
- `docs/research/fase0/pipeline-conversion.md` — cómo convertir checkpoints de KataGo a ONNX con la herramienta katago-onnx.
- `docs/research/fase0/resultados.md` — resultados medidos del benchmark en Chrome/M1: b18 confirmada como red principal. Su conclusión de formato ("fp16 decidido") quedó luego revocada — ver Decisiones más arriba.

### docs/research/fase-engine/
- `docs/research/fase-engine/adaptaciones-upstream.md` — manual de mantenimiento: qué archivos de web-katrain están adaptados y cómo re-sincronizarlos ante una release nueva.
- `docs/research/fase-engine/decisiones-adaptacion.md` — decisiones técnicas concretas de la adaptación (layout de memoria, policy head, costura del evaluador ONNX).
- `docs/research/fase-engine/fuentes.md` — especificación técnica dura del encoding, MCTS y postproceso de KataGo/web-katrain, con rutas de código fuente citadas.

### docs/research/fase-aprender/
- `docs/research/fase-aprender/contenido-licencias.md` — investigación de licencias de tsumegos clásicos: ninguna colección es redistribuible completa: se decide pedir permiso y construir una colección propia.

### docs/superpowers/specs/
- `docs/superpowers/specs/2026-07-08-tengen-design.md` — spec general del producto: modos Jugar/Analizar/Cuentas, arquitectura, alcance de v1.
- `docs/superpowers/specs/2026-07-11-fase4-deploy-worker.md` — spec del despliegue público a tengen.kntor.io sin cuentas.
- `docs/superpowers/specs/2026-07-12-analyze-editor-variaciones.md` — spec para jugar variaciones propias sobre una partida importada en Analizar.
- `docs/superpowers/specs/2026-07-12-navegacion-url-ux.md` — spec de URLs amigables por modo y botones de "Volver".
- `docs/superpowers/specs/2026-07-13-fase5-cuentas-design.md` — spec de cuentas con Google OAuth, D1 como fuente de verdad y backup a Google Drive.
- `docs/superpowers/specs/2026-07-15-analisis-persistido-sgf-design.md` — spec para guardar el análisis del motor dentro del propio archivo SGF.
- `docs/superpowers/specs/2026-07-15-analizar-desde-cero-design.md` — spec para analizar desde un tablero vacío sin cargar SGF.
- `docs/superpowers/specs/2026-07-16-reloj-partida-design.md` — spec de reloj de partida (tiempo principal + byoyomi) con gestión de tiempo adaptativa para la IA.
- `docs/superpowers/specs/2026-07-23-editor-repaso-design.md` — spec de comentarios, marcas y operaciones de árbol sobre partidas.
- `docs/superpowers/specs/2026-08-06-aprender-formas-esquina-design.md` — spec más reciente: motor bajo demanda (sin peaje de descarga) y ~19 ejercicios de formas de esquina portados de una colección MIT.

### docs/superpowers/plans/
- `docs/superpowers/plans/2026-07-08-fase0-benchmark-webgpu.md` — plan del harness de benchmark en Chrome para medir inferencias/segundo.
- `docs/superpowers/plans/2026-07-09-fase-engine.md` — plan de construcción del motor: adaptación de web-katrain + costura con onnxruntime-web en un Web Worker.
- `docs/superpowers/plans/2026-07-10-fase-0-scaffold-web.md` — plan del scaffold de `apps/web` (Preact + Vite) y el gate de WebGPU.
- `docs/superpowers/plans/2026-07-10-fase1-modelos.md` — plan de descarga y caché de modelos en OPFS con reintento ante fallo.
- `docs/superpowers/plans/2026-07-10-fase2-jugar.md` — plan del modo Jugar: configuración, tablero interactivo, persistencia, import/export SGF.
- `docs/superpowers/plans/2026-07-10-tengen-v1-roadmap.md` — hoja de ruta completa de las 6 fases de v1, con decisiones de reúso de código.
- `docs/superpowers/plans/2026-07-11-fase3a-analizar.md` — plan del modo Analizar núcleo: heatmap, gráfico de winrate, review progresivo, adivinanza.
- `docs/superpowers/plans/2026-07-11-fase4-deploy-worker.md` — plan de despliegue con 3 hallazgos críticos sobre cómo servir el runtime de onnxruntime-web en producción.
- `docs/superpowers/plans/2026-07-13-fase5-cuentas.md` — plan de cuentas: better-auth, API `/api/games`, sync a Drive, rate limiting.
- `docs/superpowers/plans/2026-07-15-analisis-persistido-sgf.md` — plan de las propiedades SGF nuevas para persistir el análisis del motor.
- `docs/superpowers/plans/2026-07-15-analizar-desde-cero.md` — plan (un solo archivo) para arrancar Analizar en tablero vacío.
- `docs/superpowers/plans/2026-07-16-reloj-partida.md` — plan de 7+ tareas del reloj de partida y la política de tiempo de la IA.

## Por dónde empezar según lo que quieras hacer

- **Quiero tocar el motor** (encoding, MCTS, red neuronal, ONNX): empezá por `docs/research/fase-engine/fuentes.md` (los datos duros), seguí con `docs/research/fase-engine/decisiones-adaptacion.md` (qué se decidió y por qué) y `docs/superpowers/plans/2026-07-09-fase-engine.md` (el plan de tareas). Si vas a actualizar la versión de web-katrain o KataGo, el paso obligatorio es `docs/research/fase-engine/adaptaciones-upstream.md` (el runbook de re-sync).
- **Quiero tocar la UI** (pantallas, tablero, componentes): arrancá por `docs/superpowers/plans/2026-07-10-tengen-v1-roadmap.md` para el mapa general, y después la spec/plan del modo específico — Jugar en `docs/superpowers/specs/2026-07-08-tengen-design.md` + `docs/superpowers/plans/2026-07-10-fase2-jugar.md`, Analizar en `docs/superpowers/plans/2026-07-11-fase3a-analizar.md`. El sistema de diseño vive en `.kntor-design-atomic/system.md` (no forma parte de esta extracción de 36 documentos).
- **Quiero agregar contenido de estudio** (tsumegos, ejercicios de Aprender): la lectura obligatoria antes de tocar nada es `docs/research/fase-aprender/contenido-licencias.md` (la regla de oro de licencias); después `docs/superpowers/specs/2026-08-06-aprender-formas-esquina-design.md` para ver el diseño en curso, y `NOTICE.md` para el formato de atribución.
- **Quiero desplegar o tocar el backend/Worker:** `docs/superpowers/specs/2026-07-11-fase4-deploy-worker.md` + su plan homónimo para el despliegue base; `docs/superpowers/specs/2026-07-13-fase5-cuentas-design.md` + `docs/superpowers/plans/2026-07-13-fase5-cuentas.md` si es sobre cuentas, D1 o backup a Drive.
- **Quiero entender por qué se tomó una decisión de arquitectura** (servidor vs. navegador, formato de red, licencia elegida): `docs/research/2026-07-08-katago-rendimiento-informe.md` para motor client-side, `docs/research/fase0/resultados.md` para el formato de red (con la corrección posterior del fp16 documentada en CLAUDE.md), y `NOTICE.md` + `LICENSE` para la AGPL.

