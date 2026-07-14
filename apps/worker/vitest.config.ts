import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

// Forma async: lee las migraciones SQL committeadas (migrations/) en config-time y las pasa como
// binding TEST_MIGRATIONS. El setupFile las aplica ANTES de cada suite porque el isolated storage
// del pool recrea el D1 por test — no alcanza con migrar una sola vez fuera.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    test: {
      setupFiles: ['./tests/applyMigrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Producción los recibe como secrets/vars; en tests son valores fijos (ningún test
              // llama a Google de verdad — ver authSeed.ts).
              BETTER_AUTH_SECRET: 'test-secret',
              GOOGLE_CLIENT_ID: 'test-client-id',
              GOOGLE_CLIENT_SECRET: 'test-client-secret',
              BETTER_AUTH_URL: 'http://localhost:8787',
            },
          },
        },
      },
    },
  }
})
