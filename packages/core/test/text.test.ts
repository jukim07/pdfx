import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { extractText } from '../src/extract/text.js'

async function twoPageFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([300, 300])
  p1.drawText('Title One', { x: 20, y: 250, size: 24, font })
  p1.drawText('Body text on page one.', { x: 20, y: 200, size: 11, font })
  const p2 = doc.addPage([300, 300])
  p2.drawText('Second page body.', { x: 20, y: 200, size: 11, font })
  return doc.save()
}

describe('extractText', () => {
  it('extracts native text per page with font sizes', async () => {
    const pages = await extractText(await twoPageFixture())
    expect(pages.map((p) => p.page)).toEqual([1, 2])
    expect(pages[0].text).toContain('Title One')
    expect(pages[0].text).toContain('Body text on page one.')
    expect(pages[1].text).toContain('Second page body.')
    const title = pages[0].spans.find((s) => s.str.includes('Title One'))
    expect(title?.fontSize).toBeCloseTo(24, 0)
  })

  it('honors opts.pages and rejects out-of-range pages', async () => {
    const bytes = await twoPageFixture()
    const only2 = await extractText(bytes, { pages: [2] })
    expect(only2).toHaveLength(1)
    expect(only2[0].page).toBe(2)
    await expect(extractText(bytes, { pages: [3] })).rejects.toThrow(/out of range/)
  })
})
