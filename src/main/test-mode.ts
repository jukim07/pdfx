import { app } from 'electron'

export interface TestModeQueues {
  openPathsQueue: string[][]
  savePathQueue: string[]
}

const queues: TestModeQueues = { openPathsQueue: [], savePathQueue: [] }

export function testModeEnabled(): boolean {
  return process.env.PDFX_TEST_MODE === '1' && !app.isPackaged
}

// Playwright fills the queues via electronApp.evaluate() through this global.
// Dev/test only: a packaged app never assigns it, and the guards below never fire.
if (process.env.PDFX_TEST_MODE === '1' && !app.isPackaged) {
  ;(globalThis as typeof globalThis & { __pdfxTestMode?: TestModeQueues }).__pdfxTestMode = queues
}

export function nextOpenPaths(): string[] | undefined {
  return queues.openPathsQueue.shift()
}

export function nextSavePath(): string | undefined {
  return queues.savePathQueue.shift()
}
