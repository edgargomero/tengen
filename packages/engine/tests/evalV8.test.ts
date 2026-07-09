import { describe, expect, it } from 'vitest'
import { postprocessKataGoV8 } from '../src/vendor/web-katrain/evalV8'
import { expectedWhiteScoreValue } from '../src/vendor/web-katrain/scoreValue'

describe('postprocessKataGoV8', () => {
  it('value logits iguales → win 0.5; score con multiplicadores por defecto (20)', () => {
    const r = postprocessKataGoV8({
      nextPlayer: 'black',
      valueLogits: [0, 0, -50], // win=loss, noResult≈0
      scoreValue: [0.5, -10, 0.5, 0], // scoreMean=0.5·20=10, stdev=softplus(-10)·20≈0, lead=10
    })
    expect(r.blackWinProb).toBeCloseTo(0.5, 3)
    expect(r.blackNoResultProb).toBeCloseTo(0, 3)
    expect(r.blackScoreMean).toBeCloseTo(10, 1)
    expect(r.blackScoreLead).toBeCloseTo(10, 1)
  })

  it('perspectiva: con nextPlayer=white se niega el lead y se intercambia win/loss', () => {
    const asBlack = postprocessKataGoV8({
      nextPlayer: 'black',
      valueLogits: [2, 0, -50],
      scoreValue: [0.5, -10, 0.5, 0],
    })
    const asWhite = postprocessKataGoV8({
      nextPlayer: 'white',
      valueLogits: [2, 0, -50],
      scoreValue: [0.5, -10, 0.5, 0],
    })
    expect(asWhite.blackWinProb).toBeCloseTo(1 - asBlack.blackWinProb, 5)
    expect(asWhite.blackScoreLead).toBeCloseTo(-asBlack.blackScoreLead, 3)
  })
})

// La tabla de utilidad de score (expectedWhiteScoreValue/initScoreValueTables) fue desacoplada
// del board-size mutable global de fastBoard.ts (BOARD_AREA/BOARD_SIZE) a un parámetro explícito
// `boardSize` (Task 7). Estos tests verifican tanto la matemática (invariantes de la función de
// utilidad) como que el cacheo de la tabla quedó keyeado por ese parámetro y no por un global.
describe('expectedWhiteScoreValue', () => {
  const base = { center: 0, scale: 2.0, boardSize: 19, sqrtBoardArea: 19 }

  it('whiteScoreMean muy positivo (blanco fuertemente favorecido) → valor cerca del máximo (~1)', () => {
    const v = expectedWhiteScoreValue({ ...base, whiteScoreMean: 300, whiteScoreStdev: 1 })
    expect(v).toBeGreaterThan(0.9)
    expect(v).toBeLessThanOrEqual(1)
  })

  it('whiteScoreMean muy negativo → valor cerca del mínimo (~-1)', () => {
    const v = expectedWhiteScoreValue({ ...base, whiteScoreMean: -300, whiteScoreStdev: 1 })
    expect(v).toBeLessThan(-0.9)
    expect(v).toBeGreaterThanOrEqual(-1)
  })

  it('whiteScoreMean = 0 → valor neutral (≈0)', () => {
    const v = expectedWhiteScoreValue({ ...base, whiteScoreMean: 0, whiteScoreStdev: 1 })
    expect(v).toBeCloseTo(0, 2)
  })

  it('monotonía: el valor crece con whiteScoreMean a stdev fija', () => {
    const means = [-20, -10, -5, 0, 5, 10, 20]
    const values = means.map((whiteScoreMean) =>
      expectedWhiteScoreValue({ ...base, whiteScoreMean, whiteScoreStdev: 3 }),
    )
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!)
    }
  })

  it('re-keying del cache por boardSize: un mismo lead vale distinto en 19 vs 9, y volver a 19 no queda corrupto', () => {
    // `sqrtBoardArea` se deja FIJO a propósito en las tres llamadas: si variara junto con
    // `boardSize` (p.ej. 19/19 vs 9/9), la diferencia entre v19 y v9 podría venir solo de
    // `sqrtBoardArea` (que entra directo en `scaleFactor`) y no probaría nada sobre el cacheo
    // de la tabla en sí — sería una aserción tautológica. Aislar `boardSize` como única
    // variable fuerza a que la diferencia provenga de que la tabla (`svTableBoardSize`,
    // construida en `initScoreValueTables`) realmente se recalculó para el tamaño nuevo.
    const shared = { whiteScoreMean: 7, whiteScoreStdev: 5, center: 0, scale: 2.0, sqrtBoardArea: 19 }
    const v19a = expectedWhiteScoreValue({ ...shared, boardSize: 19 })
    const v9 = expectedWhiteScoreValue({ ...shared, boardSize: 9 })
    const v19b = expectedWhiteScoreValue({ ...shared, boardSize: 19 })

    expect(v19a).not.toBeCloseTo(v9, 6)
    // Volver a 19 tras pasar por 9 debe dar el mismo valor que la primera vez en 19 (cache no corrupto/no keyeado mal).
    expect(v19b).toBeCloseTo(v19a, 10)
  })
})
