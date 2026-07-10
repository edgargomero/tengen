import { defineConfig } from 'vitest/config'

// Fase 1 (entrega de modelos): netManifest/progress/modelCache son puros y se testean en Node
// (sin DOM). ModelGate/modelStore (OPFS) son browser-only y no tienen test Node (ver plan).
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
