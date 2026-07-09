# tengen — Go web gratuito con KataGo client-side

**Fecha:** 2026-07-08 · **Estado:** aprobado por Edgar · **Investigación de respaldo:** [`docs/research/2026-07-08-katago-rendimiento-informe.md`](../../research/2026-07-08-katago-rendimiento-informe.md)

## Contexto y objetivo

App web pública y **gratuita** de Go/Baduk desplegada íntegramente en Cloudflare: jugar contra KataGo y analizar partidas, con una UI construida sobre los componentes oficiales de Sabaki. Al ser un producto de regalo, el costo marginal por usuario debe ser ~$0.

## Decisión central: motor 100% client-side

La investigación (21 agentes, verificación adversarial; ver informe) descartó KataGo en Cloudflare Containers:

- Cloudflare no ofrece GPU; en CPU (tope 4 vCPU) la red b18 rinde ~3-8 visitas/s — **más débil que la iGPU de un laptop normal vía WebGPU (~10 inf/s medidas)**. Se pagaría por un motor peor que el del cliente.
- Costo del contenedor: ~$0.19/h activo, piso $0.076/h despierto ocioso, ~$459/mes con 10 concurrentes 8 h/día — lineal y sin techo para un producto sin ingresos.
- Client-side tiene precedente en producción: Kaya (kayago.app, red b28 + MCTS en TypeScript, desde mayo 2026) y web-katrain (MIT, TF.js).

**Vía elegida:** red neuronal de KataGo convertida a ONNX, inferencia con **onnxruntime-web sobre WebGPU**, búsqueda **MCTS reimplementada en TypeScript** dentro de un Web Worker. No se compila KataGo a WASM (no existe build oficial mantenido).

Decisiones de alcance del usuario:

- **Chrome-first:** WebGPU requerido en v1. Sin WebGPU → pantalla clara "usa Chrome/Edge". Fallback WASM multihilo queda para v2.
- **Descarga pesada aceptada:** redes de ~100 MB como estándar (audiencia con buena conectividad); se descargan una vez y quedan cacheadas.
- **Público, con cuentas completas** (Google OAuth) para guardar partidas.

## Alcance v1

- Jugar contra la IA: 9×9, 13×13, 19×19; handicap; komi; niveles desde 20k hasta sobrehumano.
- Analizar: cargar SGF o partida propia; winrate/score por jugada; heatmap de sugerencias; variaciones principales; review progresivo de partida completa.
- Cuentas Google: guardar, listar, reabrir partidas. Export/import SGF siempre disponible sin cuenta.

**Fuera de alcance v1:** humano vs humano, fallback WASM, móvil como target soportado (se evalúa después), torneos/social, análisis server-side.

## Arquitectura

Monorepo (npm workspaces):

```
tengen/
├── packages/engine/     # cerebro: MCTS TS + onnxruntime-web, sin UI
├── apps/web/            # SPA Preact + componentes Sabaki
├── apps/worker/         # Worker: static assets + API (Hono) + D1 + auth
└── docs/                # research + specs
```

### packages/engine

Corre en un Web Worker. Interfaz pública (el resto de la app no conoce ONNX ni MCTS):

```ts
interface Engine {
  init(config: { network: NetworkId; boardSize: number }): Promise<void>
  genMove(pos: Position, opts: { level: RankLevel | { visits: number } }): Promise<Move>
  analyze(pos: Position, opts: { visits: number }, onUpdate: (a: Analysis) => void): CancelFn
  stop(): void
}
```

- **Inferencia:** onnxruntime-web, execution provider WebGPU. Batching de posiciones para amortizar el round-trip a GPU.
- **MCTS:** PUCT estilo KataGo simplificado (policy + value + score mean; sin ownership en v1). Referencia de implementación: web-katrain (MIT). **Kaya es AGPL-3.0: sirve como prueba de factibilidad, prohibido copiar código.**
- **Encoding de inputs:** KataGo usa ~22 planos espaciales + features globales; es la pieza más delicada y se testea contra outputs conocidos de KataGo de escritorio (mismas posiciones → mismos policy/value dentro de tolerancia).
- La interfaz permite enchufar un motor remoto en el futuro sin re-arquitectura.

### Redes neuronales

Servidas desde **R2** (egress $0), cacheadas en el navegador con **OPFS** (persistente entre sesiones):

| Red | Tamaño aprox. | Uso |
|---|---|---|
| b18c384nbt (ONNX) | ~100-150 MB | principal: jugar fuerte + análisis |
| Human SL b18-humanv0 (ONNX) | ~100 MB | oponentes con rango humano realista 20k-9d |
| b10c128 (ONNX) | ~15 MB | opción ligera / primera jugada rápida |

Conversión con el pipeline open-source `katago-onnx`. Las redes se versionan en R2 (`/nets/<nombre>-<versión>.onnx`) con headers de caché inmutables.

### Niveles de fuerza

- **Rangos humanos (20k-9d):** Human SL, ~1 evaluación de policy por jugada — respuesta instantánea, estilo humano.
- **KataGo pleno:** visitas configurables (50 / 200 / 500+), red b18.
- Calibración fina (temperatura de policy, visitas por nivel) se ajusta tras la fase 0.

### apps/web

- **Preact** (Shudan está escrito en Preact — integración nativa) + Vite.
- `@sabaki/shudan` (tablero), `@sabaki/go-board` (reglas/capturas), `@sabaki/sgf` (parse/serialize).
- Estado de partida vive en el cliente (como Sabaki real); árbol de jugadas con variaciones.
- Modo **Jugar**: config de partida → juego contra engine → resultado (conteo con estimación del motor) → guardar/exportar.
- Modo **Analizar**: carga SGF → navegación por el árbol → análisis bajo demanda por posición (~50 visitas) → review completo progresivo priorizando jugadas con salto de winrate (patrón OGS).
- Partidas en curso persisten en localStorage aunque no haya cuenta.

