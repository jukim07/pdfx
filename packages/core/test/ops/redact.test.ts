import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { redactRegions } from '../../src/ops/redact.js'
import { StreamSurgeryError } from '../../src/ops/redact-model.js'

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
