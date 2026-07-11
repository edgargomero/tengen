// Cache en memoria de resultados de análisis por nodo del árbol de la partida (Fase 3a — Modo
// Analizar). Dominio puro, sin dependencia del motor ni de Preact: solo un `Map` con helpers.
//
// La clave es `GameNode.id` (ver gameTree.ts) — monótono desde 0 en la raíz, estable por instancia
// de `GameTree`. Por eso el store se piensa como UN Map fresco por sesión de Analizar: al importar
// un SGF nuevo, `GameTree` reinicia su contador de ids desde 0, así que reusar un store viejo
// colisionaría ids de partidas distintas con el mismo Analysis. Esta clase no sabe nada de eso — hoy
// el reset entre sesiones lo logra `ReadyAnalyzeView` (AnalyzeView.tsx) construyendo una instancia
// FRESCA de `AnalysisStore` en cada remount (mismo patrón que `EngineManager`/`ReviewScheduler`/
// `GameReview`, todos `useRef` inicializado una vez por montaje), nunca llamando a `clear()` — nada en
// el codebase invoca ese método hoy. `clear()` se mantiene igual como una operación barata y
// razonable de este wrapper de cache, disponible para un futuro caller que necesite resetear el
// estado SIN forzar un remount completo (p.ej. un botón "reanalizar desde cero" sobre la misma
// sesión). No hay lógica de invalidación ni expiración propia: es un cache de sólo lectura/escritura
// explícita.
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
