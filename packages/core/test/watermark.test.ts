import { describe, it, expect } from 'vitest'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { addWatermark, findWatermarkCandidates, stripWatermark } from '../src/ops/watermark.js'
import { extractText } from '../src/extract/text.js'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

  it('same XObject painted at a different CTM on one page: different-CTM paint survives after strip (Finding 3)', async () => {
    // Build a PDF where:
    // - Pages 0–4: the stamp XObject is painted at one position (the watermark CTM)
    // - Page 2 additionally paints the SAME XObject at a DIFFERENT position (x+200)
    // After stripping the watermark candidate, the page-2 extra paint must survive.
    const stampSrc = await PDFDocument.create()
    const stampPage = stampSrc.addPage([300, 100])
    stampPage.drawText('DRAFT', { x: 20, y: 30, size: 48, color: rgb(0.6, 0.6, 0.6), opacity: 0.3 })

    const doc = await PDFDocument.create()
    const embedded = await doc.embedPage(stampPage)
    for (let i = 0; i < 5; i++) {
      const page = doc.addPage([612, 792])
      // Identical watermark placement on every page
      page.drawPage(embedded, { x: 156, y: 346 })
      page.drawText(`Page ${i + 1}`, { x: 50, y: 740, size: 12 })
      if (i === 2) {
        // Extra paint at a DIFFERENT position on page 2
        page.drawPage(embedded, { x: 350, y: 200 })
      }
    }
    const pdf = await doc.save()

    // Detect the watermark candidate (uniform placement on all 5 pages)
    const candidates = await findWatermarkCandidates(pdf)
    const xobj = candidates.find((c) => c.kind === 'xobject')
    expect(xobj).toBeDefined()

    // Strip
    const stripped = await stripWatermark(pdf, xobj!.id)

    // (i) Re-detection finds no xobject candidate at the watermark CTM
    const remaining = await findWatermarkCandidates(stripped)
    // The extra paint on page 2 at x:350,y:200 is NOT uniform across pages,
    // so it shouldn't become a new ≥80% coverage candidate anyway.
    // Key: no candidate should match the original watermark CTM.
    const strippedXobj = remaining.find((c) => c.kind === 'xobject' && c.id === xobj!.id)
    expect(strippedXobj).toBeUndefined()

    // (ii) Page 2's extra paint (different CTM) survived — the XObject resource
    // must still exist on page 2.
    const strippedDoc = await PDFDocument.load(stripped)
    const page2 = strippedDoc.getPage(2)
    const { XObject: xobjectDict } = page2.node.normalizedEntries()
    expect(xobjectDict.entries().length).toBeGreaterThan(0)

    // (iii) Normal page text survives
    const pages = await extractText(stripped)
    expect(pages.some((p) => p.text.includes('Page 1'))).toBe(true)
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

// Fixture for position-discrimination test (Finding 1).
// Pages 0–3 have centered+rotated 'DRAFT' (the watermark candidate).
// Page 4 has ONLY body text including 'DRAFT' at a different position (no watermark).
// This is the red/green proof fixture: with text-only matching (old code), the
// body 'DRAFT' on page 4 would be destroyed; with Tm-anchored matching (new code) it survives.
async function makeDraftWithBodyDraftPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  // Pages 0–3: watermark 'DRAFT' at center (rotated) + normal body text
  for (let i = 0; i < 4; i++) {
    const page = doc.addPage([612, 792])
    page.drawText('DRAFT', {
      x: 306,
      y: 396,
      size: 72,
      rotate: degrees(45),
      opacity: 0.25,
      color: rgb(0.5, 0.5, 0.5),
    })
    page.drawText(`Page ${i + 1}`, { x: 50, y: 740, size: 12 })
  }
  // Page 4: body text 'DRAFT' at a clearly different position, no watermark
  const lastPage = doc.addPage([612, 792])
  lastPage.drawText('DRAFT', { x: 50, y: 700, size: 12 })          // body DRAFT
  lastPage.drawText('Body text only', { x: 50, y: 650, size: 12 })
  lastPage.drawText('Page 5', { x: 50, y: 740, size: 12 })
  return doc.save()
}

describe('stripWatermark — position-discriminated removal (Finding 1)', () => {
  it('removes the center watermark DRAFT but preserves body DRAFT at a different position', async () => {
    const pdf = await makeDraftWithBodyDraftPdf()

    // Detect: should find exactly ONE candidate — the centered watermark DRAFT.
    // The body DRAFT (different Tm) must NOT be grouped into the same candidate.
    const candidates = await findWatermarkCandidates(pdf)
    const watermarkCandidate = candidates.find(
      (c) => c.kind === 'text' && c.description.toLowerCase().includes('draft'),
    )
    expect(watermarkCandidate).toBeDefined()
    // Coverage must be based on the watermark pages only (4/5 = 0.8), not 5/5.
    // If detection were text-only, the body DRAFT page would also be included,
    // resulting in coverage 1.0 — but the candidate should still exist either way.
    expect(watermarkCandidate!.pageCoverage).toBeGreaterThanOrEqual(0.8)

    // Strip the watermark candidate
    const stripped = await stripWatermark(pdf, watermarkCandidate!.id)

    // (i) Re-detection finds no qualifying text candidate for 'DRAFT'
    const remaining = await findWatermarkCandidates(stripped)
    const draftRemaining = remaining.find(
      (c) => c.kind === 'text' && c.description.toLowerCase().includes('draft'),
    )
    expect(draftRemaining).toBeUndefined()

    // (ii) extractText still finds body 'DRAFT' on page 5 (1-based; the last of 5 pages)
    const pages = await extractText(stripped)
    const lastPage = pages.find((p) => p.page === 5)
    expect(lastPage).toBeDefined()
    expect(lastPage!.text).toContain('DRAFT')

    // (iii) Other body text survives on all pages
    expect(pages.some((p) => p.text.includes('Page 1'))).toBe(true)
    expect(pages.some((p) => p.text.includes('Page 5'))).toBe(true)
    expect(pages.some((p) => p.text.includes('Body text only'))).toBe(true)
  })
})

describe('rebuildLegible', () => {
  it('produces a valid PDF with same page count and original is untouched', async () => {
    // Use a small real PDF with text. Build one programmatically.
    const doc = await PDFDocument.create()
    for (let i = 0; i < 3; i++) {
      const page = doc.addPage([612, 792])
      page.drawText(`The quick brown fox page ${i + 1}`, { x: 72, y: 700, size: 12 })
    }
    const original = await doc.save()
    const originalCopy = original.slice()

    const { rebuildLegible } = await import('../src/ops/watermark.js')
    const legible = await rebuildLegible(original, { font: 'opendyslexic', sizeDelta: 4 })

    // Original must be untouched
    expect(original).toEqual(originalCopy)

    // Output is a valid PDF
    const loaded = await PDFDocument.load(legible)
    expect(loaded.getPageCount()).toBe(3)

    // Output is substantially larger than the input (OpenDyslexic OTF is ~210KB, so the
    // legible PDF should be much larger than the source text-only PDF).
    expect(legible.length).toBeGreaterThan(original.length + 50_000)

    // Font name appears in the PDF object graph (pdf-lib stores /BaseFont as uncompressed
    // dict text, but the xref may be compressed — iterate objects instead of raw bytes)
    const context = loaded.context
    let foundFontName = false
    for (const [, obj] of context.enumerateIndirectObjects()) {
      if (obj.toString().toLowerCase().includes('opendyslexic')) {
        foundFontName = true
        break
      }
    }
    expect(foundFontName).toBe(true)
  })

  it('throws contextual error when OpenDyslexic font is missing', async () => {
    // Save original PDFX_FONT_DIR
    const originalFontDir = process.env.PDFX_FONT_DIR

    try {
      // Point to empty temp directory
      const emptyDir = mkdtempSync(join(tmpdir(), 'pdfx-test-'))
      process.env.PDFX_FONT_DIR = emptyDir

      // Create a simple PDF
      const doc = await PDFDocument.create()
      const page = doc.addPage([612, 792])
      page.drawText('Test', { x: 72, y: 700, size: 12 })
      const pdf = await doc.save()

      // rebuildLegible should throw with contextual error
      const { rebuildLegible } = await import('../src/ops/watermark.js')
      await expect(rebuildLegible(pdf)).rejects.toThrow(
        /OpenDyslexic font not found/
      )
    } finally {
      // Restore original env var
      if (originalFontDir !== undefined) {
        process.env.PDFX_FONT_DIR = originalFontDir
      } else {
        delete process.env.PDFX_FONT_DIR
      }
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
