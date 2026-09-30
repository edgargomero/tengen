import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// go-rules corre también en el Worker/DO: si algo de valor llega desde @tengen/engine (salvo /clock,
// que es puro), el bundle arrastra onnxruntime. Esta guarda detecta esos imports de forma estática.
const ENGINE = String.raw`['"]@tengen\/engine(\/[^'"]*)?['"]`
const ENGINE_SPEC = new RegExp(ENGINE)

/** Devuelve los fragmentos de `source` que traen valores de `@tengen/engine` (todo salvo `/clock` y `import type`). */
export function findEngineValueImports(source: string): string[] {
  const hits: string[] = []
  const add = (stmt: string) => {
    const m = ENGINE_SPEC.exec(stmt)
    if (!m) return
    if (m[1] === '/clock') return
    hits.push(stmt.replace(/\s+/g, ' ').trim())
  }
  // import/export … from '…' (multilínea incluida; [^;'"]* no cruza de una sentencia a otra con comillas).
  const fromRe = /\b(import|export)(\s+type\b)?\s*([^;'"]*?)\s*\bfrom\s*(['"][^'"]+['"])/g
  for (const m of source.matchAll(fromRe)) {
    if (m[2]) continue // `import type` / `export type` se elide por completo
    add(`${m[1]} ${m[3]} from ${m[4]}`)
  }
  // import '…' de efecto lateral
  for (const m of source.matchAll(/\bimport\s*(['"][^'"]+['"])/g)) add(`import ${m[1]}`)
  // import('…') dinámico
  for (const m of source.matchAll(/\bimport\s*\(\s*(['"][^'"]+['"])\s*\)/g)) add(`import(${m[1]})`)
  return hits
}

describe('findEngineValueImports (detectora)', () => {
  const ok = [
    `import type { Engine } from '@tengen/engine'`,
    `import type { Engine } from "@tengen/engine/types"`,
    `import { applyElapsed } from '@tengen/engine/clock'`,
    `import type {\n  A,\n  B,\n} from '@tengen/engine/types'`,
    `export type { A } from '@tengen/engine'`,
    `import { x } from './local'`,
    `import { y } from '@tengen/engine-other'`,
  ]
  const bad = [
    `import { Engine } from '@tengen/engine'`,
    `import { Engine } from '@tengen/engine/types'`,
    `import { type Engine } from '@tengen/engine/types'`,
    `import { type A, b } from '@tengen/engine'`,
    `import * as e from '@tengen/engine/mcts'`,
    `import def from "@tengen/engine"`,
    `export { A } from '@tengen/engine'`,
    `export * from '@tengen/engine/types'`,
    `import {\n  A,\n  B,\n} from '@tengen/engine'`,
    `const m = await import('@tengen/engine')`,
    `const m = import("@tengen/engine/types")`,
    `import '@tengen/engine'`,
  ]
  it.each(ok)('permite: %s', (src) => expect(findEngineValueImports(src)).toEqual([]))
  it.each(bad)('detecta: %s', (src) => expect(findEngineValueImports(src)).toHaveLength(1))
  it('no cruza sentencias: un import permitido seguido de uno prohibido da un solo hallazgo', () => {
    const src = `import type { A } from '@tengen/engine'\nimport { b } from '@tengen/engine/types'\n`
    expect(findEngineValueImports(src)).toHaveLength(1)
  })
})

describe('go-rules no importa valores de @tengen/engine (M-6)', () => {
  const dir = join(__dirname, '..', 'src')
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    it(f, () => expect(findEngineValueImports(readFileSync(join(dir, f), 'utf8'))).toEqual([]))
  }
})
