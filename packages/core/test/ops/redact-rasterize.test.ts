import { describe, it, expect } from 'vitest'
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
