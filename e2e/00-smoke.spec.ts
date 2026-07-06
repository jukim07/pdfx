import { test, expect } from '@playwright/test'
import { getState, launchApp, shot } from './helpers/launch'

test('boots in test mode with readable state bridge and cancel-on-empty-queue dialogs', async () => {
  const { app, page, close } = await launchApp()
  try {
    const main = await app.evaluate(({ app: electronApp }) => ({
      packaged: electronApp.isPackaged,
      queuesPresent:
        (globalThis as never as { __pdfxTestMode?: unknown }).__pdfxTestMode !== undefined
    }))
    expect(main.packaged).toBe(false)
    expect(main.queuesPresent).toBe(true)

    const state = await getState(page)
    expect(state.docs).toEqual([])
    expect(state.busy).toBe(false)
    expect(state.find.open).toBe(false)

    // Empty open queue => handler cancels ([]) instead of showing a native dialog.
    await page.locator('header.toolbar').getByRole('button', { name: 'Open', exact: true }).click()
    await page.waitForTimeout(1500)
    expect((await getState(page)).docs).toEqual([])

    await shot(page, '00-smoke', '01-boot')
  } finally {
    await close()
  }
})
