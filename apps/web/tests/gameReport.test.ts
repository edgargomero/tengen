import { describe, expect, it } from 'vitest'
import {
  classifyMoveByRankAndPolicy,
  computeGameReport,
  getMovePhase,
  getPhaseThresholds,
  getPointLossBucket,
  getReportTurningPoints,
  sortMoveReportEntries,
  type MoveReportEntry,
} from '../src/analysis/vendor/web-katrain/gameReport'
import type { AnalysisResult, CandidateMove, GameNode } from '../src/analysis/vendor/web-katrain/types'

const DEFAULT_THRESHOLDS = [12, 6, 3, 1.5, 0.5, 0]

function mkCandidate(x: number, y: number, overrides: Partial<CandidateMove> = {}): CandidateMove {
  return { x, y, winRate: 0.5, scoreLead: 0, visits: 100, pointsLost: 0, order: 0, ...overrides }
}

function mkAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return { rootWinRate: 0.5, rootScoreLead: 0, moves: [], ...overrides }
}

function mkEntry(overrides: Partial<MoveReportEntry> = {}): MoveReportEntry {
  return {
    node: { move: null, parent: null },
    moveNumber: 1,
    player: 'black',
    move: 'D4',
    pointsLost: 0,
    pointsGained: 0,
    scoreBefore: 0,
    scoreAfter: 0,
    scoreDelta: 0,
    scoreSwing: 0,
    winRateBefore: 0.5,
    winRateAfter: 0.5,
    winRateDelta: 0,
    winRateSwing: 0,
    phase: 'opening',
    ...overrides,
  }
}

describe('computeGameReport — moveNumber = depth + 1 (riesgo #1: off-by-one)', () => {
  it('secuencia de 4 jugadas en mainLine (SIN raíz) → moveNumber exacto 1,2,3,4, NUNCA 0,1,2,3', () => {
    const root: GameNode = {
      move: null,
      parent: null,
      analysis: mkAnalysis({ rootScoreLead: 0, moves: [mkCandidate(0, 0)] }),
    }
    const n1: GameNode = {
      move: { x: 0, y: 0, player: 'black' },
      parent: root,
      analysis: mkAnalysis({ rootScoreLead: 1, moves: [mkCandidate(1, 1)] }),
    }
    const n2: GameNode = {
      move: { x: 1, y: 1, player: 'white' },
      parent: n1,
      analysis: mkAnalysis({ rootScoreLead: 0, moves: [mkCandidate(2, 2)] }),
    }
    const n3: GameNode = {
      move: { x: 2, y: 2, player: 'black' },
      parent: n2,
      analysis: mkAnalysis({ rootScoreLead: 2, moves: [mkCandidate(3, 3)] }),
    }
    const n4: GameNode = {
      move: { x: 3, y: 3, player: 'white' },
      parent: n3,
      analysis: mkAnalysis({ rootScoreLead: 1, moves: [mkCandidate(4, 4)] }),
    }
    const mainLine = [n1, n2, n3, n4]

    const report = computeGameReport({ mainLine, boardSize: 19, thresholds: DEFAULT_THRESHOLDS })

    expect(report.moveEntries).toHaveLength(4)
    // Assert exacto, no "algún número": si la implementación usara `depth` en vez de `depth+1`,
    // esto daría [0,1,2,3] y el test fallaría (ver demostración RED/GREEN en el reporte de la tarea).
    expect(report.moveEntries.map((e) => e.moveNumber)).toEqual([1, 2, 3, 4])
  })
})

