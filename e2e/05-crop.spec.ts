import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import { makeFixtures } from './helpers/fixtures'
import {
  clickMenu, EVIDENCE, getState, launchApp, queueOpenPaths, queueSavePath, shot
} from './helpers/launch'

test('footer crop applied to all pages persists as CropBox in the export', async () => {
  const fx = await makeFixtures()
  const outDir = join(EVIDENCE, '05-crop')
  await mkdir(outDir, { recursive: true })
  const pdfxPath = join(outDir, 'cropped.pdfx')

  const { app, page, close } = await launchApp()
  try {
    await queueOpenPaths(app, [fx.statementPdf])
    await page.locator('header.toolbar').getByRole('button', { name: 'Open', exact: true }).click()
    await expect.poll(async () => (await getState(page)).docs.length, { timeout: 60_000 }).toBe(1)
    expect((await getState(page)).docs[0].pages).toHaveLength(4)

    const page1Id = (await getState(page)).docs[0].pages[0].id
    const cell = page.locator(`[data-page-id="${page1Id}"]`)
    await cell.hover()
    await cell.locator('button[title="Crop page"]').click()

    const overlay = cell.locator('div[style*="crosshair"]')
    await expect(overlay).toBeVisible()
    await shot(page, '05-crop', '01-crop-mode')

    // Drag from the top-left to ~92% height: keeps body text (y >= 174pt),
    // excludes the footer (text at y=30pt, glyph top ~40pt).
    // Events fire synchronously in a single evaluate call (no delay between
    // mousedown and mouseup); this exact sequence previously required a 20ms delay to work around
    // the CropOverlay stale closure. CropOverlay.onMouseUp reads live state via
    // dragRef rather than a stale closure, so fast drags are not dropped.
    const bb = (await overlay.boundingBox())!
    const x0 = bb.x + 1
    const y0 = bb.y + 1
    const x1 = bb.x + bb.width - 1
    const y1 = bb.y + bb.height * 0.92
    await page.evaluate(({ x0, y0, x1, y1 }) => {
      const el = document.elementFromPoint(x0, y0) as HTMLElement
      const fire = (type: string, x: number, y: number): void => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      }
      fire('mousedown', x0, y0)
      fire('mousemove', (x0 + x1) / 2, (y0 + y1) / 2)
      fire('mousemove', x1, y1)
      fire('mouseup', x1, y1)
    }, { x0, y0, x1, y1 })

    const dialog = page.locator('.crop-dialog')
    await expect(dialog).toBeVisible()
    await shot(page, '05-crop', '02-range-dialog')
    await dialog.locator('label:has-text("All") input[type="radio"]').check()
    await dialog.locator('.crop-dialog-buttons button.primary').click()
    await expect(dialog).not.toBeVisible()

    await expect
      .poll(async () =>
        (await getState(page)).docs[0].pages.filter((p) => p.cropBox !== null).length
      )
      .toBe(4)
    const state = await getState(page)
    for (const p of state.docs[0].pages) {
      const cb = p.cropBox!
      expect(cb.y).toBeGreaterThan(45)      // footer glyphs (top ~40pt) excluded
      expect(cb.y).toBeLessThan(115)        // body text (lowest 174pt) included
      expect(cb.y + cb.height).toBeGreaterThan(780) // top edge kept (~792)
      expect(cb.x).toBeLessThan(10)
      expect(cb.width).toBeGreaterThan(590)
    }
    await shot(page, '05-crop', '03-crop-applied')

    rmSync(pdfxPath, { force: true })
    await queueSavePath(app, pdfxPath)
    await clickMenu(app, 'export-pdfx')
    await expect.poll(() => existsSync(pdfxPath), { timeout: 60_000 }).toBe(true)
    await expect.poll(async () => (await getState(page)).busy, { timeout: 30_000 }).toBe(false)

    const exported = await PDFDocument.load(readFileSync(pdfxPath))
    expect(exported.getPageCount()).toBe(4)
    const bridgeBoxes = state.docs[0].pages.map((p) => p.cropBox!)
    exported.getPages().forEach((pdfPage, i) => {
      const box = pdfPage.getCropBox()
      expect(Math.abs(box.x - bridgeBoxes[i].x)).toBeLessThanOrEqual(1)
      expect(Math.abs(box.y - bridgeBoxes[i].y)).toBeLessThanOrEqual(1)
      expect(Math.abs(box.width - bridgeBoxes[i].width)).toBeLessThanOrEqual(1)
      expect(Math.abs(box.height - bridgeBoxes[i].height)).toBeLessThanOrEqual(1)
      expect(box.y).toBeGreaterThan(40) // footer band excluded from every page's CropBox
    })
    writeFileSync(
      join(outDir, 'values.json'),
      JSON.stringify({ bridgeBoxes, exportedBoxes: exported.getPages().map((p) => p.getCropBox()) }, null, 2)
    )
  } finally {
    await close()
  }
})
