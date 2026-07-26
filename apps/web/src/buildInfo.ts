// Identificador del build, inyectado por Vite (`define` en `vite.config.ts`: SHA corto de git + fecha
// UTC del build, más `+local` si el árbol tenía cambios sin commitear).
//
// Por qué existe: sin poder VER qué versión corre un dispositivo, un reporte de "me pasa algo raro" es
// indepurable — no hay forma de saber si el aparato ya recibió la corrección de la que estamos
// hablando. Se muestra en el pie del menú y viaja en el volcado de `/diagnostico`.
//
// El `typeof` no es decoración. `vite build` reemplaza el identificador por su literal (verificado en
// `dist/assets/index-*.js`), pero el dev server NO aplica el `define` a este módulo (verificado pidiendo
// `/src/buildInfo.ts` al server: llega sin reemplazar) y Vitest corre sin `define` en absoluto. Un
// identificador libre sólo se puede consultar con `typeof` sin lanzar `ReferenceError`, así que esta es
// la única forma de leerlo que funciona en los tres entornos.
//
// Consecuencia deseable, no defecto: en desarrollo y en los tests el valor es `'dev'`, que es exactamente
// lo que corresponde decir ahí — no hay ningún build desplegado del que hablar.
declare const __BUILD_ID__: string | undefined

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
