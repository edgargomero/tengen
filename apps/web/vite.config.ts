// Config de Vite de apps/web. Portado de packages/engine/vite.config.ts (archivo propio de tengen).
// - JSX de Preact vía esbuild (runtime automático); sin @preact/preset-vite (Fase 0 no necesita HMR de
//   componentes; se puede añadir en Fase 2).
// - serve-models (dev): sirve /models/ desde packages/engine/models/ (donde están los .onnx convertidos),
//   sin duplicar bytes ni committear modelos.
// - serve-ort-dist (dev, OBLIGATORIO): onnxruntime-web hace import() dinámico de sus .mjs desde
//   ort.env.wasm.wasmPaths='/ort-dist/'. Vite dev NO sirve archivos de public/ pedidos como import de
//   módulo, así que hace falta este middleware; y el .mjs cargado como script de worker bajo
//   crossOriginIsolated DEBE llegar con COEP: require-corp por-archivo o Chrome lo bloquea.
// COOP/COEP a nivel server habilitan crossOriginIsolated (WASM multihilo); WebGPU no los necesita pero
// no estorban.
// resolve.conditions (OBLIGATORIO, ver Fase 4 "Hallazgo crítico #2"): sin esto, `import * as ort from
// 'onnxruntime-web'` resuelve a la variante `ort.bundle.min.mjs`, que trae un `new URL(archivo.wasm,
// import.meta.url)` interno. Vite bundlea ESE patrón siempre que aparece en el texto, sin analizar si la
// rama se ejecuta — y como session.ts fija wasmPaths='/ort-dist/' antes de crear cualquier sesión, esa
// rama nunca corre: el resultado es una copia hasheada de 26.8 MB en dist/assets/ que nadie fetchea nunca,
// y que excede el límite de 25 MiB por archivo de Cloudflare Workers Static Assets. La condición
// 'onnxruntime-web-use-extern-wasm' (export condition oficial del propio paquete) resuelve en cambio a
// `ort.min.mjs`, que no trae ese new URL() embebido — wasmPaths sigue funcionando exactamente igual.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'

const rootDir = import.meta.dirname ?? '.'
const modelsDir = path.resolve(rootDir, '../../packages/engine/models')

// onnxruntime-web puede vivir hoisteado en la raíz del monorepo; se resuelve con Node.
const ortDist = path.dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))

const ORT_DIST_CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
}

// Variante que la app pide en runtime bajo ep:'webgpu' (confirmado en navegador real —
// ver "Hallazgo crítico" del plan de Fase 4). Solo esta variante, no las otras 3 de
// onnxruntime-web (asyncify/jspi/plain) — ninguna otra vía de EP está configurada en la app
// (`apps/web/src/appFactory.ts` hardcodea `ep: 'webgpu'`).
const ORT_DIST_PROD_FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']

export default defineConfig({
  resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [
    {
      name: 'serve-models',
      configureServer(server) {
        server.middlewares.use('/models', (req, res, next) => {
          const file = path.resolve(modelsDir, decodeURIComponent(req.url!.replace(/^\//, '')))
          // Protección contra path traversal: el path resuelto debe seguir dentro de models/.
          if (file !== modelsDir && !file.startsWith(modelsDir + path.sep)) return next()
          let st: fs.Stats
          try {
            st = fs.statSync(file)
          } catch {
            return next()
          }
          if (!st.isFile()) return next()
          res.setHeader('Content-Type', 'application/octet-stream')
          res.setHeader('Content-Length', String(st.size))
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          fs.createReadStream(file)
            .on('error', (err) => res.destroy(err))
            .pipe(res)
        })
        server.middlewares.use('/ort-dist', (req, res, next) => {
          // Las requests llegan como ".../ort-wasm-simd-threaded.jsep.mjs?import".
          const urlPath = req.url!.split('?')[0]
          const file = path.resolve(ortDist, decodeURIComponent(urlPath.replace(/^\//, '')))
          if (file !== ortDist && !file.startsWith(ortDist + path.sep)) return next()
          let st: fs.Stats
          try {
            st = fs.statSync(file)
          } catch {
            return next()
          }
          if (!st.isFile()) return next()
          const contentType = ORT_DIST_CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream'
          res.setHeader('Content-Type', contentType)
          res.setHeader('Content-Length', String(st.size))
          // ORT multihilo carga este .mjs como script de un dedicated worker; bajo crossOriginIsolated el
          // worker hereda COEP y su script debe llegar con este header o Chrome lo bloquea. Los headers de
          // `server.headers` no aplican a middlewares propios.
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          fs.createReadStream(file)
            .on('error', (err) => res.destroy(err))
            .pipe(res)
        })
      },
    },
    {
      // Copia el par jsep de onnxruntime-web a dist/ort-dist/ DESPUÉS del build — replica en
      // build-time lo que serve-ort-dist hace en request-time (dev). Sin esto, `session.ts`
      // (`packages/engine`) pide `/ort-dist/ort-wasm-simd-threaded.jsep.mjs` en producción y esa
      // ruta no existe: el motor no inicializa (ver "Hallazgo crítico" del plan de Fase 4).
      name: 'copy-ort-dist-prod',
      closeBundle() {
        const outDir = path.resolve(rootDir, 'dist/ort-dist')
        fs.mkdirSync(outDir, { recursive: true })
        for (const file of ORT_DIST_PROD_FILES) {
          fs.copyFileSync(path.resolve(ortDist, file), path.resolve(outDir, file))
        }
      },
    },
  ],
})
