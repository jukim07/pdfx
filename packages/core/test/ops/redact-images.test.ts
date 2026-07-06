import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import { redactRegions } from '../../src/ops/redact.js'

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('image removal', () => {
  it('removes an image fully contained in a region (op AND bytes)', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const img = await doc.embedPng(PNG_1x1)
    page.drawImage(img, { x: 100, y: 100, width: 50, height: 50 })
    const bytes = await doc.save()

    const out = await redactRegions(
      bytes,
      [{ page: 0, rect: { x: 90, y: 90, w: 80, h: 80 } }],
      { mode: 'black' },
    )
    const reloaded = await PDFDocument.load(out)
    const res = reloaded.getPages()[0].node.Resources()
    const xobj = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    // the image entry is gone from Resources
    expect(xobj === undefined || xobj.keys().length === 0).toBe(true)
  })

  it('keeps an image only PARTIALLY overlapped by the region', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const img = await doc.embedPng(PNG_1x1)
    page.drawImage(img, { x: 100, y: 100, width: 50, height: 50 })
    const bytes = await doc.save()

    const out = await redactRegions(
      bytes,
      [{ page: 0, rect: { x: 120, y: 120, w: 200, h: 200 } }], // overlaps, not contains
      { mode: 'black' },
    )
    const reloaded = await PDFDocument.load(out)
    const xobj = reloaded
      .getPages()[0]
      .node.Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    expect(xobj?.keys().length).toBe(1) // image kept; black box covers the overlap
  })
})
