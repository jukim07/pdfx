import { describe, it, expect } from 'vitest'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { addWatermark, findWatermarkCandidates, stripWatermark } from '../src/ops/watermark.js'
import { extractText } from '../src/extract/text.js'

// PDF streams are FlateDecode-compressed; literal text does not appear in raw
// bytes. Use extractText for content survival assertions instead.


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

// Fixture for the xobject arm: embed ONE stamp page as a Form XObject and
// paint it with identical placement on every page via drawPage (pdf-lib
// emits `q … cm … /Name Do … Q` for drawPage — operations.js:51-62).
async function makeXObjectDraftPdf(pageCount = 5): Promise<Uint8Array> {
  const stampSrc = await PDFDocument.create()
  const stampPage = stampSrc.addPage([300, 100])
  stampPage.drawText('DRAFT', { x: 20, y: 30, size: 48, color: rgb(0.6, 0.6, 0.6), opacity: 0.3 })

  const doc = await PDFDocument.create()
  const embedded = await doc.embedPage(stampPage)
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792])
    // Identical placement on every page → identical (ref + CTM) signature
    page.drawPage(embedded, { x: 156, y: 346 })
    page.drawText(`Page ${i + 1}`, { x: 50, y: 740, size: 12 })
  }
  return doc.save()
}

describe('findWatermarkCandidates — xobject arm', () => {
  it('detects the same Form XObject painted identically on every page', async () => {
    const pdf = await makeXObjectDraftPdf(5)
    const candidates = await findWatermarkCandidates(pdf)
    const xobj = candidates.find((c) => c.kind === 'xobject')
    expect(xobj).toBeDefined()
    expect(xobj!.pageCoverage).toBeGreaterThanOrEqual(0.8)
    expect(xobj!.id.startsWith('xobj|')).toBe(true)
    expect(xobj!.preview.length).toBeGreaterThan(0)
    expect(xobj!.description).toContain('XObject')
  })

  it('does not report an xobject candidate when placements differ per page', async () => {
    const stampSrc = await PDFDocument.create()
    const stampPage = stampSrc.addPage([300, 100])
    stampPage.drawText('DRAFT', { x: 20, y: 30, size: 48 })

    const doc = await PDFDocument.create()
    const embedded = await doc.embedPage(stampPage)
    for (let i = 0; i < 5; i++) {
      const page = doc.addPage([612, 792])
      // Different x per page → different CTM → no shared signature
      page.drawPage(embedded, { x: 50 + i * 90, y: 346 })
    }
    const pdf = await doc.save()
    const candidates = await findWatermarkCandidates(pdf)
    expect(candidates.filter((c) => c.kind === 'xobject').length).toBe(0)
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

describe('stripWatermark', () => {
  it('removes the detected DRAFT watermark: text gone from all pages', async () => {
    const pdf = await makeDraftPdf(5)

    // Detect
    const candidates = await findWatermarkCandidates(pdf)
    const draft = candidates.find((c) => c.description.toLowerCase().includes('draft'))
    expect(draft).toBeDefined()

    // Strip
    const stripped = await stripWatermark(pdf, draft!.id)

    // Assertion 1: still a valid PDF with same page count
    const loaded = await PDFDocument.load(stripped)
    expect(loaded.getPageCount()).toBe(5)

    // Assertion 2: re-running detection finds no watermark candidate
    const remaining = await findWatermarkCandidates(stripped)
    const draftRemaining = remaining.find((c) => c.description.toLowerCase().includes('draft'))
    expect(draftRemaining).toBeUndefined()

    // Assertion 3: normal page text survives — extractText sees "Page 1" on page 0
    // (streams are compressed so rawText checks don't work; use text extraction instead)
    const pages = await extractText(stripped)
    expect(pages.some((p) => p.text.includes('Page 1'))).toBe(true)
  })

  it('removes an xobject watermark: paint op and resource entry gone', async () => {
    const pdf = await makeXObjectDraftPdf(5)

    // Detect the xobject candidate
    const candidates = await findWatermarkCandidates(pdf)
    const xobj = candidates.find((c) => c.kind === 'xobject')
    expect(xobj).toBeDefined()

    // Strip
    const stripped = await stripWatermark(pdf, xobj!.id)

    // Assertion 1: still a valid PDF with same page count
    const loaded = await PDFDocument.load(stripped)
    expect(loaded.getPageCount()).toBe(5)

    // Assertion 2 (op removal): re-detection finds no xobject candidate
    const remaining = await findWatermarkCandidates(stripped)
    expect(remaining.filter((c) => c.kind === 'xobject').length).toBe(0)

    // Assertion 3 (visual removal): every page's XObject resource dict is
    // empty — nothing left to paint — and normal page text survives
    for (let i = 0; i < loaded.getPageCount(); i++) {
      const { XObject } = loaded.getPage(i).node.normalizedEntries()
      expect(XObject.entries().length).toBe(0)
    }
    // Normal "Page N" text must survive the strip operation
    const pages = await extractText(stripped)
    expect(pages.some((p) => p.text.includes('Page 1'))).toBe(true)
  })
})
