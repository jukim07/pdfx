import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { TestSnapshot } from './types'

export const ROOT = join(__dirname, '..', '..')
export const EVIDENCE = join(__dirname, '..', 'evidence')

export interface Harness {
  app: ElectronApplication
  page: Page
  close: () => Promise<void>
}

export async function launchApp(): Promise<Harness> {
  const userData = await mkdtemp(join(tmpdir(), 'pdfx-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: {
      ...(process.env as Record<string, string>),
      PDFX_TEST_MODE: '1',
      PDFX_USER_DATA: userData
    }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { state: 'visible' })
  // The bridge is assigned on App mount; its absence means the seam is broken.
  // 20 s budget documented explicitly — first-boot can be slow; default 30 s masks nothing.
  await page.waitForFunction(
    () => (window as never as { __pdfxTest?: unknown }).__pdfxTest !== undefined,
    undefined,
    { timeout: 20_000 }
  )
  return { app, page, close: () => app.close() }
}

export async function queueOpenPaths(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate((_electron, batch) => {
    const g = globalThis as never as { __pdfxTestMode?: { openPathsQueue: string[][] } }
    if (!g.__pdfxTestMode) throw new Error('test mode not active in main process')
    g.__pdfxTestMode.openPathsQueue.push(batch)
  }, paths)
}

export async function queueSavePath(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate((_electron, p) => {
    const g = globalThis as never as { __pdfxTestMode?: { savePathQueue: string[] } }
    if (!g.__pdfxTestMode) throw new Error('test mode not active in main process')
    g.__pdfxTestMode.savePathQueue.push(p)
  }, path)
}

export async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId)
    if (!item) throw new Error(`menu item not found: ${menuId}`)
    item.click()
  }, id)
}

export async function getState(page: Page): Promise<TestSnapshot> {
  return page.evaluate(() =>
    (window as never as { __pdfxTest: { getState: () => unknown } }).__pdfxTest.getState()
  ) as Promise<TestSnapshot>
}

export async function shot(page: Page, spec: string, name: string): Promise<void> {
  const dir = join(EVIDENCE, spec)
  await mkdir(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`) })
}
