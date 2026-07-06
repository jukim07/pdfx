import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@pdfx/core': resolve('packages/core/src/index.ts'),
        'tesseract.js': 'tesseract.js/dist/tesseract.esm.min.js'
      }
    },
    build: {
      rollupOptions: {
        // The core barrel reaches @napi-rs/canvas (a native addon) through the
        // redact engine's lazy imports. The renderer never executes those paths
        // (redaction runs in the main process over IPC), but rollup still tries
        // to bundle the .node binary unless the module is externalized.
        // Node built-ins used by watermark.ts (zlib, fs, path, url, module) and
        // @pdf-lib/fontkit (CJS-only) are likewise Node-only; rebuildLegible runs
        // in the main process over IPC, so the renderer never calls them.
        external: ['@napi-rs/canvas', 'zlib', 'fs', 'path', 'url', 'module', '@pdf-lib/fontkit']
      }
    },
    worker: {
      format: 'es'
    },
    plugins: [react()]
  }
})
