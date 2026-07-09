# Resultados de la fase 0 — benchmark WebGPU y decisión de red principal

Fecha: 2026-07-09. Rama: `fase-0-benchmark`.

## Hardware y entorno

- Chip: Apple M1 (mismo Mac de Edgar usado en el benchmark de referencia CPU/Eigen citado en la spec, sección "Fase 0 obligatoria").
- Navegador: Chrome 150, medido con `chrome-devtools` (MCP) contra `packages/engine/bench.html` (`npm run bench`).
- Adapter WebGPU reportado por el harness: `apple metal-3 (f16: true)` — soporta la feature `shader-f16`, condición necesaria para correr los `.fp16.onnx` en WebGPU sin caer a fp32.
- `self.crossOriginIsolated = true` (headers COOP/COEP de `vite.config.ts` activos) → EP `wasm` corrió con `numThreads = 8` (mínimo de `navigator.hardwareConcurrency` y 8, según `runner.ts`).
- Tablero: 19x19, posición vacía (`emptyBoardInputs`), komi 7.5.
- Metodología por combinación modelo×EP×batch: 5 corridas de warmup + 30 corridas medidas con `performance.now()`; estadístico reportado = mediana (`summarize()` de `stats.ts`). El sanity check de `runner.ts` (policy finita, no todo-ceros en fp16, value finito, argmax≠PASS en tablero vacío) pasó **ok en todas** las combinaciones medidas.

## Resultados medidos

| Modelo | EP | Batch | Mediana ms | inf/s |
|---|---|---|---|---|
| b28c512nbt-kaya.fp16 | webgpu | 1 | 763.9 | 1.31 |
| b28c512nbt-kaya.fp16 | webgpu | 8 | 3469.9 | 2.31 |
| b28c512nbt-kaya.fp16 | wasm | 1 | 1670.5 | 0.60 |
| b18c384nbt-kata1.fp16 | webgpu | 1 | 358.9 | 2.79 |
| b18c384nbt-kata1.fp16 | webgpu | 8 | 1725.8 | 4.64 |
| b18c384nbt-kata1.fp32 | webgpu | 1 | 384.0 | 2.60 |
| b18c384-weiqiplayground.fp32 | webgpu | 1 | 436.4 | 2.29 |
| b18c384nbt-humanv0.fp16 | webgpu | 1 | 346.9 | 2.88 |
| b18c384nbt-humanv0.fp16 | webgpu | 8 | 1645.9 | 4.86 |

### Nota sobre la matriz abortada

El plan original (Task 6, `bench.html`) corre la matriz completa {4 modelos descargados} × {webgpu, wasm} × {batch 1, 8} = 16 combinaciones (más humanv0 tras Task 8). El dueño del proyecto **abortó la corrida completa por decisión propia** tras las primeras 5-7 combinaciones: las corridas WASM de b28 (el modelo más pesado, 147 MB fp16) tardaban minutos por combinación y no cambiaban ninguna decisión — WASM es solo una referencia (constraint de la spec: "Chrome-first, WebGPU requerido en v1"), y la elección Chrome-first ya estaba tomada de antemano. Las combinaciones que sí eran decisivas para el gate (b18 fp16/fp32 en webgpu, humanv0 fp16 en webgpu, un punto de wasm para tener ratio de referencia) se midieron selectivamente en vez de correr la matriz íntegra. No se generó ni exportó el JSON completo de 16+ filas; la tabla de arriba son los números reales tal como los reportó el harness para cada combinación efectivamente corrida.

Filas no medidas (no ejecutadas, no "sanity fail"): `b28c512nbt-kaya.fp32` (control fp32 de b28, informativo, no decisivo), `b18c384nbt-kata1.fp32`/`humanv0.fp16` en batch 8 y wasm, `b18c384-weiqiplayground.fp32` en batch 8/wasm, `b18c384nbt-humanv0-misopa.uint8` (referencia de terceros, no crítica).

## Licencia de los pesos de KataGo

Antes de decidir cómo servir las redes desde R2 se verificaron las tres fuentes de licencia relevantes.

### (a) Redes de katagotraining.org (kata1) — página oficial de licencia

