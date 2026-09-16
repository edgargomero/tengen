// Currículo FEDIBERGO (todos los bloques): registro análogo a collections.ts, mismo motivo
// (JSON al bundle para el precache de la PWA sin tocar globPatterns). REGLA: un bloque entra
// solo después de que su veredicto de licencia esté escrito -- ver también collections.ts:5-7.
import type { Lesson } from './lesson'
import bloque1 from './data/bloque-1.json'
import bloque2 from './data/bloque-2.json'

export const CURRICULUM: readonly Lesson[] = [...bloque1, ...bloque2] as unknown as readonly Lesson[]
