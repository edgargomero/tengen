import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

const modelsDir = path.resolve(import.meta.dirname ?? '.', 'models')

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
      },
    },
  ],
})
