import { test, expect } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { runCli } from './helpers/cli'
import { makeFixtures, SENTINEL } from './helpers/fixtures'
import { clickMenu, EVIDENCE, getState, launchApp, queueOpenPaths, queueSavePath, shot } from './helpers/launch'

interface ArtifactManifest {
  docs: { name: string; pages: number; markdown: string | null }[]
  pages: { page: number; doc: string; pageInDoc: number; png: string | null; textMethod: string }[]
}

test('exports .pdfx from GUI; pdfx info + extract verify it', async () => {
  const fx = await makeFixtures()
  const outDir = join(EVIDENCE, '03-export-pdfx')
  await mkdir(outDir, { recursive: true })
  const pdfxPath = join(outDir, 'gui-export.pdfx')
  const bundleDir = join(outDir, 'gui-bundle')

  const { app, page, close } = await launchApp()
  try {
    await queueOpenPaths(app, [fx.reportPdf, fx.photoPng])
    await page.locator('header.toolbar').getByRole('button', { name: 'Open', exact: true }).click()
    await expect.poll(async () => (await getState(page)).docs.length, { timeout: 60_000 }).toBe(2)
    await expect.poll(async () => (await getState(page)).busy, { timeout: 30_000 }).toBe(false)
    const before = await getState(page)
    await shot(page, '03-export-pdfx', '01-before-export')

    rmSync(pdfxPath, { force: true })
    await queueSavePath(app, pdfxPath)
    await clickMenu(app, 'export-pdfx')
    await expect.poll(() => existsSync(pdfxPath), { timeout: 60_000 }).toBe(true)
    await expect.poll(async () => (await getState(page)).busy, { timeout: 30_000 }).toBe(false)
    await shot(page, '03-export-pdfx', '02-after-export')

    // Check 2: pdfx info --json mirrors what GUI showed at export time.
    const info = runCli(['info', pdfxPath, '--json'])
    expect(info.code).toBe(0)
    const infoJson = info.json as { pageCount: number; docs: { name: string; pages: number }[] }
    const guiDocs = before.docs.map((d) => ({ name: d.name, pages: d.pages.length }))
    expect(infoJson.docs).toEqual(guiDocs)
    expect(infoJson.pageCount).toBe(guiDocs.reduce((s, d) => s + d.pages, 0)) // 4

    // Check 3: pdfx extract --json writes manifest + pages + markdown; SENTINEL survives.
    const extract = runCli(['extract', pdfxPath, '-o', bundleDir, '--json'])
    expect(extract.code).toBe(0)
    const manifest = extract.json as ArtifactManifest

    // pages/pNNNN.png exist for each page
    const pngs = readdirSync(join(bundleDir, 'pages')).filter((f) => f.endsWith('.png'))
    expect(pngs).toHaveLength(infoJson.pageCount)

    // manifest.pages[].page is 1-based; each entry maps to the correct doc name
    // Build cumulative page-to-doc lookup: docOfPage(p) → doc name, where p is 1-based.
    function docOfPage(p: number): string {
      let running = 0
      for (const doc of manifest.docs) {
        running += doc.pages
        if (p <= running) return doc.name
      }
      throw new Error(`page ${p} out of range`)
    }
    for (const entry of manifest.pages) {
      expect(entry.page).toBeGreaterThanOrEqual(1)
      expect(entry.doc).toBe(docOfPage(entry.page))
    }

    // SENTINEL text from report.pdf must appear in its markdown output
    const reportDoc = manifest.docs.find((d) => /report/i.test(d.name))
    expect(reportDoc).toBeDefined()
    expect(reportDoc!.markdown).not.toBeNull()
    const reportMd = readFileSync(join(bundleDir, reportDoc!.markdown!), 'utf8')
    expect(reportMd).toContain(SENTINEL)
    expect(reportMd).toContain('kangaroo')

    // Persist values for human inspection
    writeFileSync(
      join(outDir, 'values.json'),
      JSON.stringify({ guiDocs, infoJson, manifestPageCount: manifest.pages.length }, null, 2)
    )
  } finally {
    await close()
  }
})
