/** Re-export del PRNG determinista, ahora en `src/rng.ts` (promovido para uso desde prod). Se mantiene
 *  este punto de entrada `testutil/rng.ts` para no romper los imports existentes de los tests. */
export { mulberry32 } from '../rng'
