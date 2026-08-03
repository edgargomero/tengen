/// <reference lib="webworker" />
// Service worker de tengen (modo `injectManifest` de vite-plugin-pwa: este archivo es NUESTRO, y
// Workbox solo inyecta la lista de assets con sus revisiones en `self.__WB_MANIFEST`).
//
// Por qué escrito a mano y no `generateSW`: tengen tiene tres restricciones que una config genérica
// no cubre, y las tres romperían algo si se manejaran mal.
//
//   1. `/models/*` NO se cachea NUNCA. Los ONNX (fp32: 115,8 MB b18 + 108,0 MB humanv0; mixtos:
//      58,1 y 54,2 MB) ya viven en OPFS, gestionados por `modelCache.ts` con validación de bytes y
//      marcador de completitud. Dejar que el service worker los cachee duplicaría todo eso en el
//      dispositivo y crearía una segunda copia sin las garantías de integridad de la primera —
//      justamente en los móviles, que son los que ya andan cortos de cuota. Van a red y punto.
//      La ruta se filtra por PREFIJO, así que no hay que tocarla al agregar variantes.
//   2. `/api/*` NO se cachea NUNCA. Sesión, partidas en D1 y backup a Drive son estado del servidor;
//      servir una respuesta vieja de `/api/auth/get-session` mostraría al usuario logueado cuando no
//      lo está. Sin red, fallan — y la app ya degrada bien ante eso (verificado: renderiza y ofrece
//      "Iniciar sesión", cero errores no manejados).
//   3. El aislamiento cross-origin es OBLIGATORIO. La app corre con COOP `same-origin` + COEP
//      `require-corp` porque onnxruntime-web levanta 8 hilos sobre `SharedArrayBuffer`. Las respuestas
//      que sirve el SW deben conservar esos headers; la Cache API los preserva porque guarda el
//      `Response` completo, así que la regla es NUNCA construir respuestas sintéticas para documentos
//      ni para `/ort-dist/*`, solo devolver lo cacheado tal cual vino de la red.
//
// Estrategia por tipo de recurso (una decisión explícita por cada uno, sin defaults escondidos):
//   · Navegaciones  → el `index.html` precacheado (la SPA rutea del lado del cliente).
//   · Shell (JS/CSS/WASM/imágenes) → precache con revisión; se sirven de caché sin tocar la red.
//   · `/models/*` y `/api/*` → NetworkOnly explícito.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkOnly } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

// Precache del shell: Workbox inyecta acá la lista con revisiones (ver `injectManifest` en
// vite.config.ts). Incluye el WASM de ORT (25.5 MB en disco, 5.3 MB por brotli), que es el 90% del
// peso y la razón por la que hoy la app no arranca sin red.
precacheAndRoute(self.__WB_MANIFEST)

// Borra los precaches de despliegues anteriores. Sin esto, cada deploy dejaría una copia completa
// del shell —WASM incluido— acumulándose en el disco del usuario.
cleanupOutdatedCaches()

// NetworkOnly ANTES de la ruta de navegación: el orden de registro importa en Workbox (gana la
// primera que matchea), y estas dos nunca deben caer en el fallback del `index.html`.
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly())
registerRoute(({ url }) => url.pathname.startsWith('/models/'), new NetworkOnly())

// Cualquier navegación (`/`, `/jugar`, `/analizar`, `/partidas`) se resuelve con el index precacheado
// — el mismo contrato que `not_found_handling: single-page-application` del Worker, pero sin red.
// `denylist` evita secuestrar rutas que NO son de la SPA.
//
// `/diagnostico` está en la denylist Y ES DELIBERADO, contra la regla general de este archivo. El
// problema: servir el `index.html` precacheado significa cargar el JS del shell VIEJO, y una pantalla de
// diagnóstico que no existe en ese bundle se manifiesta como "abrí /diagnostico y me mostró la app
// normal" — indistinguible de una función rota. Es la trampa exacta que este plan de fases intenta
// evitar, y aparece de nuevo en CADA iteración futura del diagnóstico: la herramienta con la que se
// depura un dispositivo nunca debe llegar en una versión anterior a la que se está depurando.
//
// El costo es que el diagnóstico deja de abrir sin conexión. Es el intercambio correcto: lo que reporta
// (WebGPU, cuota, modelos en OPFS) se mide en el dispositivo, pero el escenario real es "algo no
// funciona y quiero saber qué", no "quiero diagnosticar en un avión".
//
// Lo que esto NO arregla: la denylist recién rige cuando el service worker nuevo está activo, así que la
// PRIMERA visita a /diagnostico desde un dispositivo con el shell viejo sigue cayendo en el shell viejo.
// Para esa vez hay que aceptar el aviso de "versión nueva" antes de navegar.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/models\//, /^\/cdn-cgi\//, /^\/diagnostico$/],
  }),
)

// Actualización NO destructiva: el SW nuevo espera. Nunca hace `skipWaiting()` por su cuenta porque
// activar un shell nuevo mientras alguien está a mitad de una partida le recargaría la página. Es la
// app la que decide cuándo (`registerSW.ts` pide confirmación al usuario y recién ahí manda esto).
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
