import { test, expect } from '@playwright/test'
import { existsSync, readFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import { makeFixtures } from './helpers/fixtures'
import {
  clickMenu, EVIDENCE, getState, launchApp, queueOpenPaths, queueSavePath, shot
} from './helpers/launch'

test('rotate persists through export; crop is guarded off while rotated', async () => {
  const fx = await makeFixtures()
  const outDir = join(EVIDENCE, '04-rotate')
  await mkdir(outDir, { recursive: true })
  const pdfxPath = join(outDir, 'rotated.pdfx')

  const { app, page, close } = await launchApp()
  try {
    await queueOpenPaths(app, [fx.reportPdf])
    await page.locator('header.toolbar').getByRole('button', { name: 'Open', exact: true }).click()
    await expect.poll(async () => (await getState(page)).docs.length, { timeout: 60_000 }).toBe(1)

    const page1Id = (await getState(page)).docs[0].pages[0].id
    const cell = page.locator(`[data-page-id="${page1Id}"]`)
    await cell.hover()
    await cell.locator('button[title="Rotate clockwise"]').click()
    await expect
      .poll(async () => (await getState(page)).docs[0].pages[0].rotation)
      .toBe(90)
    await shot(page, '04-rotate', '01-rotated-90')

    // Intentional Phase ② guard: crop disabled on rotated pages.
    await cell.hover()
    const guardedCrop = cell.locator('button[title="Reset rotation to crop this page"]')
    await expect(guardedCrop).toBeVisible()
    await expect(guardedCrop).toBeDisabled()

    await queueSavePath(app, pdfxPath)
    await clickMenu(app, 'export-pdfx')
    await expect.poll(() => existsSync(pdfxPath), { timeout: 60_000 }).toBe(true)
    await expect.poll(async () => (await getState(page)).busy, { timeout: 30_000 }).toBe(false)

    const exported = await PDFDocument.load(readFileSync(pdfxPath))
    expect(exported.getPageCount()).toBe(3)
    expect(exported.getPage(0).getRotation().angle).toBe(90)
    expect(exported.getPage(1).getRotation().angle).toBe(0)
    expect(exported.getPage(2).getRotation().angle).toBe(0)

    // Rotating back re-enables crop.
    await cell.hover()
    await cell.locator('button[title="Rotate counter-clockwise"]').click()
    await expect
      .poll(async () => (await getState(page)).docs[0].pages[0].rotation)
      .toBe(0)
    await cell.hover()
    await expect(cell.locator('button[title="Crop page"]')).toBeEnabled()
    await shot(page, '04-rotate', '02-rotated-back')
  } finally {
    await close()
  }
})
