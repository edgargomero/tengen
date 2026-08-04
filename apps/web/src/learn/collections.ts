// Fase Aprender T3/T6: el registro de colecciones que la UI ofrece. Los datasets se importan acá
// como módulos JSON (los genera scripts/convert-tsumego.mjs): entran al bundle y por lo tanto al
// precache de la PWA sin tocar `globPatterns` (orden de plugins frágil, ver vite.config.ts).
//
// REGLA (CLAUDE.md + plan de la fase): un dataset se agrega SOLO después de que su veredicto de
// licencia esté escrito en docs/research/fase-aprender/contenido-licencias.md. Sin veredicto no hay
// import, aunque el JSON exista en el disco.
import type { Exercise } from './exercise'
// Colección semilla «Primeros pasos»: posiciones y árboles 100% originales de tengen (veredicto en
// docs/research/fase-aprender/contenido-licencias.md §Decisión operativa; fuente SGF committeada en
// apps/web/content/tsumego/primeros-pasos/). El cast va acompañado de un guardián real: el test
// tests/learnData.test.ts valida forma y legalidad de CADA dataset importado acá con exerciseIssues.
import primerosPasos from './data/primeros-pasos.json'

export interface ExerciseCollectionData {
  id: string
  title: string
  exercises: readonly Exercise[]
}

export const COLLECTIONS: readonly ExerciseCollectionData[] = [
  {
    id: 'primeros-pasos',
    title: 'Primeros pasos',
    exercises: primerosPasos as unknown as readonly Exercise[],
  },
]
