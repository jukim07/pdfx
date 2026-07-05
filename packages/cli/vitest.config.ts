import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@pdfx/core/extract',
        replacement: fileURLToPath(new URL('../core/src/extract/index.ts', import.meta.url))
      },
      {
        find: '@pdfx/core',
        replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url))
      }
    ]
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000
  }
})
