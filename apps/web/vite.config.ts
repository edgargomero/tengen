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

export default defineConfig({
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
  ],
})