describe('computeGameReport — signo de pointsLost por color (riesgo #2: crítico)', () => {
  it('Negro pierde puntos (scoreLead baja de 5 a 3) → pointsLost = 2 (>0), pointsGained = 0', () => {
    const root: GameNode = { move: null, parent: null, analysis: mkAnalysis({ rootScoreLead: 5, moves: [mkCandidate(9, 9)] }) }
    const black: GameNode = {
      move: { x: 3, y: 3, player: 'black' },
      parent: root,
      analysis: mkAnalysis({ rootScoreLead: 3, moves: [mkCandidate(9, 9)] }),
    }
    const report = computeGameReport({ mainLine: [black], boardSize: 19, thresholds: DEFAULT_THRESHOLDS })

    expect(report.moveEntries).toHaveLength(1)
    expect(report.moveEntries[0]!.pointsLost).toBe(2)
    expect(report.moveEntries[0]!.pointsGained).toBe(0)
  })

  it('Blanco pierde puntos (scoreLead, perspectiva Negro, sube de -5 a -3) → pointsLost = 2 (>0) con el signo ya corregido internamente, pointsGained = 0', () => {
    const root: GameNode = { move: null, parent: null, analysis: mkAnalysis({ rootScoreLead: -5, moves: [mkCandidate(9, 9)] }) }
    const white: GameNode = {
      move: { x: 3, y: 3, player: 'white' },
      parent: root,
      analysis: mkAnalysis({ rootScoreLead: -3, moves: [mkCandidate(9, 9)] }),
    }
    const report = computeGameReport({ mainLine: [white], boardSize: 19, thresholds: DEFAULT_THRESHOLDS })

    expect(report.moveEntries).toHaveLength(1)
    expect(report.moveEntries[0]!.pointsLost).toBe(2)
    expect(report.moveEntries[0]!.pointsGained).toBe(0)
  })
})

describe('computeGameReport — histograma y stats por jugador', () => {
  it('pointsLost=2 con thresholds por defecto cae en el bucket índice 3 (>= 1.5); stats.black no vacío', () => {
    const root: GameNode = { move: null, parent: null, analysis: mkAnalysis({ rootScoreLead: 5, moves: [mkCandidate(9, 9)] }) }
    const black: GameNode = {
      move: { x: 3, y: 3, player: 'black' },
      parent: root,
      analysis: mkAnalysis({ rootScoreLead: 3, moves: [mkCandidate(9, 9)] }),
    }
    const report = computeGameReport({ mainLine: [black], boardSize: 19, thresholds: DEFAULT_THRESHOLDS })

    expect(report.histogram[3]!.black).toBe(1)
    expect(report.histogram[3]!.white).toBe(0)
    expect(report.stats.black.numMoves).toBe(1)
    expect(report.stats.white.numMoves).toBe(0)
  })
})

describe('computeGameReport — nodo con .analysis ausente en sí mismo se omite sin lanzar; el resto de la secuencia sigue procesándose', () => {
  it('n2 sin analysis propia bloquea su propia entrada Y la de n3 (que depende de n2 como padre); n4 (que depende de n3, válido) sí obtiene entrada', () => {
    const root: GameNode = { move: null, parent: null, analysis: mkAnalysis({ rootScoreLead: 0, moves: [mkCandidate(9, 9)] }) }
    const n1: GameNode = { move: { x: 0, y: 0, player: 'black' }, parent: root, analysis: mkAnalysis({ rootScoreLead: 1, moves: [mkCandidate(9, 9)] }) }
    const n2: GameNode = { move: { x: 1, y: 1, player: 'white' }, parent: n1, analysis: undefined }
    const n3: GameNode = { move: { x: 2, y: 2, player: 'black' }, parent: n2, analysis: mkAnalysis({ rootScoreLead: 2, moves: [mkCandidate(9, 9)] }) }
    const n4: GameNode = { move: { x: 3, y: 3, player: 'white' }, parent: n3, analysis: mkAnalysis({ rootScoreLead: 1, moves: [mkCandidate(9, 9)] }) }
    const mainLine = [n1, n2, n3, n4]

    let report: ReturnType<typeof computeGameReport> | undefined
    expect(() => {
      report = computeGameReport({ mainLine, boardSize: 19, thresholds: DEFAULT_THRESHOLDS })
    }).not.toThrow()

    expect(report!.moveEntries).toHaveLength(2)
    expect(report!.moveEntries.map((e) => e.moveNumber)).toEqual([1, 4])
    // movesInFilter cuenta los 4 (pasan el filtro de fase/profundidad) aunque solo 2 lleguen a moveEntries.
    expect(report!.movesInFilter).toBe(4)
  })
})

