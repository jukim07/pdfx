import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib'
import { writeStampAnnots } from '../../src/annots/stamp.js'
import type { StampAnnot } from '../../src/annots/model.js'

// 1x1 transparent PNG
const PNG_1x1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  )
    .split('')
    .map((c) => c.charCodeAt(0))
)

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  return doc.save()
}

describe('writeStampAnnots', () => {
  it('appends a /Stamp annot with /Rect and an /AP /N appearance', async () => {
    const stamps: StampAnnot[] = [
      { type: 'stamp', page: 0, rect: { x: 100, y: 100, w: 120, h: 40 }, png: PNG_1x1 }
    ]
    const out = await writeStampAnnots(await blankPdf(), stamps)
    const doc = await PDFDocument.load(out)
    const annots = doc.getPages()[0].node.Annots() as PDFArray
    expect(annots.size()).toBe(1)
    const dict = annots.lookup(0, PDFDict)
    expect(dict.lookup(PDFName.of('Subtype'), PDFName).asString()).toBe('/Stamp')
    expect(dict.lookup(PDFName.of('Rect'), PDFArray).size()).toBe(4)
    const ap = dict.lookup(PDFName.of('AP'), PDFDict)
    expect(ap.get(PDFName.of('N'))).toBeDefined()
  })
})
