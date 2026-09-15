// Prefill de "Practicá lo que aprendiste" (Aprender → Jugar, Task 13): `/jugar?practica=<lessonId>`
// se traduce al `initial` que espera `NewGameForm`, y a si ese prefill gana la prioridad de RENDER
// sobre una partida restaurada.
//
// Aislado en su propio módulo, sin import de `main.tsx`: `PlayView` se autoguarda en CADA jugada
// (`persist()`, sin acción explícita del alumno), así que cualquier progreso del currículo más allá
// de la primera práctica deja una partida vieja en localStorage — sin la prioridad de `practiceWins`,
// `restoreSession()` la encontraría y el `practica=...` de la URL nunca se leería (bug real,
// detectado en revisión post-Task 13: CUALQUIER alumno que progrese más allá de su primera sesión de
// práctica lo pisaba). El aislamiento en este módulo también es lo que lo hace testeable sin montar
// `main.tsx` entero: ese archivo importa `virtual:pwa-register` (vite-plugin-pwa) a través de
// `pwa/swController.ts`, y `vitest.config.ts` no registra ese plugin — importar `main.tsx` en un
// test falla en el análisis de imports de Vite antes de ejecutar una sola línea.
import type { BoardSize, HumanRank } from '@tengen/engine'
import { CURRICULUM } from './curriculum'
import type { Lesson } from './lesson'

export interface PracticaPrefill {
  /** La lección de `CURRICULUM` que matchea `?practica=`, o `undefined` si el param falta o no
   * corresponde a ninguna lección conocida. */
  lesson: Lesson | undefined
  /** El `initial` listo para `NewGameForm`, derivado de `lesson.practiceOpponent`. `undefined` en
   * el mismo caso que `lesson`. */
  initial: { boardSize: BoardSize; opponentKind: 'human'; humanRank: HumanRank } | undefined
}

/** Lee `search` (típicamente `window.location.search`) y resuelve el prefill de práctica. Sin
 * `practica`, o con un id que no matchea ninguna lección de `CURRICULUM`: ambos campos `undefined`
 * -- comportamiento normal de "Jugar", cero cambio. */
export function resolvePracticaPrefill(search: string): PracticaPrefill {
  const params = new URLSearchParams(search)
  const practicaId = params.get('practica')
  const lesson = practicaId ? CURRICULUM.find((l) => l.id === practicaId) : undefined
  const initial = lesson
    ? {
        boardSize: lesson.practiceOpponent.boardSize,
        opponentKind: 'human' as const,
        humanRank: lesson.practiceOpponent.rank,
      }
    : undefined
  return { lesson, initial }
}

/**
 * El prefill de práctica gana la prioridad de render sobre una sesión restaurada -- PERO sólo
 * mientras el alumno no arrancó/importó una partida en ESTE montaje de `PlayApp` (`startedHere`):
 * el `practica=...` de la URL no se limpia solo, así que sin este freno, tras "Empezar partida" el
 * siguiente render volvería a mostrar el formulario en vez de la partida recién iniciada -- el
 * mismo prefill que destrababa el caso "sesión vieja" bloquearía por completo empezar una nueva.
 * Deliberadamente NO destructivo: esta función no toca storage, sólo decide qué se pinta; la
 * partida restaurada sigue intacta en localStorage si el alumno vuelve a /jugar sin el query param.
 */
export function practiceWins(startedHere: boolean, prefill: PracticaPrefill): boolean {
  return !startedHere && prefill.lesson !== undefined
}
