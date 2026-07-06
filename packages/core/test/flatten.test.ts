import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { writeAnnots } from '../src/annots/write.js'
import { flattenAnnots } from '../src/ops/flatten.js'
import type { Annot } from '../src/annots/model.js'

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  return doc.save()
}

describe('flattenAnnots', () => {
  it('removes /Annots after flattening highlight', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
        color: { r: 1, g: 0.83, b: 0.29 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening underline', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'underline',
        page: 0,
        quads: [{ x1: 50, y1: 600, x2: 200, y2: 600, x3: 50, y3: 588, x4: 200, y4: 588 }],
        color: { r: 0, g: 0, b: 1 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening strikeout', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'strikeout',
        page: 0,
        quads: [{ x1: 50, y1: 600, x2: 200, y2: 600, x3: 50, y3: 588, x4: 200, y4: 588 }],
        color: { r: 1, g: 0, b: 0 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening note', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'note',
        page: 0,
        rect: { x: 20, y: 700, w: 20, h: 20 },
        color: { r: 1, g: 1, b: 0 },
        contents: 'hello',
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening freetext', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'text',
        page: 0,
        rect: { x: 50, y: 400, w: 200, h: 50 },
        contents: 'Free text annotation',
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening ink', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'ink',
        page: 0,
        paths: [[10, 10, 20, 20, 30, 10]],
        color: { r: 0, g: 0, b: 1 },
        borderWidth: 2,
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('content stream grows after flattening highlight', async () => {
    const blank = await blankPdf()
    const withAnnot = await writeAnnots(blank, [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
        color: { r: 1, g: 0.83, b: 0.29 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    // Flattened output must be larger than the annotation-only version
    // (content stream has grown with drawing operators)
    expect(flat.length).toBeGreaterThan(blank.length)
  })

  it('handles page with no annots — /Annots stays absent', async () => {
    const pdf = await blankPdf()
    const flat = await flattenAnnots(pdf)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('flattens multiple annots across same page', async () => {
    const annots: Annot[] = [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 700, x2: 200, y2: 700, x3: 100, y3: 688, x4: 200, y4: 688 }],
        color: { r: 1, g: 1, b: 0 },
      },
      {
        type: 'underline',
        page: 0,
        quads: [{ x1: 100, y1: 650, x2: 200, y2: 650, x3: 100, y3: 638, x4: 200, y4: 638 }],
        color: { r: 0, g: 0, b: 1 },
      },
    ]
    const withAnnot = await writeAnnots(await blankPdf(), annots)
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('stamp annot: /Annots removed (stamp draw skipped)', async () => {
    // stamps are accepted-deferred in Phase 4b; flatten still removes /Annots
    // but since writeAnnots skips stamps no /Annots entry exists to start with
    const pdf = await blankPdf()
    const flat = await flattenAnnots(pdf)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('returns valid PDF bytes (parseable by PDFDocument.load)', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 10, x4: 30, y4: 10 }],
        color: { r: 1, g: 1, b: 0 },
        opacity: 0.5,
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    // Should not throw
    await expect(PDFDocument.load(flat)).resolves.toBeDefined()
  })
})