### apps/worker (backend mínimo)

- Un solo Worker: sirve la SPA (static assets) + API JSON con **Hono**.
- **Auth:** better-auth con Google OAuth, tablas en D1. **Turnstile** en el registro.
- **D1:** tablas de better-auth + `games (id, user_id, name, sgf TEXT, board_size, result, created_at, updated_at)`.
- **Rate limiting** básico en la API (por usuario/IP) — protege D1, no hay cómputo que proteger.
- R2 binding para servir las redes (o dominio público de R2 con caché de Cloudflare delante).

## Manejo de errores

- **Sin WebGPU:** detección al arrancar → pantalla "necesitas Chrome/Edge" con explicación. La app de análisis de SGF sin motor sigue usable (navegar partidas).
- **Descarga de red fallida/interrumpida:** reintento con resume si OPFS tiene parcial; UI de progreso con tamaño total.
- **Crash del Worker de motor** (OOM en GPU, etc.): reinicio automático del Web Worker, la partida no se pierde (estado en el hilo principal).
- **API caída / sin sesión:** la app funciona offline-first para jugar/analizar; guardar en la nube falla con aviso y reintento, el SGF local nunca se pierde.

## Fase 0 obligatoria: benchmark real

Antes de construir UI: script que carga los ONNX (b10, b18, humanv0) en onnxruntime-web/WebGPU y mide inferencias/s en el hardware de Edgar. Único dato que la investigación no pudo cerrar con fuentes públicas (benchmarks existentes son de gama alta, sin réplica). El resultado calibra niveles y expectativas de análisis. Si b18 rindiera <2 inf/s en hardware típico, el plan B es b10/b15 como red principal (decisión documentada, no re-arquitectura).

Punto de referencia ya medido (durante la investigación se compiló y benchmarkeó KataGo v1.16.5 backend Eigen **en CPU** en el Mac M1 de Edgar, reproducido por un segundo agente): b18 = 2.3-4.6 visitas/s, b10c128 = 78-176 v/s, b6c96 = 249-382 v/s; RSS 713/170/96 MiB; carga de b18 (98 MB) ≈ 2 s. La fase 0 mide la vía WebGPU del navegador, que debería superar estas cifras de CPU.

## Monitoreo de releases upstream

El producto se apoya en repos open source activos; sus releases deben vigilarse (requisito explícito de Edgar):

| Dependencia | Qué vigilar | Por qué |
|---|---|---|
| `lightvector/KataGo` | releases (formato de redes, model version) + redes nuevas en katagotraining.org | redes mejores → producto más fuerte gratis; cambios de input encoding rompen el engine |
| `kaya-go/kaya` | releases + su repo de ONNX en Hugging Face | referencia de factibilidad; publica ONNX de redes KataGo ya convertidos |
| `web-katrain` | releases | referencia MIT del MCTS/encoding |
| `katago-onnx` | releases | pipeline de conversión de redes |
| `onnxruntime-web` | releases (npm) | el runtime de inferencia; regresiones/mejoras WebGPU |
| `@sabaki/shudan`, `@sabaki/sgf`, `@sabaki/go-board` | releases (npm) | componentes núcleo de la UI |
| `better-auth`, `hono` | releases (npm) + avisos de seguridad | superficie de auth |

Mecanismo en dos capas:
1. **npm:** Renovate (o Dependabot) en el repo — PRs automáticos por versión nueva.
2. **No-npm (KataGo, redes, kaya, katago-onnx):** watcher programado que consulta los feeds `releases.atom` de GitHub (+ índice de katagotraining.org) y notifica novedades — implementable como cron trigger del mismo Worker con aviso por email, o como routine programada de Claude Code. Se concreta en el plan de implementación.

## Testing

- **Vitest:** reglas de juego, parse/serialize SGF, encoding de inputs de la red (contra vectores de referencia generados con KataGo de escritorio).
- **MCTS:** tests deterministas con red mock (policy/value fijos) — selección PUCT, backup, límite de visitas.
- **Playwright:** smoke e2e — abrir app, jugar una jugada contra nivel débil, cargar un SGF.
- **Benchmark:** el script de fase 0 queda como herramienta permanente (`npm run bench`).

## Riesgos aceptados

1. Rendimiento en hardware modesto/móvil sin medir → fase 0 mide en hardware real; móvil fuera de alcance v1.
2. Solo Chrome/Edge (~84% cobertura WebGPU) → aceptado explícitamente; v2 puede añadir fallback WASM.
3. Encoding de inputs + MCTS es ingeniería no trivial → mitigado con referencias funcionando (web-katrain) y tests contra KataGo de escritorio.
4. Fuerza real de niveles calibrados no medida contra humanos → se calibra con feedback tras el lanzamiento.

## Preguntas abiertas (se resuelven en fase 0 / implementación)

1. inf/s reales por red en hardware típico (fase 0).
2. ~~¿ONNX ya convertidos disponibles públicamente o convertimos con katago-onnx?~~ **Respondida (2026-07-08, ver `docs/research/fase0/`):** los ONNX de Kaya en HF son MIT (solo b28); b18 y Human SL se convierten con katago-onnx (herramienta AGPL de uso local; Human SL requiere parche `meta_input`); b10 no tiene vía verificada (checkpoint TensorFlow) y solo se aborda si el gate de fase 0 lo exige.
3. Latencia percibida del review progresivo: ¿bastan "jugadas clave" a 50 visitas?
4. Dominio final del producto (se decide al desplegar).