URL: https://katagotraining.org/network_license/ (enlazada desde el footer de https://katagotraining.org/ como "Neural Net License"). Texto exacto (extraído hoy, 2026-07-09):

> "The following license applies to the official KataGo neural network files and checkpoints available on this site katagotraining.org, including all networks on the https://katagotraining.org/networks/ page in the "kata1" run, with a few exceptions, indicated further below."
>
> "Copyright 2026 David J Wu ("lightvector"). Permission is hereby granted, free of charge, to any person obtaining a copy of the neural net files or training weight files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE."

Es decir: una licencia MIT explícitamente redactada para cubrir "neural net files or training weight files", no solo código. Cubre `kata1-b18c384nbt-s9996604416-d4316597426` (el checkpoint fuente de nuestra conversión propia `b18c384nbt-kata1.fp16/.fp32.onnx`, Task 7).

Excepciones (citadas por completitud, no aplican a nuestros modelos finales): las redes del run antiguo "g170" (pre-entrenamiento distribuido) están bajo CC0/dominio público efectivo; las redes "zhizi" de ZhiziGo (`kata1-zhizi-*`) tienen su propia licencia MIT-equivalente con copyright de "hzyhhzy & zhizigo.com". Ninguna de las dos aplica a b18c384nbt-kata1 ni a b28c512nbt-kaya.

### (b) Repo lightvector/KataGo — archivo LICENSE (cubre el release v1.15.0 de humanv0)

URL: https://github.com/lightvector/KataGo/blob/master/LICENSE (`raw.githubusercontent.com/lightvector/KataGo/master/LICENSE`, verificado hoy). Texto exacto:

> "Aside from the above, the license for all OTHER content in this repo is as follows: [...] Copyright 2025 David J Wu ("lightvector") and/or other authors of the content in this repository. (See 'CONTRIBUTORS' file for a list of authors as well as other indirect contributors). Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND [...]"

MIT estándar, mismo titular (David J Wu). El checkpoint `b18c384nbt-humanv0.ckpt` (323.752.318 bytes, fuente de nuestra conversión Task 8) se distribuye como asset del release `v1.15.0` del mismo repo, sin licencia separada adjunta a ese release — queda bajo el LICENSE general del repositorio ("todo OTRO contenido en este repo"). Esto es coherente con lo que declara independientemente la model card de kaya (fuente (c) abajo), que también apunta a este mismo archivo LICENSE para afirmar que "los pesos originales de KataGo" están en MIT — no solo el código del engine.

### (c) Model card de huggingface.co/kaya-go/kaya — MIT declarado

URL: https://huggingface.co/kaya-go/kaya/raw/main/README.md (verificado hoy). Frontmatter: `license: mit`. Texto exacto de la sección "## License":

> "The original KataGo neural network weights are released under the [MIT License](https://github.com/lightvector/KataGo/blob/master/LICENSE). This ONNX conversion and the associated tooling are also released under the MIT License."

### Conclusión de redistribución

**Sí, podemos redistribuir nuestros `.onnx` convertidos desde nuestro R2, con atribución.** Las tres fuentes convergen en MIT (o un MIT redactado a medida) para los pesos que usamos en producción:

- `b18c384nbt-kata1.fp16/.fp32.onnx` (red principal, Task 7): fuente = checkpoint oficial de katagotraining.org, cubierto por la "Neural Net License" de (a).
- `b18c384nbt-humanv0.fp16.onnx` (Human SL, Task 8): fuente = release v1.15.0 de lightvector/KataGo, cubierto por el LICENSE de (b).
- `b28c512nbt-kaya.fp16/.fp32.onnx` (control, no se usa en producción tras el gate): MIT explícito por (a) y (c).

MIT solo exige incluir el aviso de copyright y el texto de la licencia "en todas las copias o porciones sustanciales del Software" — se resuelve con una página/archivo de atribuciones en la app (o adjunto a la descarga desde R2) que cite el copyright de David J Wu y el texto de (a)/(b) para cada red servida. No hay obligación de mantener el nombre de archivo, ni restricción de uso comercial, ni copyleft.

