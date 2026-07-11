# Fase 4 — `apps/worker` base: deploy sin cuentas

**Fecha:** 2026-07-11 · **Estado:** aprobado por Edgar · **Roadmap:** [`docs/superpowers/plans/2026-07-10-tengen-v1-roadmap.md`](../plans/2026-07-10-tengen-v1-roadmap.md) (Fase 4) · **Spec de producto:** [`2026-07-08-tengen-design.md`](2026-07-08-tengen-design.md)

## Contexto y objetivo

tengen (Modo Jugar + Modo Analizar) está completo en código y probado (`npm test` en verde en ambos workspaces), pero **no es desplegable hoy**: no existe `apps/worker/`, y los modelos ONNX solo se sirven vía un middleware de Vite en dev (`/models/`, `packages/engine/models/`, gitignored). Esta fase entrega el **primer deploy público de tengen**, sin cuentas: cualquiera puede entrar a `tengen.kntor.io`, jugar contra el motor y analizar partidas, gratis, sin login.

**Decisión explícita de esta sesión (confirmada por Edgar):** desplegar AHORA con lo que ya existe (Modo Jugar + Modo Analizar), sin esperar a Fase 3b (comentarios por posición + biblioteca local de partidas) ni a Fase 5 (cuentas Google + guardado en la nube). La spec de producto ya anticipa este modo de operación explícitamente en su sección "Manejo de errores": *"API caída / sin sesión: la app funciona offline-first para jugar/analizar... el SGF local nunca se pierde"* — el producto está diseñado para funcionar completo sin backend de cuentas, así que separar el deploy de la infraestructura de auth no es un recorte, es el camino que la spec ya previó.

**Corrección sobre el roadmap (Fase 4 tal como está escrita hoy en el roadmap tiene dos datos desactualizados, verificados contra el código real):**
- El roadmap dice "subir las redes fp16 (b18 58 MB + humanv0 54 MB)". Eso está **revocado**: el fp16 convertido produce policy NaN en inferencia (ver CLAUDE.md, corrección 2026-07-10). El código real (`apps/web/src/models/netManifest.ts`) ya usa **fp32**: `b18c384nbt-kata1.fp32.onnx` (115 800 125 bytes) y `b18c384nbt-humanv0.fp32.onnx` (108 040 143 bytes). Esta fase sube los fp32 reales, no los fp16 que menciona el roadmap.
- El roadmap prevé dominio propio recién en Fase 6 (`*.workers.dev` primero, dominio real "se decide al desplegar"). Edgar ya tiene `kntor.io` en Cloudflare (nameservers `gordon`/`annalise.ns.cloudflare.com` — confirmado con `dig`) — no hay motivo para diferir el dominio: esta fase despliega directo a `tengen.kntor.io`.

## Alcance

**Dentro de esta fase:**
- `apps/worker/` nuevo: un Cloudflare Worker (Hono) que sirve la SPA (`apps/web` build) como static assets + una ruta que sirve los modelos ONNX desde R2.
- Subir los 2 modelos fp32 de producción a un bucket R2 nuevo.
- Conectar `tengen.kntor.io` como dominio del Worker.
- Deploy manual (`wrangler deploy`) — sin CI todavía.

**Explícitamente fuera de esta fase** (quedan como fases futuras del roadmap, sin tocar aquí):
- Cuentas Google / better-auth / D1 / Turnstile / guardado en la nube (Fase 5).
- CI (Renovate, GitHub Actions, watcher de releases upstream) y Playwright smoke e2e (Fase 6).
- Fase 3b (comentarios por posición, biblioteca local de partidas) — feature de producto, no bloquea el deploy.
- Red b10c128 (nunca convertida — `netManifest.ts` ya la trata como ausente, `Partial<Record<NetworkId,...>>`).

## Arquitectura

Un solo Worker, dos responsabilidades — mismo patrón que ya describe la spec de producto ("un solo Worker sirve la SPA + API") y el roadmap (Fase 4):

```
apps/worker/
├── src/index.ts       # Hono app: monta el proxy de modelos; el resto lo resuelve el binding de assets
├── wrangler.jsonc      # assets binding (apps/web/dist) + R2 binding + rutas + dominio custom
└── package.json
```

