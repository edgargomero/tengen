// Construcción del snapshot de guardado (Fase 5), extraída como función PURA para que la regla
// "no reescribir el nombre de una partida reabierta" tenga un test de regresión real — el repo no
// testea UI (PlayView/AnalyzeView no tienen test propio), así que esta lógica viviendo inline en
// esos componentes quedaba sin cobertura (bug real ya corregido una vez, ver f9c8130).
import type { GameSnapshot } from './api'

/** Arma el snapshot final: agrega `name` solo si `reopened` es false. Una partida reabierta
 * (`cloudId` presente desde el montaje) ya tiene su nombre fijado en D1 — sin UI de renombrar en
 * esta fase, cada guardado debe preservarlo, no reescribirlo con uno recién generado. */
export function buildGameSnapshot(
  base: Omit<GameSnapshot, 'name'>,
  name: string,
  reopened: boolean,
): GameSnapshot {
  return reopened ? base : { ...base, name }
}
