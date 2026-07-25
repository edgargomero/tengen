import { defineConfig } from 'vitest/config'

// JSX de Preact para los tests de componente .tsx: Vitest usa ESTE archivo en exclusiva cuando existe
// (no hereda el `esbuild` de vite.config.ts), así que hay que declararlo aquí o los .tsx compilarían a
// React.createElement y explotarían en runtime.
//
// `environment: 'node'` por defecto: los ~40 tests de dominio (.test.ts — netManifest/gameTree/rules/
// markup/…) son puros y NO tocan el DOM, así que siguen rápidos sin jsdom. Los tests de componente
// (.test.tsx, p.ej. AnnotationEditor) optan a jsdom POR-ARCHIVO con el docblock
// `// @vitest-environment jsdom` — no se paga el costo del DOM en la suite de dominio.
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
})
