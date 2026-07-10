import { defineConfig } from 'vitest/config'

// Config dedicada para el test de referencia end-to-end (Task 10): carga un ONNX de 116 MB y corre
// inferencia real, así que se aísla de la suite normal (`vitest.config.ts` lo excluye) y se invoca
// aparte via `npm run test:nn`.
export default defineConfig({
  test: { include: ['tests/nn.reference.test.ts'] },
})
