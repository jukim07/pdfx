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
  shot,
  triggerCloseFullView,
  triggerSaveAnnots
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

    // ── 2. Activate Highlight tool BEFORE opening FullView ───────────────────
    // The full-view overlay sits at z-index 30 above the toolbar (z-index 10),
    // so the tool must be selected while the collection canvas is visible.
    await page.locator('header.toolbar button[title="Highlight"]').click()
    const stateAfterTool = await getState(page)
    expect(stateAfterTool.annotTool).toBe('highlight')
    await shot(page, '06-annots', '01-highlight-selected')

    // ── 3. Open FullView by double-clicking the first page cell ──────────────
    const pageId = (await getState(page)).docs[0].pages[0].id
    const cell = page.locator(`[data-page-id="${pageId}"]`)
    await cell.dblclick()
    // FullView mounts on top of the collection canvas; wait for it.
    await expect(page.locator('.full-page').first()).toBeVisible({ timeout: 10_000 })
    await shot(page, '06-annots', '02-fullview-open')

    // ── 4. Wait for the .annot-layer overlay to appear ───────────────────────
    // annotTool='highlight' is already active; AnnotOverlay renders when
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

    // ── 7. Save Annots via the test bridge action ────────────────────────────
    // The toolbar Save Annots button (z-index 10) is occluded by the full-view
    // overlay (z-index 30) and cannot receive Playwright clicks. The bridge
    // action invokes handleSaveAnnots() directly — functionally identical but
    // bypasses the unreachable DOM button. handleSaveAnnots() requires the
    // full-view to be open (it reads fullViewState.fullView for the docId),
    // so we must call it while still in full-view mode.
    await triggerSaveAnnots(page)

    // ── 8. Assert toast and draft count cleared ──────────────────────────────
    await expect.poll(async () => (await getState(page)).toast, { timeout: 10_000 }).toBe(
      'Annotations saved'
    )
    await expect.poll(async () => (await getState(page)).annotDraftCount, { timeout: 5_000 }).toBe(0)
    await shot(page, '06-annots', '04-saved-toast')

    // ── 9. Close FullView, then export to PDF ───────────────────────────────
    // Use the bridge action to call closeFullView() directly: the close button
    // is under pointer-events: none on the chrome container, and Escape can be
    // swallowed by Playwright's focus model when the full-view canvas has input.
    await triggerCloseFullView(page)
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
