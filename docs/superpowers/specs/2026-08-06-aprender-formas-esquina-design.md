# Aprender v2 — el motor deja de ser peaje, y las formas de esquina

> Diseño acordado con Edgar el 2026-08-06. Sucede a la fase Aprender v1 (mergeada el 2026-08-04,
> commit `06f7cf3`), que shipeó con 4 ejercicios y `ModelGate` obligatorio.

## El problema, en dos hechos medidos

1. **La sección cobra un peaje que no necesita.** `AprenderView` envuelve el player en
   `<ModelGate net='b18'>`: 58,1 MB (móvil) antes de tocar el primer problema. Pero la sección **ya
   funciona sin motor** para todo lo que está en el árbol de solución — verificado en Chrome y
   fijado por `tests/AprenderView.test.tsx`: resolver y fallar-en-árbol no consultan al scheduler.
   Lo único que necesita motor es el veredicto en puntos al salirse del árbol.
2. **4 ejercicios no son una sección de estudio.** El contenido clásico quedó bloqueado por
   licencias (`docs/research/fase-aprender/contenido-licencias.md`) y sigue esperando respuesta al
   mail a Ulrich Görtz.

## Decisiones tomadas (no re-litigar)

- **Motor bajo demanda**, no árbol exhaustivo pre-resuelto. Se descartó pre-computar el veredicto
  offline con un solver exacto: más pipeline del que el problema justifica hoy.
- **Portar `frostburn/tinytsumego2` (MIT) con atribución**, adaptándolo a nuestro formato. Es
  legítimo y distinto de redistribuir SGF sin licencia: la MIT autoriza copiar con aviso.
  Fundamento pedagógico de Edgar: *la vida y muerte es atemporal; los joseki los reescribió la IA*
  — por eso este contenido envejece bien, y por eso F3 (joseki) seguirá construyéndose desde la
  policy del motor y no desde un diccionario.
- **NO compilar su solver ni traducirlo.** Medido: 9705 líneas de C (~4000 del solver core, con
  bitboards de 64 bits, tablas hash y simetrías). Traducir a TS son semanas con bugs sutiles;
  compilar deja una dependencia permanente. Lo que necesitamos de ahí son las **posiciones**, que
  son texto: un spike verificó que se leen con ~10 líneas de JavaScript.
- **Los problemas que dependen de amenazas de ko quedan fuera de esta tanda.** Sin el solver no
  podemos garantizar su respuesta, y no se enseña lo que no se puede verificar.

## Pieza 1 — El motor bajo demanda

### Comportamiento

| Estado | Qué ve quien estudia |
| --- | --- |
| Modelo ya en OPFS | Idéntico a hoy: al salirse del árbol, el veredicto en puntos aparece solo |
| Modelo ausente | El player abre igual. Al salirse del árbol: *"No es la línea de la solución"* + botón **"Preguntar a KataGo (58 MB)"** |
| Descargando | El progreso vive en la franja del rail, no tapa el tablero |
| Sin WebGPU | Hoy no se llega: el gate global lo impide antes (ver «Descubrimiento» más abajo) |

El tamaño va escrito en el botón: quien tiene datos contados merece saber qué se le va a cobrar
**antes** de tocar.

### Implementación

- `AprenderView` deja de envolver el player en `ModelGate`. `EngineExercisePlayer` monta directo y
  **no** llama `ensureReady` al montar.
- Detección sin descargar, con API que ya existe: `resolveManifestEntry(net, currentModelVariant())`
  da `{opfsName, bytes}` y `createOpfsModelStore().isComplete(opfsName, bytes)` responde si está.
  Cero red.
- La descarga bajo demanda reusa `ensureModel` con el mismo `onProgress`; **`pruneOtherModelVariants`
  sigue siendo exclusivo de `ModelGate`** (la regla de CLAUDE.md no se toca: borrar variantes desde
  otro punto destruiría el modelo que el dispositivo usa de verdad).
- El precalentamiento del baseline (calibrado en T7) se dispara solo cuando el motor está listo.
- `ExercisePlayer` gana un prop `engine` discriminado —`{estado:'ausente', onDescargar}` ·
  `{estado:'descargando', progreso}` · `{estado:'listo'}`— que decide únicamente qué se pinta ante
  un fuera-de-árbol. Su lógica de intento no cambia: sigue siendo pura y testeable con mock.

## Pieza 2 — Colección «Formas de esquina»

### Origen y alcance

`frostburn/tinytsumego2` (MIT), 7 colecciones / 29 ejercicios declarados:

| Colección | Ejercicios | En esta tanda |
| --- | --- | --- |
| Rectangular Six in the Corner | 4 | los que no dependen de amenazas |
| Rectangular Eight in the Corner | 3 | ídem |
| L & J Groups (L, L+1, J, small hovercraft) | 6 | sí |
| Carpenter's Square (incl. seki) | 4 | sí |
| Long L Group | 5 | sin las variantes de ko |
| Hovercraft | 4 | los de ataque/defensa |
| Ko (Attack) | 3 | **no** (esta tanda) |

Estimado tras excluir lo dependiente de `ko_threats`: **~19 candidatos**, sujetos a pasar el
spot-check. Los que no pasen se excluyen y se listan — el conversor nunca adivina en silencio.

