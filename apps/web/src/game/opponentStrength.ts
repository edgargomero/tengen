// Etiquetas de fuerza amigables para el oponente KataGo. El usuario elige "visitas" de MCTS (jerga
// que no le dice nada); aquí las traducimos a "Fuerza baja/media/alta". Único origen de verdad,
// compartido por el dropdown de nueva partida (NewGameForm) y la etiqueta del oponente durante la
// partida + nombre del SGF exportado (PlayView). El `value` real que consume el motor sigue siendo
// el número de visitas; estas etiquetas son puramente presentacionales.

/** Presets ofrecidos en el dropdown de "Modo Jugar". Orden ascendente de fuerza (= de visitas). */
export const KATA_STRENGTH_PRESETS = [
  { visits: 50, label: 'Fuerza baja' },
  { visits: 200, label: 'Fuerza media' },
  { visits: 500, label: 'Fuerza alta' },
] as const

/**
 * Etiqueta de fuerza para un número de visitas arbitrario. No asume que `visits` sea uno de los 3
 * presets: partidas guardadas (D1) o el clamp de `validateConfig` (`visits < 1 → 1`, sin techo)
 * pueden traer cualquier valor, así que bucketizamos por cercanía al preset más próximo (equivale
 * a partir por los puntos medios: 125 entre baja↔media, 350 entre media↔alta). 50/200/500 devuelven
 * su etiqueta exacta.
 */
export function kataStrengthLabel(visits: number): string {
  return KATA_STRENGTH_PRESETS.reduce((best, p) =>
    Math.abs(visits - p.visits) < Math.abs(visits - best.visits) ? p : best,
  ).label
}
