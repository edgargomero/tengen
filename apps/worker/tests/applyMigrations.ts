// setupFile del pool de Workers: aplica las migraciones D1 committeadas antes de cada suite.
// Necesario aunque el schema no cambie: el isolated storage recrea la DB por test.
import { applyD1Migrations, env } from 'cloudflare:test'
import type { Env } from '../src/index'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
