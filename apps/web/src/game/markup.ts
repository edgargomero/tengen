// Lógica pura de colocación de marcas del editor de repaso (Fase 1). Vive fuera del componente para
// ser testeable de forma determinista — el toggle/reemplazo y el auto-incremento de etiquetas son la
// parte con más casos de borde de la feature. `AnalyzeView` solo cablea estas funciones al tablero.
import type { Markup, MarkupType } from './gameTree'

/** Próxima letra A–Z no usada por las marcas `label` de `markup` (excluyendo el índice `exceptIdx`,
 * útil al REEMPLAZAR una marca existente). Fallback a 'A' si ya se usaron las 26 (irreal en una
 * posición real). Fase 1: las etiquetas son letras auto-generadas, no texto libre. */
export function nextLabelLetter(markup: readonly Markup[], exceptIdx: number): string {
  const used = new Set<string>()
  markup.forEach((m, i) => {
    if (i !== exceptIdx && m.type === 'label' && m.label !== undefined) used.add(m.label)
  })
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    if (!used.has(letter)) return letter
  }
  return 'A'
}

/**
 * Aplica una marca de `type` en `vertex` sobre `markup`, devolviendo el NUEVO array (no muta el de
 * entrada). Reglas (≤1 marca por vértice, para que Shudan —que pinta un marker por casilla— nunca
 * quede ambiguo):
 *   - misma casilla + mismo tipo → toggle-off (quita la marca);
 *   - misma casilla + otro tipo  → reemplaza el tipo;
 *   - casilla vacía              → agrega la marca.
 * Las etiquetas toman la próxima letra libre del nodo (`nextLabelLetter`).
 */
export function applyMarkToggle(
  markup: readonly Markup[],
  vertex: { x: number; y: number },
  type: MarkupType,
): Markup[] {
  const next = [...markup]
  const idx = next.findIndex((m) => m.vertex.x === vertex.x && m.vertex.y === vertex.y)
  if (idx >= 0 && next[idx]!.type === type) {
    next.splice(idx, 1) // toggle-off
  } else {
    const mark: Markup = type === 'label' ? { type, vertex, label: nextLabelLetter(next, idx) } : { type, vertex }
    if (idx >= 0) next[idx] = mark // reemplaza (otro tipo en la misma casilla)
    else next.push(mark)
  }
  return next
}
