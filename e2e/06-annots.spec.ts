import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import { readAnnots } from '../packages/core/dist/index.js'
import { makeFixtures } from './helpers/fixtures'
import {
  clickMenu,
  EVIDENCE,
  getState,
  launchApp,
  queueOpenPaths,
  queueSavePath,
  shot
} from './helpers/launch'

test('highlight annotation round-trip: draw → save → export → verify in PDF bytes', async () => {
  const fx = await makeFixtures()
  const outDir = join(EVIDENCE, '06-annots')
  await mkdir(outDir, { recursive: true })
  const exportPath = join(outDir, 'annotated.pdf')

  const { app, page, close } = await launchApp()
  try {
    // ── 1. Import a PDF ─────────────────────────────────────────────────────
    await queueOpenPaths(app, [fx.reportPdf])
    await page.locator('header.toolbar').getByRole('button', { name: 'Open', exact: true }).click()
    await expect.poll(async () => (await getState(page)).docs.length, { timeout: 60_000 }).toBe(1)

    // ── 2. Open FullView by double-clicking the first page cell ──────────────
    const pageId = (await getState(page)).docs[0].pages[0].id
    const cell = page.locator(`[data-page-id="${pageId}"]`)
    await cell.dblclick()
    // FullView mounts on top of the collection canvas; wait for it.
    await expect(page.locator('.full-page').first()).toBeVisible({ timeout: 10_000 })
    await shot(page, '06-annots', '01-fullview-open')

    // ── 3. Activate Highlight tool from the full-view chrome ─────────────────
    // The chrome header bar now contains the annot tool cluster, making the
    // full annotation workflow reachable without leaving full-view mode.
    // Previously the toolbar cluster (z-index 10) was occluded by the full-view
    // overlay (z-index 30), making the workflow unreachable via real UI clicks.
    const highlightBtn = page.locator('.full-chrome button[title="Highlight"]')
    await expect(highlightBtn).toBeVisible({ timeout: 5_000 })
    await highlightBtn.click()
    const stateAfterTool = await getState(page)
    expect(stateAfterTool.annotTool).toBe('highlight')
    await shot(page, '06-annots', '02-highlight-selected-in-chrome')

    // ── 4. Wait for the .annot-layer overlay to appear ───────────────────────
    // annotTool='highlight' is now active; AnnotOverlay renders when
    // tool !== 'none' inside FullViewPage.
    const annotLayer = page.locator('.full-page .annot-layer').first()
    await expect(annotLayer).toBeVisible({ timeout: 5_000 })

    // ── 5. Drag across the overlay to create a highlight annotation ──────────
    // Dispatch synchronous PointerEvents via page.evaluate so the drag is not
    // dropped by stale-closure on fast pointer-up (same pattern as 05-crop.spec.ts).
    // The AnnotOverlay ignores drags with < 1% area in either dimension.
    const bb = (await annotLayer.boundingBox())!
    const x0 = bb.x + bb.width * 0.10
    const y0 = bb.y + bb.height * 0.30
    const x1 = bb.x + bb.width * 0.80
    const y1 = bb.y + bb.height * 0.50
    await page.evaluate(({ x0, y0, x1, y1 }) => {
      const el = document.elementFromPoint(x0, y0) as HTMLElement
      if (!el) throw new Error(`no element at drag start (${x0.toFixed(0)},${y0.toFixed(0)})`)
      const fire = (type: string, x: number, y: number): void => {
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: x,
            clientY: y
          })
        )
      }
      fire('pointerdown', x0, y0)
      fire('pointermove', (x0 + x1) / 2, (y0 + y1) / 2)
      fire('pointermove', x1, y1)
      fire('pointerup', x1, y1)
    }, { x0, y0, x1, y1 })
    await shot(page, '06-annots', '03-fullview-after-drag')

    // ── 6. Assert one draft annotation was committed ─────────────────────────
    await expect.poll(async () => (await getState(page)).annotDraftCount, { timeout: 5_000 }).toBe(1)

    // ── 7. Save Annots via the real full-view chrome button ──────────────────
    // The Save Annots button lives in the full-view chrome header bar (z-index
    // 30), so it is always reachable while full-view is open. handleSaveAnnots
    // in App.tsx requires fullViewState.fullView to be set (to get the docId),
    // so the save must happen while full-view is still open — which is exactly
    // what the chrome placement guarantees.
    const saveBtn = page.locator('.full-chrome button[title="Commit annotation drafts into PDF"]')
    await expect(saveBtn).toBeVisible({ timeout: 5_000 })
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 })
    await saveBtn.click()

    // ── 8. Assert toast and draft count cleared ──────────────────────────────
    await expect.poll(async () => (await getState(page)).toast, { timeout: 10_000 }).toBe(
      'Annotations saved'
    )
    await expect.poll(async () => (await getState(page)).annotDraftCount, { timeout: 5_000 }).toBe(0)
    await shot(page, '06-annots', '04-saved-toast')

    // ── 9. Close FullView via the real chrome close button ───────────────────
    // The close button is in the full-view chrome header bar at z-index 30,
    // so it is reachable without bridge actions.
    const closeBtn = page.locator('.full-chrome button[title="Close (Esc)"]')
    await expect(closeBtn).toBeVisible({ timeout: 5_000 })
    await closeBtn.click()
    await expect(page.locator('.full-view')).not.toBeVisible({ timeout: 5_000 })

    rmSync(exportPath, { force: true })
    await queueSavePath(app, exportPath)
    await clickMenu(app, 'export-pdf')
    await expect.poll(() => existsSync(exportPath), { timeout: 60_000 }).toBe(true)
    await expect.poll(async () => (await getState(page)).busy, { timeout: 30_000 }).toBe(false)
    await shot(page, '06-annots', '05-exported')

    // ── 10. Structural validation: exported PDF must contain the highlight ────
    // pdf-lib load proves the file is valid. readAnnots (the same engine used
    // by writeAnnots) proves the annotation survived the full round-trip:
    //   writeAnnots → setDocs (in-memory) → toExportPage → buildPdfx → readAnnots
    // Note: pdf-lib copyPages uses compressed object streams so grepping raw
    // bytes for /Annots is unreliable; readAnnots parses the PDF object graph.
    const exported = await PDFDocument.load(readFileSync(exportPath))
    expect(exported.getPageCount()).toBeGreaterThanOrEqual(1)

    const exportedBytes = new Uint8Array(readFileSync(exportPath))
    const annPages = await readAnnots(exportedBytes)
    // annPages[0] corresponds to page 0 of the exported document.
    expect(annPages.length).toBeGreaterThanOrEqual(1)
    const types = annPages[0].annots.map((a) => a.type)
    console.log('[06-annots] annotation types on page 0:', types)
    expect(types).toContain('highlight')

    console.log('[06-annots] exported PDF with annotations:', exportPath)
    console.log('[06-annots] evidence screenshots:', outDir)
  } finally {
    await close()
  }
})
