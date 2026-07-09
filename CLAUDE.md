# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es tengen

App web pública y **gratuita** de Go/Baduk sobre Cloudflare: jugar contra KataGo y analizar partidas, con UI construida sobre los componentes oficiales de Sabaki. Estado: **fase 0 completa** (monorepo + harness de benchmark + redes convertidas + gate decidido); la siguiente fase es el engine (MCTS + encoding).

**Lee primero la spec:** `docs/superpowers/specs/2026-07-08-tengen-design.md`. La investigación que respalda cada decisión (con cifras verificadas) está en `docs/research/`; los resultados medidos de fase 0 y el veredicto de licencias de pesos están en `docs/research/fase0/resultados.md`.

## Comandos

- `npm test` — Vitest de todos los workspaces (`npm test -w @tengen/engine` para uno).
- `npx -w @tengen/engine tsc --noEmit` — typecheck (strict + noUncheckedIndexedAccess).
- `packages/engine/scripts/download-models.sh` — descarga los ONNX publicados a `packages/engine/models/` (gitignored) validando bytes.
- `npm run bench` — harness de benchmark en Chrome (`bench.html` vía Vite; requiere modelos descargados). El dev server sirve `/models/` y `/ort-dist/` (runtime de onnxruntime-web) vía middlewares propios en `vite.config.ts` — Vite no puede servir imports de módulo desde `public/`, y el worker de ORT exige header COEP: no "simplificar" eso.
- Conversión de redes (herramienta local, no del producto): clon de kaya-go/katago-onnx en `~/dev/vendor/katago-onnx` (`pixi install`); Human SL requiere `packages/engine/scripts/convert-humanv0.py` (AGPL, solo uso local).

## Datos medidos que gobiernan decisiones (fase 0, Chrome/WebGPU, Apple M1)

b18 fp16 = 2.79 inf/s (batch 1) / 4.64 (batch 8); Human SL igual; b28 = 1.31 (descartada como principal); WebGPU ≈ 2.2× WASM. Gate ≥2 inf/s PASADO → **b18c384nbt fp16 es la red principal** (58 MB) + Human SL fp16 (54 MB). Formato a servir: fp16 (misma velocidad que fp32, mitad de peso).

## Decisiones ya tomadas — no re-litigar

- **Motor 100% client-side.** Red neuronal de KataGo convertida a ONNX + inferencia con onnxruntime-web (WebGPU) + MCTS reimplementado en TypeScript en un Web Worker. NO se usa Cloudflare Containers (sin GPU, más débil que la iGPU del cliente y con costo lineal — ver informe en `docs/research/`). NO se compila KataGo a WASM.
- **Chrome-first:** WebGPU requerido en v1; sin fallback WASM. Sin WebGPU → mensaje "usa Chrome/Edge".
- **UI en Preact** con `@sabaki/shudan` (tablero), `@sabaki/go-board` (reglas) y `@sabaki/sgf`.
- **Backend mínimo:** un Worker (Hono) sirve la SPA + API; D1 con better-auth (Google OAuth) y partidas guardadas; Turnstile en registro. Cero cómputo de motor en servidor.
- **Redes neuronales desde R2** (b18c384nbt, Human SL humanv0, b10c128), cacheadas client-side en OPFS. Nunca en git (`.gitignore` bloquea `*.onnx` y `*.bin.gz`).
- **Fase 0 gatea la UI:** antes de construir interfaz hay que medir inferencias/s reales en WebGPU con el harness de benchmark (queda como `npm run bench` permanente).

## Restricción de licencias (crítico)

- **Kaya (github.com/kaya-go/kaya) es AGPL-3.0: prohibido copiar su código.** Sirve solo como prueba de factibilidad y referencia de arquitectura a distancia.
- **web-katrain es MIT:** referencia segura para MCTS y encoding de inputs.

## Requisito permanente: monitoreo de releases upstream

El producto depende de repos externos (KataGo, katago-onnx, onnxruntime-web, `@sabaki/*`, better-auth). Todo cambio de diseño debe mantener la sección "Monitoreo de releases upstream" de la spec; al montar CI, incluir Renovate + watcher de `releases.atom` para lo no-npm.

## Estructura planificada (según spec)

Monorepo npm workspaces: `packages/engine` (MCTS + ONNX, sin UI, detrás de la interfaz `Engine`), `apps/web` (SPA Preact), `apps/worker` (Worker + D1 + R2). Testing: Vitest (reglas, SGF, encoding contra vectores de referencia de KataGo desktop; MCTS con red mock determinista) + Playwright smoke.

## Idioma

Edgar trabaja en español: documentación, specs, commits y comunicación en español; identificadores de código en inglés.