### Traducción

Su `parse_state` codifica dos cosas que Go real no tiene, y ahí está el riesgo:

- **`immortal`** (símbolos `B`/`W`): un muro que no puede morir *por definición*. En un 19×19 de
  verdad un muro flojo se ataca y el problema deja de ser el mismo — exactamente el bug que el
  spot-check atrapó en «Primeros pasos» (gap −10,9 por huecos diagonales). La traducción refuerza
  muros y **verifica** que la respuesta no cambió.
- **`ko_threats`** como parámetro del estado: no se puede expresar en una posición de 19×19, porque
  depende del resto del tablero. Es el motivo de excluir esos problemas.

Mapeo de símbolos (leído de `src/state.c`): `.` vacío jugable · `,` fuera del área lógica ·
`x` fuera del tablero · `*` vacío con ko · `@`/`b`/`B`/`+` piedra negra (jugador / objetivo /
inmortal / libertad externa) · `0`/`w`/`W`/`-` lo mismo en blanco.

Las posiciones miden 4×9 a 7×9: entran holgadas en una esquina del 19×19.

### Pipeline

```
src/collection.c  →  parser JS  →  traducción a la esquina 19×19  →  árbol de solución
   (texto, MIT)      (~40 líneas)     (muros reforzados)          (KataGo desktop)
                                                                          ↓
   apps/web/src/learn/data/formas-esquina.json  ←  validación exerciseIssues + spot-check
```

- `apps/web/scripts/port-tinytsumego.mjs` — herramienta local, junto a `convert-tsumego.mjs`. No
  corre en build ni en CI. Reproducible: re-correr regenera bytes idénticos.
- El árbol de cada ejercicio: la primera jugada correcta más, como ramas incorrectas, **las jugadas
  vecinas del área lógica del problema (los símbolos `.` de su posición) cuyo gap contra la solución
  el motor confirme en ≥3 puntos** — el mismo umbral que ya usa el spot-check. Lo que quede por
  debajo de ese margen no entra al árbol: lo cubre el motor en vivo, que ya es el modelo de la
  sección.
- Atribución: cabecera en el script + entrada en `apps/web/THIRD-PARTY-LICENSES` (patrón
  web-katrain) + procedencia en `data/README.md`.

## Descubrimiento durante el diseño: el gate de WebGPU llega antes que todo

Verificado en `main.tsx:349` — `return detection.ok ? <ModeApp /> : <NoWebGpu … />`: **sin WebGPU no
se abre nada de tengen**, ni siquiera lo que no usa el motor. Y la sección Aprender no toca WebGPU
por ningún lado (cero referencias en `learn/` y en `ExercisePlayer`).

La consecuencia es exactamente el usuario que motivó esta fase: un iPhone con iOS 18 y Chrome —el
caso que Edgar diagnosticó con su propio iPhone 12, documentado en CLAUDE.md, donde WKWebView no
expone WebGPU hasta iOS 26— **hoy no puede ni ver un tsumego**, aunque estudiar el árbol de solución
no requiera una sola inferencia.

Quitar el peaje de los 58 MB sirve a quien tiene un teléfono modesto *con* WebGPU. Quien no la
tiene sigue afuera por una razón que no aplica a esta sección.

**Propuesta (pendiente de decisión de alcance):** el gate deja de ser global y pasa a ser
por-destino. Aprender abre siempre; Jugar y Analizar muestran el cartel `NoWebGpu` que ya existe y
ya es device-aware. No hace falta escribir pantalla nueva: la pieza está hecha, solo se mueve de
lugar. Riesgo a cuidar: `ModeApp`/`AppFrame` asumen hoy que si estás dentro, hay motor — hay que
revisar cada vista que llama `ensureReady`.

## Testing

- **Node, sin motor**: el parser contra las posiciones reales (forma y conteo de piedras); la
  traducción geométrica (una posición conocida a mano); `learnData.test.ts` ya custodia todo
  dataset registrado con `exerciseIssues` — la colección nueva entra ahí sin tocar el test.
- **jsdom**: el player abre sin modelo; con modelo ausente el fuera-de-árbol muestra el botón y NO
  llama al scheduler; con modelo presente lo llama solo (mock de `isComplete` por inyección).
- **Gate manual**: `test:nn` 10/10 intacto (nada toca el encoding) y Chrome real con los dos
  caminos — modelo presente y modelo ausente.
- **Spot-check**: obligatorio antes de commitear el dataset, con los dos criterios ya calibrados
  (co-optimalidad local y gap ≥3 pts contra ramas incorrectas).

## Lo que este diseño NO hace

- No compila C ni traduce el solver; no agrega lenguajes ni dependencias al pipeline.
- No cambia `BoardSize` ni agrega tableros pequeños: las formas van en la esquina del 19×19, que es
  donde ocurren. El recorte visual (`rangeX`/`rangeY` de Shudan) sigue siendo polish opcional.
- No toca D1 ni el progreso en la nube.
- No redistribuye contenido sin licencia: la regla de `NOTICE.md` («la licencia del repo no es la
  licencia del contenido») se mantiene intacta.
- No promete vida/muerte desde el motor: sin `ownership`, el veredicto sigue siendo en puntos.
