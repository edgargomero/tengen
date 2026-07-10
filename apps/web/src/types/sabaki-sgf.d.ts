// Declaración de módulo para `@sabaki/sgf@3.5.0` (no trae `.d.ts` propios).
//
// El paquete es CommonJS y expone su API vía `Object.assign(exports, {parse, stringify}, ...)`.
// Bajo Node ESM nativo los named imports NO resuelven (solo el `default`), mientras que bajo
// Vitest/Vite sí; para portar entre ambos + el build de browser se usa SIEMPRE el import por
// defecto: `import sgf from '@sabaki/sgf'` → objeto con `parse`/`stringify`. Por eso aquí el
// módulo se declara con un `default` que es ese objeto, y `SgfNode` como named type-export.
declare module '@sabaki/sgf' {
  /**
   * Nodo del árbol SGF tal como lo produce `parse` y lo consume `stringify`. `stringify` solo
   * lee `data` + `children` (verificado en el fuente), así que `id`/`parentId` son opcionales:
   * `parse` los rellena, pero al construir nodos para exportar no hace falta ponerlos.
   */
  export interface SgfNode {
    id?: number | string | null
    /** Propiedades SGF: clave = identificador (`B`, `W`, `AB`, `SZ`…), valor = lista de valores crudos. */
    data: Record<string, string[]>
    parentId?: number | string | null
    children: SgfNode[]
  }

  interface SgfModule {
    /** Parsea una cadena SGF a su bosque de nodos raíz (un juego = un elemento). */
    parse(sgf: string, options?: object): SgfNode[]
    /** Serializa un nodo (o array de nodos raíz) a cadena SGF. */
    stringify(node: SgfNode | SgfNode[], options?: object): string
  }

  const sgf: SgfModule
  export default sgf
}
