import { describe, it, expect, beforeAll } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { cropPages, resetCrop } from '../src/ops/crop.js'

let fixture: Uint8Array
beforeAll(async () => {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([600, 800])
    page.setMediaBox(0, 0, 600, 800) // explicit MediaBox so we can verify it is untouched
  }
  fixture = await doc.save()
})

describe('cropPages', () => {
  it('sets CropBox on the selected range, leaves MediaBox untouched', async () => {
    const out = await cropPages(fixture, { x: 10, y: 20, width: 300, height: 400 }, '1-2')
    const doc = await PDFDocument.load(out)

    for (const i of [0, 1]) {
      const crop = doc.getPage(i).getCropBox()
      expect(crop.x).toBeCloseTo(10)
      expect(crop.y).toBeCloseTo(20)
      expect(crop.width).toBeCloseTo(300)
      expect(crop.height).toBeCloseTo(400)
      const media = doc.getPage(i).getMediaBox()
      expect(media.width).toBeCloseTo(600)
      expect(media.height).toBeCloseTo(800)
    }
    // page 3 untouched
    expect(doc.getPage(2).getCropBox().width).toBeCloseTo(600)
  })

  it('crops all pages when ranges omitted', async () => {
    const out = await cropPages(fixture, { x: 0, y: 0, width: 100, height: 100 })
    const doc = await PDFDocument.load(out)
    for (const p of doc.getPages()) expect(p.getCropBox().width).toBeCloseTo(100)
  })

  it('throws when ranges matches no pages', async () => {
    await expect(cropPages(fixture, { x: 0, y: 0, width: 100, height: 100 }, '99')).rejects.toThrow()
  })
})

describe('resetCrop', () => {
  it('restores CropBox to equal MediaBox on the selected range', async () => {
    const cropped = await cropPages(fixture, { x: 10, y: 20, width: 300, height: 400 })
    const reset = await resetCrop(cropped, '1')
    const doc = await PDFDocument.load(reset)

    const page0 = doc.getPage(0)
    expect(page0.getCropBox().width).toBeCloseTo(page0.getMediaBox().width)
    // page 2 still cropped
    expect(doc.getPage(1).getCropBox().width).toBeCloseTo(300)
  })
})
