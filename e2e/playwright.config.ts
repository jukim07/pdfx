import { defineConfig } from '@playwright/test'
import { join } from 'path'

export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  globalSetup: join(__dirname, 'helpers', 'global-setup.ts'),
  outputDir: join(__dirname, 'evidence', '.pw'),
  reporter: [['list'], ['json', { outputFile: join(__dirname, 'evidence', 'report.json') }]]
})
