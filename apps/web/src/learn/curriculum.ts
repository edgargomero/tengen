// Bloque 1 del currículo FEDIBERGO: registro análogo a collections.ts, mismo motivo (JSON al
// bundle para el precache de la PWA sin tocar globPatterns). REGLA: un bloque entra solo después
// de que su veredicto de licencia esté escrito (ver Task 1) -- ver también collections.ts:5-7.
import type { Lesson } from './lesson'
import bloque1 from './data/bloque-1.json'

export const CURRICULUM: readonly Lesson[] = bloque1 as unknown as readonly Lesson[]
