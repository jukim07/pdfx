import { test, expect } from '@playwright/test'
import { makeFixtures } from './helpers/fixtures'
import { getState, launchApp, queueOpenPaths, shot } from './helpers/launch'

test('find bar matches "kangaroo" on exactly page 2 of the report', async () => {
  const fx = await makeFixtures()
  const { app, page, close } = await launchApp()
  try {
    await queueOpenPaths(app, [fx.reportPdf])
    await page.locator('header.toolbar').getByRole('button', { name: 'Open', exact: true }).click()
    await expect.poll(async () => (await getState(page)).docs.length, { timeout: 60_000 }).toBe(1)

    await page.keyboard.press('ControlOrMeta+f')
    await expect(page.locator('.findbar')).toBeVisible()
    await page.locator('.findbar-input').fill('kangaroo')

    await expect
      .poll(async () => (await getState(page)).find.pages, { timeout: 30_000 })
      .toBe(1)
    const state = await getState(page)
    expect(state.find.occurrences).toBeGreaterThanOrEqual(1)
    expect(state.find.matchingPageIds).toEqual([state.docs[0].pages[1].id])
    expect(state.find.matchingDocIds).toEqual([state.docs[0].id])
    await expect(page.locator('.findbar-count')).toHaveText('1 page')
    await shot(page, '02-find', '01-kangaroo-match')

    await page.locator('.findbar-input').fill('wombat')
    await expect
      .poll(async () => (await getState(page)).find.matchedQuery, { timeout: 15_000 })
      .toBe('wombat')
    expect((await getState(page)).find.pages).toBe(0)
    await expect(page.locator('.findbar-count')).toHaveText('No results')
    await shot(page, '02-find', '02-no-results')
  } finally {
    await close()
  }
})