1. **Static assets** — el build de Vite de `apps/web` (`apps/web/dist/`) se sirve vía el binding nativo `assets` de Cloudflare Workers (`wrangler.jsonc` → `"assets": { "directory": "../web/dist" }`). Esto NO pasa por código Hono: Cloudflare lo resuelve directo, más rápido y más barato que proxyarlo a mano.
2. **`/models/*` → R2** — Hono intercepta `/models/<archivo>`, lee del binding R2 (`env.MODELS.get(key)`) y devuelve el archivo. Se mantiene el MISMO path que usa hoy el middleware de dev (`serve-models`, `/models/`) — así `netManifest.ts` en `apps/web` solo cambia la string `sourceUrl` de `/models/<archivo>` a una URL absoluta de producción (o se deja relativa, ya que el Worker sirve ambas cosas bajo el mismo dominio — ver "Decisión: URL relativa" abajo), sin tocar el resto del pipeline OPFS/progreso/reintento de Fase 1.

**Decisión: proxy por el Worker, no bucket público + subdominio propio.** La spec deja abierta la alternativa ("R2 binding... o dominio público de R2 con caché de CF delante"). Se elige el binding porque: (a) todo queda bajo un solo dominio (`tengen.kntor.io/models/...`), sin gestionar un segundo registro DNS/subdominio; (b) el Worker controla los headers de caché exactos por archivo (immutable, ver abajo) en un solo lugar; (c) es más simple de razonar para esta fase — un bucket público con CDN delante es una optimización de egress/latencia que se puede migrar después sin romper `apps/web` (la URL sigue siendo `/models/...`, cambiaría solo qué la resuelve).

**Decisión: URL relativa, no absoluta.** Como el Worker sirve TANTO la SPA como `/models/*` bajo el mismo origen, `netManifest.ts` no necesita saber el dominio de producción — `sourceUrl: '/models/<archivo>'` sigue funcionando en dev (vía el middleware de Vite) y en producción (vía el Worker) sin ninguna rama de código por entorno. Único cambio real en `apps/web`: ninguno — el manifest ya está escrito así.

## Modelos en R2

- **Bucket:** `tengen-models` (nuevo, R2).
- **Objetos:** `b18c384nbt-kata1.fp32.onnx` (115 800 125 bytes), `b18c384nbt-humanv0.fp32.onnx` (108 040 143 bytes) — mismos nombres que hoy en `packages/engine/models/` y que `netManifest.ts` ya espera, cero fricción de mapeo.
- **Subida:** manual, `wrangler r2 object put tengen-models/<archivo> --file packages/engine/models/<archivo>` — no hace falta un pipeline para 2 archivos que cambian rara vez (una vez por red nueva/reconvertida).
- **Cache-Control:** el Worker responde `Cache-Control: public, max-age=31536000, immutable` en `/models/*` — los nombres de archivo son versionados en la práctica (un cambio de red = nombre de archivo distinto, ver `opfsName`/`sourceUrl` de `netManifest.ts`), así que "immutable" es seguro: nunca se pisa un archivo con contenido distinto bajo el mismo nombre.
- **Versionado futuro:** si una red se reconvierte, sube como archivo nuevo (`-v2` o similar en el nombre) y se actualiza `netManifest.ts` — mismo mecanismo que ya usa `opfsName` para invalidar el caché de OPFS del navegador.

## Dominio y deploy

- `tengen.kntor.io` como **custom domain** del Worker (Cloudflare Dashboard o `wrangler.jsonc` → `routes`), dentro de la misma cuenta que ya tiene `kntor.io`.
- `wrangler deploy` manual desde el repo — sin GitHub Actions en esta fase (eso es Fase 6). El flujo es: `npm run build -w @tengen/web` → `wrangler deploy` desde `apps/worker/` (que referencia `../web/dist` en el binding de assets).
- Sin secrets nuevos en esta fase (no hay auth todavía) — el único "secreto" es el binding de R2, que no es una credencial de texto sino un binding nativo configurado en `wrangler.jsonc`.

## Headers (COOP/COEP)

