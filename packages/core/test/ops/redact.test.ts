import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { redactRegions, assertNoSurvivors } from '../../src/ops/redact.js'
import { StreamSurgeryError } from '../../src/ops/redact-model.js'
import { buildSsnFixture, SSN } from '../../src/ops/fixtures.js'

describe('assertNoSurvivors (direct unit test — most safety-critical guard)', () => {
  it('throws StreamSurgeryError when text intersects a region (untouched SSN fixture)', async () => {
    // assertNoSurvivors must throw if the caller passes it a document that still has
    // the SSN text inside the marked region — this is the invariant that redactRegions
    // relies on. Passing the raw (unredacted) fixture directly exercises the throw path.
    const bytes = await buildSsnFixture()
    // Region covers the SSN line: "SSN: 123-45-6789" drawn at (72, 660), 14pt.
    const region = { page: 0, rect: { x: 60, y: 652, w: 250, h: 28 } }
    await expect(assertNoSurvivors(bytes, [region])).rejects.toThrow(StreamSurgeryError)
  })

  it('does not throw when the region is over empty space (no text present)', async () => {
    const bytes = await buildSsnFixture()
    // Region in the blank area below all text — no items intersect it.
    const region = { page: 0, rect: { x: 60, y: 50, w: 500, h: 50 } }
    await expect(assertNoSurvivors(bytes, [region])).resolves.toBeUndefined()
  })
})

describe('redactRegions fail-closed', () => {
  it('throws StreamSurgeryError instead of under-redacting on op/item mismatch', async () => {
    // Build a PDF where content text is hidden inside a Form XObject (via embedPdf/drawPage).
    // The outer page's content stream contains only a "Do" (paint XObject) op — zero Tj ops.
    // pdfjs resolves the XObject and returns items from it, so items.length > 0
    // but showOps.length === 0 on the outer page stream → mismatch → StreamSurgeryError.
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const page = doc.addPage([612, 792])
    page.drawText('SECRET-IN-REGION', { x: 72, y: 660, size: 14, font })
    const srcBytes = await doc.save()

    const doc2 = await PDFDocument.create()
    const [emb] = await doc2.embedPdf(srcBytes, [0])
    const p2 = doc2.addPage([612, 792])
    p2.drawPage(emb) // page content = one Do op painting Form XObject — no Tj in outer stream
    const bytes = await doc2.save()

    await expect(
      redactRegions(bytes, [{ page: 0, rect: { x: 60, y: 652, w: 300, h: 28 } }], {
        mode: 'black',
      }),
    ).rejects.toThrow(StreamSurgeryError)
  })
})