describe('computeGameReport — mainLine[0].parent (contrato con Task 5: cadena hacia la raíz sintética)', () => {
  it('parent con .analysis presente → la primera entrada se computa (usa el punto de partida)', () => {
    const rootPresent: GameNode = { move: null, parent: null, analysis: mkAnalysis({ rootScoreLead: 4, moves: [mkCandidate(9, 9)] }) }
    const first: GameNode = {
      move: { x: 0, y: 0, player: 'black' },
      parent: rootPresent,
      analysis: mkAnalysis({ rootScoreLead: 4, moves: [mkCandidate(9, 9)] }),
    }
    const report = computeGameReport({ mainLine: [first], boardSize: 19, thresholds: DEFAULT_THRESHOLDS })

    expect(report.moveEntries).toHaveLength(1)
    expect(report.moveEntries[0]!.pointsLost).toBe(0)
  })

  it('parent con .analysis ausente → la primera entrada se omite sin lanzar (mismo comportamiento que el resto del array)', () => {
    const rootAbsent: GameNode = { move: null, parent: null, analysis: undefined }
    const first: GameNode = {
      move: { x: 0, y: 0, player: 'black' },
      parent: rootAbsent,
      analysis: mkAnalysis({ rootScoreLead: 4, moves: [mkCandidate(9, 9)] }),
    }

    let report: ReturnType<typeof computeGameReport> | undefined
    expect(() => {
      report = computeGameReport({ mainLine: [first], boardSize: 19, thresholds: DEFAULT_THRESHOLDS })
    }).not.toThrow()

    expect(report!.moveEntries).toHaveLength(0)
    expect(report!.movesInFilter).toBe(1)
  })
})

describe('classifyMoveByRankAndPolicy', () => {
  it('rank=1 → aiMove (corto-circuito, ignora relativePrior)', () => {
    expect(classifyMoveByRankAndPolicy(1, 0.01)).toBe('aiMove')
  })

  it('rank=2 (<=3), relativePrior=0.6 (>=0.5) — ambos señales "good" → good', () => {
    expect(classifyMoveByRankAndPolicy(2, 0.6)).toBe('good')
  })

  it('rank=5 (<=10), relativePrior=0.15 (>=0.1) — ambas señales "inaccuracy" → inaccuracy', () => {
    expect(classifyMoveByRankAndPolicy(5, 0.15)).toBe('inaccuracy')
  })

  it('rank=15 (<=20), relativePrior=0.05 (>=0.02) — ambas señales "mistake" → mistake', () => {
    expect(classifyMoveByRankAndPolicy(15, 0.05)).toBe('mistake')
  })

  it('rank=25 (>20), relativePrior=0.001 (<0.02) — ambas señales "blunder" → blunder', () => {
    expect(classifyMoveByRankAndPolicy(25, 0.001)).toBe('blunder')
  })

  it('rank=0 (sin candidato) → blunder (con relativePrior también bajo, para que Math.min no elija la señal de prior)', () => {
    expect(classifyMoveByRankAndPolicy(0, 0.001)).toBe('blunder')
  })

  it('CRUCE en desacuerdo — rank sugiere "good" (rank=2) pero relativePrior sugiere "blunder" (0.001): el código' +
    ' real (Math.min(rankIndex, priorIndex) sobre MOVE_POLICY_CATEGORIES ordenado mejor→peor) toma el índice MÁS BAJO,' +
    ' es decir la categoría MENOS severa ("good"), NO la más severa. Verbatim del vendor — ver nota de discrepancia' +
    ' en la cabecera del archivo portado (la prosa del brief de la tarea decía lo contrario; el código manda).', () => {
    expect(classifyMoveByRankAndPolicy(2, 0.001)).toBe('good')
  })
})

