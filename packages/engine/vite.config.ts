import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vite'

const modelsDir = path.resolve(import.meta.dirname ?? '.', 'models')

// onnxruntime-web puede vivir hoisteado en la raíz del monorepo en vez de
// packages/engine/node_modules — se resuelve con Node en vez de asumir una
// ruta relativa fija. dist/ contiene los .wasm/.mjs que ort carga en runtime
// vía import() dinámico (ver middleware serve-ort-dist más abajo).
const ortDist = path.dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))

const ORT_DIST_CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
}

// COOP/COEP habilitan crossOriginIsolated → WASM multihilo medible.
// WebGPU no los necesita, pero no le estorban.
export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  publicDir: 'public',
  // models/ pesa cientos de MB: se sirve como estático adicional
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
          // No existe como archivo (p.ej. es el propio directorio models/): seguir la cadena.
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
        // onnxruntime-web hace `import()` dinámico de sus .mjs (p.ej.
        // ort-wasm-simd-threaded.jsep.mjs) desde `ort.env.wasm.wasmPaths`.
        // Vite dev NO sirve archivos de public/ cuando se piden como import
        // de módulo JS (query `?import`), así que copiarlos a public/ no
        // funciona en dev: hace falta este middleware dedicado.
        server.middlewares.use('/ort-dist', (req, res, next) => {
          // Las requests llegan como ".../ort-wasm-simd-threaded.jsep.mjs?import".
          const urlPath = req.url!.split('?')[0]
          const file = path.resolve(ortDist, decodeURIComponent(urlPath.replace(/^\//, '')))
          // Protección contra path traversal: el path resuelto debe seguir dentro de dist/.
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
