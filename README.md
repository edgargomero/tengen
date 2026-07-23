# tengen

[![CI](https://github.com/edgargomero/tengen/actions/workflows/ci.yml/badge.svg)](https://github.com/edgargomero/tengen/actions/workflows/ci.yml)

App web pública y **gratuita** de Go/Baduk sobre Cloudflare: jugar contra KataGo y analizar
partidas, con la UI construida sobre los componentes oficiales de [Sabaki](https://github.com/SabakiHQ).
El motor corre **100% en el cliente** — la red neuronal de KataGo convertida a ONNX + inferencia con
onnxruntime-web (WebGPU) + un MCTS en TypeScript dentro de un Web Worker. Cero cómputo de motor en
servidor.

> **Diseño y decisiones:** la spec vive en
> [`docs/superpowers/specs/2026-07-08-tengen-design.md`](docs/superpowers/specs/2026-07-08-tengen-design.md);
> la investigación que respalda cada decisión está en [`docs/research/`](docs/research/).

## Estructura

Monorepo de npm workspaces:

- **`packages/engine`** — MCTS + inferencia ONNX, sin UI, detrás de la interfaz `Engine`.
- **`apps/web`** — SPA en Preact con `@sabaki/shudan` (tablero) y `@sabaki/sgf`.
- **`apps/worker`** — Worker de Cloudflare (Hono) que sirve la SPA + API; D1 con better-auth y R2 para las redes.

## Desarrollo

```sh
npm install
npm run typecheck   # tsc --noEmit en los 3 workspaces
npm test            # Vitest de todos los workspaces (dominio + componentes)
npm run build -w @tengen/web
```

- `packages/engine/scripts/download-models.sh` descarga los ONNX publicados (gitignored) — solo hace
  falta para `npm run bench` y `npm run -w @tengen/engine test:nn`, **no** para `npm test` ni el build.
- `npm run bench` corre el harness de benchmark en Chrome (requiere modelos + WebGPU).

## Testing

Ver [`docs/TESTING.md`](docs/TESTING.md). En resumen: todo lo que **no** necesita el motor (dominio +
UI vía componentes presentacionales) se testea en CI (Vitest, jsdom); el camino "motor en un navegador
real" es un gate **manual** documentado, acotado por el requisito de WebGPU.

## Licencia

Ver [`packages/engine/THIRD-PARTY-LICENSES`](packages/engine/THIRD-PARTY-LICENSES) para la atribución
del código de terceros adaptado (web-katrain, MIT).
