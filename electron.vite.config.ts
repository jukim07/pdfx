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
    worker: {
      format: 'es'
    },
    plugins: [react()]
  }
})
