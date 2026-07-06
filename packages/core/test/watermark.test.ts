import { describe, it, expect } from 'vitest'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { addWatermark, findWatermarkCandidates } from '../src/ops/watermark.js'
import { extractText } from '../src/extract/text.js'

async function makeDraftPdf(pageCount = 5): Promise<Uint8Array> {
  // Build a programmatic PDF where pages 1..pageCount-1 all have an identical
  // rotated "DRAFT" text op at the center — simulating a watermark on 80%+ of pages.
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792])
    if (i < Math.ceil(pageCount * 0.8)) {
      // Draw watermark on ≥80% of pages
      page.drawText('DRAFT', {
        x: 306,
        y: 396,
        size: 72,
        rotate: degrees(45),
        opacity: 0.25,
        color: rgb(0.5, 0.5, 0.5)
      })
    }
    // Draw normal text on all pages so they're not blank
    page.drawText(`Page ${i + 1}`, { x: 50, y: 740, size: 12 })
  }
  return doc.save()
}

async function makePdf(pageCount = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792])
  }
  return doc.save()
}

describe('findWatermarkCandidates', () => {
  it('detects the DRAFT watermark on ≥80% of pages', async () => {
    const pdf = await makeDraftPdf(5)
    const candidates = await findWatermarkCandidates(pdf)
    expect(candidates.length).toBeGreaterThan(0)
    const draft = candidates.find(
      (c) => c.description.toLowerCase().includes('draft')
    )
    expect(draft).toBeDefined()
    expect(draft!.pageCoverage).toBeGreaterThanOrEqual(0.8)
    expect(draft!.kind).toBe('text')
    expect(draft!.preview.length).toBeGreaterThan(0)
    expect(draft!.id).toBeTruthy()
  })

  it('returns no candidates for a PDF with no repeated ops', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < 5; i++) {
      const page = doc.addPage([612, 792])
      page.drawText(`Unique page ${i}: ${Math.random()}`, { x: 50, y: 740, size: 12 })
    }
    const pdf = await doc.save()
    const candidates = await findWatermarkCandidates(pdf)
    expect(candidates.length).toBe(0)
  })
})

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
