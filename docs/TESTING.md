# Testing en tengen

La estrategia de testing sigue una **frontera deliberada**, gobernada por una restricción de
arquitectura: el motor (WebGPU + ONNX de ~115 MB) **no corre en un runner de CI headless**. Por eso no
perseguimos un E2E pesado con el motor real; automatizamos todo lo que **no** necesita el motor y
dejamos el camino "motor en un navegador real" como gate manual documentado (el mismo patrón que
Lizzie/KaTrain).

## Qué se automatiza (corre en CI)

| Capa | Herramienta | Entorno | Ejemplos |
| --- | --- | --- | --- |
| **Dominio** | Vitest | Node | reglas de Go, SGF, encoding contra vectores de KataGo desktop, MCTS con red mock, árbol/markup, códecs, sync a D1 |
| **UI sin motor** | Vitest + [`@testing-library/preact`](https://github.com/testing-library/preact-testing-library) | jsdom | componentes **presentacionales** (`AnnotationEditor`, `GameReviewSummary`, …) |

Los tres workspaces corren con `npm test` (raíz). El CI (`.github/workflows/ci.yml`) ejecuta, en cada
PR y push a `main`: `npm run typecheck` → `npm test` → `npm run build -w @tengen/web`.

### Convención de los tests de componente

- **Un archivo por componente**, `apps/web/tests/<Componente>.test.tsx`.
- **Opt-in a jsdom por-archivo** con el docblock en la primera línea:

  ```ts
  // @vitest-environment jsdom
  ```

  El default del proyecto es `environment: 'node'` (los ~40 tests de dominio no tocan el DOM y así
  siguen rápidos). El JSX de Preact para los `.tsx` está declarado en `apps/web/vitest.config.ts`
  (`esbuild: { jsx: 'automatic', jsxImportSource: 'preact' }`) — Vitest usa ese archivo en exclusiva y
  no hereda el `esbuild` de `vite.config.ts`.
- **Cleanup a mano**: `import { cleanup } from '@testing-library/preact'; afterEach(cleanup)` en cada
  archivo. No usamos `globals: true` (correría en la suite de dominio también), así que el auto-cleanup
  de testing-library no dispara solo.
- **Matchers de jest-dom**: `import '@testing-library/jest-dom/vitest'` (registra runtime **y** tipos;
  el `tsc` del CI compila los tests, así que los tipos importan).
- **Presentacional, no contenedor**: se testean componentes que reciben props puras y devuelven eventos.
  El estado/efectos y todo lo que necesita el motor o Shudan (p.ej. el clic-en-tablero → coloca
  piedra/marca) se quedan en el contenedor; su lógica se cubre con tests de dominio (`markup.test.ts`,
  etc.) + el gate manual. Por eso `AnnotationEditor` se extrajo de `AnalyzeView` (contenedor) —
  el mismo patrón container/presentacional que ya usan `GameReviewPanel`/`WinrateGraphPanel`.

## Qué es gate manual (NO corre en CI)

Todo lo que ejerce el motor real necesita **Chrome con WebGPU**:

- Partida completa en Modo Jugar contra KataGo.
- Análisis de un SGF real en Modo Analizar (heatmap/PV/winrate del MCTS real).
- `self.crossOriginIsolated === true` en producción (COOP/COEP).

Estos se verifican a mano contra el dev server local o producción (`tengen.kntor.io`), y se anotan en el
ledger de progreso. Un Playwright smoke acotado (arranca la SPA, sin motor) es trabajo futuro fuera del
alcance actual.

## El benchmark del motor

`npm run bench` (harness permanente en `packages/engine`) mide inferencias/s reales en WebGPU. Requiere
los modelos descargados (`packages/engine/scripts/download-models.sh`) y un navegador con WebGPU — no es
un test de CI, es una medición reproducible. Igual `npm run -w @tengen/engine test:nn`, que valida el
encoding contra los ONNX reales y por eso **no** forma parte de `npm test`.