El conversor `kaya-go/katago-onnx` (herramienta usada en Tasks 7-8) es AGPL-3.0 — pero es una herramienta local de desarrollo que **no se vendoriza ni se redistribuye** (constraint ya vigente desde el plan de Task 1); el AGPL de la herramienta no se propaga a los pesos que produce, porque los pesos de entrada ya eran MIT antes de pasar por el conversor (mismo patrón que usa kaya: convierten con la herramienta AGPL y publican el resultado en MIT).

**Excepción — no redistribuir:** `b18c384-weiqiplayground.fp32.onnx` (WeiqiPlayground, checkpoint no documentado, sin LICENSE ni model card con términos) y `b18c384nbt-humanv0-misopa.uint8.onnx` (Misopa, sin README ni model card). Ninguno de los dos declara licencia; se usaron solo como referencia de velocidad en el benchmark, nunca como candidatos para R2. Si en el futuro hiciera falta una variante que solo existe en una de estas fuentes sin licencia clara, la alternativa es **descarga client-side directa desde la fuente original** (enlazar al HF de terceros en vez de mirror en R2) hasta aclarar los términos con el autor.

## Decisión del gate

Regla de la spec (sección "Fase 0 obligatoria"): si b18 fp16 rinde **≥ 2 inf/s** en hardware típico, b18 queda confirmada como red principal; si rinde menos, el plan B es promover b10/b15 en la spec.

**Medido: b18c384nbt-kata1.fp16 en webgpu, batch 1 = 2.79 inf/s ≥ 2.** → **b18 confirmada como red principal. La spec (`docs/superpowers/specs/2026-07-08-tengen-design.md`) queda sin cambios** — no aplica el plan B, no hace falta resolver la conversión de b10 (tf2onnx, pendiente en `pipeline-conversion.md`) para esta fase.

Lecturas adicionales del dato:

- **b28 (control) rinde bajo, como se esperaba**: 1.31 inf/s a batch 1 en webgpu — la red 4x más grande (28 bloques vs. 18) no llega al umbral de 2 por sí sola; confirma que b28 no es viable como red principal en este hardware y refuerza que b18 es la elección correcta.
- **fp16 vs. fp32 casi empatan en velocidad** en b18 (2.79 vs. 2.60 inf/s a batch 1, ambos webgpu) — la ganancia de fp16 no es de cómputo (el M1 ya es rápido en fp32 vía Metal) sino de **tamaño**: 58.2 MB vs. 115.8 MB. Con egress relevante (R2/descarga al cliente) y mismo rendimiento, **fp16 es el formato a servir**.
- **humanv0 (Human SL) rinde igual o mejor que b18 estándar** (2.88 / 4.86 inf/s vs. 2.79 / 4.64) — misma arquitectura b18c384nbt más el encoder de metadata, sin penalización medible.
- **Ratio webgpu/wasm** (único punto medido, b28 fp16 batch 1): 763.9 ms vs. 1670.5 ms → WebGPU es **~2.2× más rápido** que WASM en este hardware, consistente con la decisión Chrome-first de la spec.
- **Batch 8 no escala linealmente** (b18 fp16: 2.79 inf/s → 4.64 inf/s a batch 8, ~1.66× en vez de 8×) — esperable en un M1 con este tamaño de red; sigue siendo la vía correcta para MCTS batcheado (más inferencias por segundo en total aunque cada lote tarde más).

### Implicaciones prácticas para la fase engine

- **Human SL (1 sola evaluación de policy, sin MCTS)**: ≈ 350 ms/jugada — percibido como instantáneo, tal como pide la spec para "rangos humanos 20k-9d, respuesta instantánea, estilo humano".
- **KataGo pleno con MCTS batcheado** (b18 fp16, ~4.6-4.9 inf/s a batch 8, hardware M1): 50 visitas ≈ 10-11 s; 200 visitas ≈ 40-45 s. Esto calibra los niveles de fuerza y las expectativas de tiempo de espera en el modo Analizar y en partidas con visitas altas — el ajuste fino (temperatura de policy, visitas por nivel por defecto) se hace en la fase de implementación del engine, como ya preveía la spec.
- **Formato a distribuir desde R2: fp16** para b18c384nbt-kata1 y para humanv0 — mismo rendimiento que fp32, mitad de peso de descarga (menos tiempo de primera carga, menos uso de OPFS).