onnxruntime-web con WASM multihilo necesita `crossOriginIsolated` para usar `SharedArrayBuffer`. El middleware de Vite dev ya resuelve esto (`vite.config.ts`, `packages/engine/vite.config.ts` como referencia portable) con dos piezas que el Worker debe replicar EXACTAS, no reinventar:

1. **A nivel documento** (toda respuesta HTML/navegación): `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`.
2. **Por archivo, en los `.mjs`/`.wasm` de onnxruntime-web** que carga el Worker de ORT como script de un dedicated worker: `Cross-Origin-Embedder-Policy: require-corp` explícito — si falta, Chrome bloquea la carga bajo `crossOriginIsolated`.

WebGPU (la vía principal, Chrome-first) NO exige estos headers — son necesarios solo para que la vía WASM multihilo de onnxruntime-web no rompa si alguna vez se usa como fallback. Se portan de todas formas porque ya están resueltos y no cuestan nada replicarlos.

**Decisión: `_headers`, no código Hono.** Cloudflare Workers Static Assets soporta headers custom vía un archivo `_headers` (mismo formato que Cloudflare Pages) junto al directorio de assets — reglas por patrón de ruta, sin que cada request pase por JS. Se usa `_headers` para ambos casos: una regla `/*` con COOP+COEP a nivel documento, y una regla más específica para los `.mjs`/`.wasm` de onnxruntime-web con su `Cross-Origin-Embedder-Policy: require-corp` — es declarativo, más simple de auditar que lógica condicional en Hono, y como ambas reglas son headers FIJOS (no dependen de estado en tiempo de request), no hay ninguna razón para involucrar código.

## Manejo de errores

Nada nuevo respecto a lo que ya existe: la spec de producto ya cubre "descarga de red fallida" (Fase 1, reintento con resume) y "Worker de motor crashea" (reinicio automático, ya implementado en `EngineManager`). Esta fase no introduce ningún estado de error nuevo — solo cambia DE DÓNDE se descargan los modelos (R2 en vez de `/models/` de dev), el resto del pipeline de descarga/caché/reintento de Fase 1 queda intacto.

## Testing / verificación

- `apps/worker` es infraestructura mínima (un Hono app de pocas rutas) — no necesita una suite Vitest propia extensa; un test de que la ruta `/models/<archivo>` responde 200 con el `Content-Type`/`Cache-Control` esperados (mockeando el binding R2) es suficiente.
- **Gate real, manual (Edgar, Chrome/WebGPU):** entrar a `tengen.kntor.io`, confirmar que la SPA carga, que los modelos se descargan desde R2 (Network tab, no localhost), que Modo Jugar funciona de punta a punta (partida completa) y Modo Analizar funciona de punta a punta (cargar SGF, analizar, review progresivo, guessMove) — mismo tipo de gate manual que cerró Fase 2 y Fase 3a, ahora contra el dominio real en vez de `localhost`.
- Confirmar que `crossOriginIsolated` es `true` en producción (DevTools console: `self.crossOriginIsolated`) si se llega a ejercitar la vía WASM multihilo (no es el camino principal, pero vale confirmarlo una vez).

## Decisiones abiertas resueltas en esta spec

Del roadmap ("Decisiones abiertas... 1. Bucket/dominio de R2 y esquema de versionado de redes (Fase 4)"):
- Bucket: `tengen-models`.
- Versionado: nombre de archivo cambia por versión (ya es el patrón que sigue `netManifest.ts`); sin esquema de rutas `/nets/<nombre>-<versión>.onnx` separado — se mantiene simple con `/models/<archivo-real>`.

Del roadmap ("2. Dominio propio del producto (Fase 6, pregunta abierta #4 del spec)"): resuelta AHORA, no en Fase 6 — `tengen.kntor.io`, ya que Edgar ya tiene el dominio listo en Cloudflare y no hay razón para diferirlo.

## Fuera de alcance (recordatorio, no re-litigar en el plan de esta fase)

Cuentas Google (Fase 5), CI/monitoreo upstream (Fase 6), Fase 3b (comentarios/biblioteca local) — todas quedan para su propio ciclo brainstorm→spec→plan→SDD, como ya establece el roadmap.
