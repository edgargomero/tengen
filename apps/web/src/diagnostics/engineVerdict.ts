// Lectura de la prueba del motor: qué significan las tandas. Puro, con test.
//
// La pregunta que contesta no es "¿va rápido?" sino "¿va SIEMPRE igual?". Un dispositivo lento es un
// problema de presupuesto (menos visitas, o una red más chica); un dispositivo que se va frenando tanda
// a tanda es un problema de memoria, y ahí bajar el presupuesto sólo retrasa el crash en vez de
// evitarlo. Son dos trabajos distintos y muy desiguales en costo, así que conviene separarlos con un
// número y no con una impresión.
import type { EngineProbeResult } from './engineProbe'
import { slowdownRatio } from './engineProbe'

/** Desde acá, la desaceleración deja de ser ruido de medición y pasa a ser una tendencia. Un 1,5× entre
 * la primera y la segunda mitad de tandas idénticas no se explica por varianza. */
export const LEAK_SLOWDOWN_THRESHOLD = 1.5

/** Por debajo de esto, jugar es inviable en la práctica: con 50 visitas por jugada (el preset más bajo)
 * una jugada tardaría más de un minuto. */
export const USABLE_VISITS_PER_SECOND = 1

export interface EngineVerdict {
  /** `null` cuando no hay datos suficientes para afirmar nada. */
  kind: 'leak' | 'slow' | 'ok' | 'failed' | null
  headline: string
  detail: string
}

function meanVps(result: EngineProbeResult): number | null {
  if (result.rounds.length === 0) return null
  const total = result.rounds.reduce((sum, r) => sum + r.visitsPerSecond, 0)
  return Math.round((total / result.rounds.length) * 10) / 10
}

/**
 * El orden de las preguntas es el orden de las consecuencias:
 *
 *  1. ¿Falló? Entonces el resto es irrelevante, y cuántas tandas aguantó ES el dato.
 *  2. ¿Se fue frenando? La fuga gana sobre la lentitud: si algo crece, bajar el presupuesto no lo
 *     arregla — sólo corre el crash más adelante.
 *  3. ¿Es demasiado lento para jugar? Ahí sí la respuesta es presupuesto o red más chica.
 *  4. Si no, el motor sirve en este dispositivo y el problema está en otra parte.
 */
export function judgeEngineProbe(result: EngineProbeResult): EngineVerdict {
  if (!result.modelInOpfs) {
    return {
      kind: null,
      headline: 'Todavía no hay nada que medir',
      detail: result.error ?? 'El modelo no está descargado en este dispositivo.',
    }
  }

  const vps = meanVps(result)
  const ratio = slowdownRatio(result.rounds)

  if (result.error !== undefined) {
    const aguanto =
      result.rounds.length === 0
        ? 'Falló antes de completar la primera tanda.'
        : `Completó ${result.rounds.length} ${result.rounds.length === 1 ? 'tanda' : 'tandas'} antes de fallar.`
    return {
      kind: 'failed',
      headline: 'El motor falló durante la prueba',
      detail: `${aguanto} ${result.error}`,
    }
  }

  if (ratio !== null && ratio >= LEAK_SLOWDOWN_THRESHOLD) {
    return {
      kind: 'leak',
      headline: 'El motor se va frenando con el uso',
      detail:
        `Las últimas tandas tardan ${ratio.toFixed(1)}× más que las primeras, pidiendo exactamente el mismo trabajo. ` +
        'Eso apunta a memoria que crece, no a un dispositivo lento: bajar las visitas retrasaría el crash en vez de evitarlo.',
    }
  }

  if (vps !== null && vps < USABLE_VISITS_PER_SECOND) {
    return {
      kind: 'slow',
      headline: 'El motor funciona, pero es demasiado lento acá',
      detail:
        `${vps} visitas/s de promedio, estables. Con el preset más bajo (50 visitas por jugada) cada jugada ` +
        'tardaría cerca de un minuto. La respuesta es menos presupuesto o una red más chica, no cazar un bug.',
    }
  }

  if (vps === null) {
    return { kind: null, headline: 'Sin tandas completadas', detail: 'La prueba no alcanzó a medir nada.' }
  }

  return {
    kind: 'ok',
    headline: 'El motor funciona a velocidad estable en este dispositivo',
    detail:
      `${vps} visitas/s de promedio${ratio !== null ? `, sin desaceleración (${ratio.toFixed(2)}×)` : ''}. ` +
      'Si aun así crashea jugando, el problema no está en el ritmo de inferencia.',
  }
}

/** Las tandas en texto plano, para que entren en el volcado que se copia y se pega. Cada línea lleva el
 * ACUMULADO de inferencias, que es la variable que separa acumulación de techo: si el aparato muere
 * cerca del mismo acumulado con tandas de 5 y de 20, algo crece; si sólo muere con las grandes, es el
 * pico de una tanda. Sin ese número, comparar dos corridas obliga a sumar a mano. */
export function formatEngineProbe(result: EngineProbeResult): string[] {
  const lines: string[] = []
  if (result.initMs !== undefined) lines.push(`arranque del motor: ${result.initMs} ms`)
  let cumulative = 0
  for (const round of result.rounds) {
    cumulative += round.visits
    lines.push(
      `tanda ${round.round}: ${round.visits} visitas en ${round.ms} ms (${round.visitsPerSecond} visitas/s) · acumulado ${cumulative}`,
    )
  }
  const ratio = slowdownRatio(result.rounds)
  if (ratio !== null) lines.push(`desaceleración última mitad / primera mitad: ${ratio.toFixed(2)}×`)
  if (result.error !== undefined) lines.push(`error: ${result.error}`)
  return lines.length > 0 ? lines : ['(sin datos)']
}
