// Cache en memoria de resultados de análisis por nodo del árbol de la partida (Fase 3a — Modo
// Analizar). Dominio puro, sin dependencia del motor ni de Preact: solo un `Map` con helpers.
//
// La clave es `GameNode.id` (ver gameTree.ts) — monótono desde 0 en la raíz, estable por instancia
// de `GameTree`. Por eso el store se piensa como UN Map fresco por sesión de Analizar: al importar
// un SGF nuevo, `GameTree` reinicia su contador de ids desde 0, así que reusar un store viejo
// colisionaría ids de partidas distintas con el mismo Analysis. Esta clase no sabe nada de eso — el
// consumidor (Task 7, gameReview.ts) es quien llama `clear()` al cargar un SGF nuevo. No hay lógica
// de invalidación ni expiración propia: es un cache de sólo lectura/escritura explícita.
import type { Analysis } from '@tengen/engine'

export class AnalysisStore {
  private readonly byNodeId = new Map<number, Analysis>()

  get(nodeId: number): Analysis | undefined {
    return this.byNodeId.get(nodeId)
  }

  set(nodeId: number, analysis: Analysis): void {
    this.byNodeId.set(nodeId, analysis)
  }

  has(nodeId: number): boolean {
    return this.byNodeId.has(nodeId)
  }

  clear(): void {
    this.byNodeId.clear()
  }
}
