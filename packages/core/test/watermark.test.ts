import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { addWatermark } from '../src/ops/watermark.js'
import { extractText } from '../src/extract/text.js'

async function makePdf(pageCount = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792])
  }
  return doc.save()
}

describe('addWatermark', () => {
  it('produces a valid PDF with more bytes than the input', async () => {
    const input = await makePdf(3)
    const result = await addWatermark(input, { text: 'CONFIDENTIAL', opacity: 0.3, angle: 45 })
    // Must be a valid PDF
    const loaded = await PDFDocument.load(result)
    expect(loaded.getPageCount()).toBe(3)
    // Watermark stream draws add bytes
    expect(result.length).toBeGreaterThan(input.length)
  })

  it('applies to every page', async () => {
    const input = await makePdf(5)
    const result = await addWatermark(input, { text: 'DRAFT', opacity: 0.2, angle: 30 })
    const loaded = await PDFDocument.load(result)
    expect(loaded.getPageCount()).toBe(5)
    // Per-page verification: every page's text content must contain 'DRAFT'.
    // A bug that watermarks only page 0 would leave pages 2–5 empty.
    const pages = await extractText(result)
    expect(pages).toHaveLength(5)
    for (const pageText of pages) {
      expect(pageText.text, `page ${pageText.page} missing watermark`).toContain('DRAFT')
    }
  })
})
