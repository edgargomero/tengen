# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es tengen

App web pública y **gratuita** de Go/Baduk sobre Cloudflare: jugar contra KataGo y analizar partidas, con UI construida sobre los componentes oficiales de Sabaki. El proyecto está en fase de diseño/arranque: todavía no hay código, solo especificación e investigación.

**Lee primero la spec:** `docs/superpowers/specs/2026-07-08-tengen-design.md`. La investigación que respalda cada decisión (con cifras verificadas) está en `docs/research/`.

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
