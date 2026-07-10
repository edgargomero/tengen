import { defineConfig, configDefaults } from 'vitest/config'

// El test de referencia end-to-end (Task 10, `tests/nn.reference.test.ts`) carga un ONNX de 116 MB
// y corre inferencia real: se excluye de la suite normal y corre aparte via `npm run test:nn`
// (config dedicada en `vitest.nn.config.ts`).
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], exclude: [...configDefaults.exclude, 'tests/nn.reference.test.ts'] },
})