describe('sortMoveReportEntries', () => {
  it("'loss' ordena por pointsLost desc; empate se rompe por moveNumber asc", () => {
    const entries = [
      mkEntry({ moveNumber: 1, pointsLost: 2 }),
      mkEntry({ moveNumber: 2, pointsLost: 5 }),
      mkEntry({ moveNumber: 3, pointsLost: 5 }),
    ]
    const sorted = sortMoveReportEntries(entries, 'loss')
    expect(sorted.map((e) => e.moveNumber)).toEqual([2, 3, 1])
  })

  it("'policy' ordena por severidad de categoría desc, con desempate relativePrior asc → rank desc → pointsLost desc → moveNumber asc", () => {
    const entryGood: MoveReportEntry = mkEntry({
      moveNumber: 1,
      pointsLost: 0,
      policy: { rank: 2, playedPrior: 0.6, topPrior: 1, relativePrior: 0.6, category: 'good' },
    })
    const entryBlunderHighRank: MoveReportEntry = mkEntry({
      moveNumber: 2,
      pointsLost: 10,
      policy: { rank: 25, playedPrior: 0.001, topPrior: 1, relativePrior: 0.001, category: 'blunder' },
    })
    const entryBlunderLowRank: MoveReportEntry = mkEntry({
      moveNumber: 3,
      pointsLost: 3,
      policy: { rank: 0, playedPrior: 0.001, topPrior: 1, relativePrior: 0.001, category: 'blunder' },
    })
    const sorted = sortMoveReportEntries([entryGood, entryBlunderHighRank, entryBlunderLowRank], 'policy')
    // Ambos blunder empatan en severidad y relativePrior; el desempate por rank desc pone rank=25 antes que rank=0.
    // 'good' (menos severo) siempre al final.
    expect(sorted.map((e) => e.moveNumber)).toEqual([2, 3, 1])
  })
})

describe('getReportTurningPoints', () => {
  it('filtra por scoreSwing >= threshold (default 5), ordena desc, corta a limit (default 5) con más de 5 candidatos', () => {
    const entries = [
      mkEntry({ moveNumber: 1, scoreSwing: 3 }), // < 5, excluido
      mkEntry({ moveNumber: 2, scoreSwing: 20 }),
      mkEntry({ moveNumber: 3, scoreSwing: 5 }), // exactamente el umbral, incluido (>=)
      mkEntry({ moveNumber: 4, scoreSwing: 15 }),
      mkEntry({ moveNumber: 5, scoreSwing: 10 }),
      mkEntry({ moveNumber: 6, scoreSwing: 8 }),
      mkEntry({ moveNumber: 7, scoreSwing: 6 }),
      mkEntry({ moveNumber: 8, scoreSwing: 25 }),
    ]
    const turningPoints = getReportTurningPoints(entries)

    expect(turningPoints).toHaveLength(5)
    // 7 candidatos califican (>=5); ordenados desc por swing: 8(25),2(20),4(15),5(10),6(8),7(6),3(5).
    // El corte a 5 deja fuera a 7 y 3 — verifica el corte real, no solo el filtro.
    expect(turningPoints.map((e) => e.moveNumber)).toEqual([8, 2, 4, 5, 6])
  })
})

describe('getPhaseThresholds / getMovePhase — bordes conocidos (9×9 exacto del código fuente)', () => {
  it('9×9 → openingEnd=15, middleEnd=40 (KAYA_PHASE_THRESHOLDS)', () => {
    expect(getPhaseThresholds(9)).toEqual({ openingEnd: 15, middleEnd: 40 })
  })

  it('moveNumber=15 (borde opening) → opening; 16 → middleGame; 40 (borde middle) → middleGame; 41 → endgame', () => {
    expect(getMovePhase(15, 9)).toBe('opening')
    expect(getMovePhase(16, 9)).toBe('middleGame')
    expect(getMovePhase(40, 9)).toBe('middleGame')
    expect(getMovePhase(41, 9)).toBe('endgame')
  })
})

describe('getPointLossBucket', () => {
  it('pointsLost exactamente en el umbral (6) con thresholds por defecto → índice 1 (borde, no estrictamente menor)', () => {
    expect(getPointLossBucket(6, DEFAULT_THRESHOLDS)).toBe(1)
  })
})
