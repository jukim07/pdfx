import { test, expect } from '@playwright/test'
import { makeFixtures } from './helpers/fixtures'
import { getState, launchApp, queueOpenPaths, shot } from './helpers/launch'

test('imports a multi-page PDF, a PNG and a .txt via the real Open flow', async () => {
  const fx = await makeFixtures()
  const { app, page, close } = await launchApp()
  try {
    await queueOpenPaths(app, [fx.reportPdf, fx.photoPng, fx.notesTxt])
    await page.locator('header.toolbar').getByRole('button', { name: 'Open', exact: true }).click()

    await expect
      .poll(async () => (await getState(page)).docs.length, { timeout: 60_000 })
      .toBe(3)
    await expect.poll(async () => (await getState(page)).busy, { timeout: 30_000 }).toBe(false)

    const state = await getState(page)
    const byName = (re: RegExp) => state.docs.find((d) => re.test(d.name))
    expect(byName(/report/i)?.pages).toHaveLength(3)
    expect(byName(/photo/i)?.pages).toHaveLength(1)
    expect(byName(/notes/i)?.pages).toHaveLength(1)
    for (const doc of state.docs) {
      for (const p of doc.pages) {
        expect(p.width).toBeGreaterThan(0)
        expect(p.height).toBeGreaterThan(0)
        expect(p.rotation).toBe(0)
        expect(p.cropBox).toBeNull()
      }
    }
    await shot(page, '01-import', '01-three-docs')
  } finally {
    await close()
  }
})
