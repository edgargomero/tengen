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
          if (!fs.existsSync(file)) return next()
          res.setHeader('Content-Type', 'application/octet-stream')
          fs.createReadStream(file).pipe(res)
        })
      },
    },
  ],
})
