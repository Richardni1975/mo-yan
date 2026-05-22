import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const processNextTickPolyfill = '((...a)=>{queueMicrotask(()=>a[0](...a.slice(1)))})'

function patchProcessNextTickPlugin() {
  const depsDir = path.resolve(__dirname, 'node_modules/.vite/deps')
  // Patterns to patch in any optimized dep file
  const filePatterns = [/simple-peer/, /readable-stream/, /stream-/]

  function patchFile(filePath) {
    if (!fs.existsSync(filePath)) return false
    let content = fs.readFileSync(filePath, 'utf-8')
    const original = content
    content = content.replace(/process\.nextTick/g, processNextTickPolyfill)
    content = content.replace(/\bprocess\.env\b/g, '({})')
    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf-8')
      return true
    }
    return false
  }

  function patchAllDeps() {
    if (!fs.existsSync(depsDir)) return
    let patched = false
    for (const entry of fs.readdirSync(depsDir)) {
      if (!entry.endsWith('.js')) continue
      const filePath = path.join(depsDir, entry)
      if (patchFile(filePath)) patched = true
    }
    if (patched) console.log('[patch-process-nextTick] patched optimized deps')
  }

  return {
    name: 'patch-process-nextTick',
    configureServer(server) {
      // Intercept requests to optimized deps and patch on the fly
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        // Only intercept optimized dependency JS files
        if (url.startsWith('/node_modules/.vite/deps/') && url.endsWith('.js')) {
          const filePath = path.join(depsDir, path.basename(url))
          if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf-8')
            const hasProcessNextTick = content.includes('process.nextTick')
            if (hasProcessNextTick || filePatterns.some(p => p.test(url))) {
              content = content.replace(/process\.nextTick/g, processNextTickPolyfill)
              content = content.replace(/\bprocess\.env\b/g, '({})')
              res.setHeader('Content-Type', 'application/javascript')
              res.setHeader('Content-Length', Buffer.byteLength(content, 'utf-8'))
              res.end(content)
              return
            }
          }
        }
        next()
      })

      // Also patch on disk after pre-bundling (for builds)
      const timer = setInterval(() => {
        if (fs.existsSync(depsDir)) {
          clearInterval(timer)
          patchAllDeps()
        }
      }, 1000)
      setTimeout(() => clearInterval(timer), 15000)
    },
    buildStart() {
      patchAllDeps()
    },
    closeBundle() {
      patchAllDeps()
    },
  }
}

export default defineConfig({
  plugins: [react(), patchProcessNextTickPlugin()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      events: 'events',
      process: 'process/browser',
    },
  },
  server: {
    host: true,
    allowedHosts: ['.lhr.life', '.loca.lt', '.trycloudflare.com', '.serveousercontent.com'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
})
