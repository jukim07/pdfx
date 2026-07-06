import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { extractText } from '../../src/extract/text.js'
import { buildSsnFixture, SSN } from '../../src/ops/fixtures.js'
import { redactRegions } from '../../src/ops/redact.js'

async function pageText(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const pages = await extractText(bytes, {})
  return pages[pageIndex]?.text ?? ''
}

describe('rasterize fallback', () => {
  it('whole affected page becomes an image: NO text remains, other pages untouched', async () => {
    const src = await buildSsnFixture()
    const out = await redactRegions(
      src,
      [{ page: 0, rect: { x: 60, y: 652, w: 250, h: 28 } }],
      { mode: 'rasterize' },
    )
    const text = await pageText(out, 0)
    // Rasterized page yields no extractable text at all — not just the SSN.
    expect(text).not.toContain(SSN)
    expect(text.trim()).toBe('')
  })

  it('multi-page: regions on pages 0 and 2 rasterize correctly, page 1 text survives', async () => {
    // Build a 3-page doc with distinct known text per page.
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p0 = doc.addPage([612, 792])
    p0.drawText('page one secret', { x: 72, y: 660, size: 14, font })
    const p1 = doc.addPage([612, 792])
    p1.drawText('page two keeps', { x: 72, y: 660, size: 14, font })
    const p2 = doc.addPage([612, 792])
    p2.drawText('page three secret', { x: 72, y: 660, size: 14, font })
    const src = await doc.save()

    // Regions on pages 0 AND 2 — ascending-order removePage/insertPage loop
    // used to throw RangeError when k' > pageCount-1 after earlier removal.
    const out = await redactRegions(
      src,
      [
        { page: 0, rect: { x: 60, y: 652, w: 250, h: 28 } },
        { page: 2, rect: { x: 60, y: 652, w: 250, h: 28 } },
      ],
      { mode: 'rasterize' },
    )

    const pages = await extractText(out, {})
    // Rasterized pages yield no extractable text.
    expect(pages[0]?.text.trim()).toBe('')
    expect(pages[2]?.text.trim()).toBe('')
    // Middle page must survive intact.
    expect(pages[1]?.text).toContain('page two keeps')
    // Doc still has exactly 3 pages.
    const outDoc = await PDFDocument.load(out)
    expect(outDoc.getPageCount()).toBe(3)
  })

  it('Form-XObject doc (StreamSurgeryError in black mode) succeeds under rasterize with text gone', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    // Build the same Form-XObject fixture from redact.test.ts: inner doc's text is
    // wrapped in a Do-painted XObject on the outer page, causing a show-op/item
    // mismatch that throws StreamSurgeryError in black mode.
    const inner = await PDFDocument.create()
    const font = await inner.embedFont(StandardFonts.Helvetica)
    const pg = inner.addPage([612, 792])
    pg.drawText(`SSN: ${SSN}`, { x: 72, y: 660, size: 14, font })
    const innerBytes = await inner.save()

    const outer = await PDFDocument.create()
    const [emb] = await outer.embedPdf(innerBytes, [0])
    const p2 = outer.addPage([612, 792])
    p2.drawPage(emb)
    const bytes = await outer.save()

    // Confirm black mode throws so the rasterize test is meaningful.
    const { StreamSurgeryError } = await import('../../src/ops/redact-model.js')
    await expect(
      redactRegions(bytes, [{ page: 0, rect: { x: 60, y: 652, w: 300, h: 28 } }], {
        mode: 'black',
      }),
    ).rejects.toThrow(StreamSurgeryError)

    // Rasterize mode must succeed and text must be gone.
    const out = await redactRegions(
      bytes,
      [{ page: 0, rect: { x: 60, y: 652, w: 300, h: 28 } }],
      { mode: 'rasterize' },
    )
    const text = await pageText(out, 0)
    expect(text.trim()).toBe('')
  })
})
