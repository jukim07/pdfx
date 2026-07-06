import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@pdfx/core': resolve(__dirname, 'packages/core/src/index.ts')
    }
  },
  test: {
    include: ['src/renderer/src/**/*.test.ts'],
    testTimeout: 30_000
  }
})
