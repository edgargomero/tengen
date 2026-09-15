// Task 13 fix: el prefill de "Practicá lo que aprendiste" (Aprender → Jugar) y la prioridad de
// render sobre una sesión restaurada. Puro, Node-testeable -- ver el comentario de cabecera de
// `practicaPrefill.ts` para por qué este módulo vive separado de `main.tsx` (que arrastra
// `virtual:pwa-register`, sin resolver bajo `vitest.config.ts`).
import { describe, expect, it } from 'vitest'
import { CURRICULUM } from '../src/learn/curriculum'
import { practiceWins, resolvePracticaPrefill, type PracticaPrefill } from '../src/learn/practicaPrefill'

const LESSON_1 = CURRICULUM[0]!

describe('resolvePracticaPrefill', () => {
  it('sin query string: lesson e initial undefined', () => {
    expect(resolvePracticaPrefill('')).toEqual({ lesson: undefined, initial: undefined })
  })

  it('con un id que no matchea ninguna lección: lesson e initial undefined', () => {
    expect(resolvePracticaPrefill('?practica=no-existe')).toEqual({ lesson: undefined, initial: undefined })
  })

  it('con un id de lección real: resuelve la lección y el initial de NewGameForm', () => {
    const result = resolvePracticaPrefill(`?practica=${LESSON_1.id}`)
    expect(result.lesson).toBe(LESSON_1)
    expect(result.initial).toEqual({
      boardSize: LESSON_1.practiceOpponent.boardSize,
      opponentKind: 'human',
      humanRank: LESSON_1.practiceOpponent.rank,
    })
  })

  it('ignora otros params de query string además de practica', () => {
    const result = resolvePracticaPrefill(`?foo=bar&practica=${LESSON_1.id}&baz=1`)
    expect(result.lesson).toBe(LESSON_1)
  })
})

describe('practiceWins', () => {
  const sinPractica: PracticaPrefill = { lesson: undefined, initial: undefined }
  const conPractica: PracticaPrefill = resolvePracticaPrefill(`?practica=${LESSON_1.id}`)

  it('sin practica en la URL: false, sin importar si ya se arrancó algo en este montaje', () => {
    expect(practiceWins(false, sinPractica)).toBe(false)
    expect(practiceWins(true, sinPractica)).toBe(false)
  })

  // El caso que estaba roto ANTES del fix: una partida autoguardada (`PlayView.persist()` en cada
  // jugada, sin acción explícita del alumno) shadowaba el prefill de práctica -- CUALQUIER alumno
  // que progresara más allá de su primera sesión de práctica lo pisaba en silencio. Acá
  // `startedHere=false` modela exactamente esa situación (la sesión restaurada sigue ahí, pero el
  // alumno todavía no tocó "Empezar partida" en ESTE montaje de `PlayApp`): el prefill debe ganar.
  it('con practica en la URL y sin arrancar nada todavía en este montaje: true -- gana el prefill', () => {
    expect(practiceWins(false, conPractica)).toBe(true)
  })

  // El caso que rompía si `practiceWins` no tomara `startedHere` en cuenta (hallado en una segunda
  // revisión): el `practica=...` de la URL no se limpia solo, así que sin este freno, el render que
  // sigue a "Empezar partida"/importar un SGF volvería a mostrar el formulario en vez de la partida
  // recién iniciada -- el prefill que destrababa el caso de arriba bloquearía por completo empezar
  // una partida nueva.
  it('con practica en la URL pero YA se arrancó/importó una partida en este montaje: false -- gana la partida nueva', () => {
    expect(practiceWins(true, conPractica)).toBe(false)
  })
})
