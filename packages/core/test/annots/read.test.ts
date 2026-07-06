import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString } from 'pdf-lib'
import { writeAnnots } from '../../src/annots/write.js'
import { readAnnots } from '../../src/annots/read.js'
import type { Annot } from '../../src/annots/model.js'

async function blankPdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  return doc.save()
}

describe('readAnnots round-trip', () => {
  it('re-reads a highlight written by writeAnnots', async () => {
    const written: Annot[] = [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
        color: { r: 1, g: 0.83, b: 0.29 },
      },
    ]
    const out = await writeAnnots(await blankPdf(), written)
    const pages = await readAnnots(out)
    expect(pages).toHaveLength(1)
    expect(pages[0].annots).toHaveLength(1)
    const a = pages[0].annots[0]
    expect(a.type).toBe('highlight')
    if (a.type === 'highlight') {
      expect(a.quads).toHaveLength(1)
      expect(a.quads[0].x1).toBeCloseTo(100)
    }
  })

  it('re-reads a note with contents', async () => {
    const out = await writeAnnots(await blankPdf(), [
      { type: 'note', page: 0, rect: { x: 20, y: 700, w: 20, h: 20 }, color: { r: 1, g: 1, b: 0 }, contents: 'hi there' },
    ])
    const [page0] = await readAnnots(out)
    const a = page0.annots[0]
    expect(a.type).toBe('note')
    if (a.type === 'note') expect(a.contents).toBe('hi there')
  })

  it('re-reads all markup subtypes (underline, strikeout)', async () => {
    const annots: Annot[] = [
      {
        type: 'underline',
        page: 0,
        quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 10, x4: 30, y4: 10 }],
        color: { r: 0, g: 0, b: 1 },
      },
      {
        type: 'strikeout',
        page: 0,
        quads: [{ x1: 50, y1: 60, x2: 80, y2: 60, x3: 50, y3: 50, x4: 80, y4: 50 }],
        color: { r: 1, g: 0, b: 0 },
      },
    ]
    const out = await writeAnnots(await blankPdf(), annots)
    const [page0] = await readAnnots(out)
    expect(page0.annots).toHaveLength(2)
    expect(page0.annots[0].type).toBe('underline')
    expect(page0.annots[1].type).toBe('strikeout')
  })

  it('round-trips markup opacity and contents', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 10, x4: 30, y4: 10 }],
        color: { r: 1, g: 1, b: 0 },
        opacity: 0.5,
        contents: 'annotated text',
      },
    ])
    const [page0] = await readAnnots(out)
    const a = page0.annots[0]
    expect(a.type).toBe('highlight')
    if (a.type === 'highlight') {
      expect(a.contents).toBe('annotated text')
    }
  })

  it('round-trips a freetext annot', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'text',
        page: 0,
        rect: { x: 50, y: 400, w: 200, h: 100 },
        contents: 'free text content',
        fontSize: 14,
        color: { r: 0, g: 0, b: 0 },
      },
    ])
    const [page0] = await readAnnots(out)
    const a = page0.annots[0]
    expect(a.type).toBe('text')
    if (a.type === 'text') {
      expect(a.contents).toBe('free text content')
      expect(a.rect.x).toBeCloseTo(50)
      expect(a.rect.w).toBeCloseTo(200)
    }
  })

  it('round-trips an ink annot', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'ink',
        page: 0,
        paths: [
          [10, 10, 20, 20, 30, 10],
          [50, 50, 60, 70],
        ],
        color: { r: 0, g: 0, b: 1 },
        borderWidth: 2,
      },
    ])
    const [page0] = await readAnnots(out)
    const a = page0.annots[0]
    expect(a.type).toBe('ink')
    if (a.type === 'ink') {
      expect(a.paths).toHaveLength(2)
      expect(a.paths[0]).toHaveLength(6)
      expect(a.paths[0][0]).toBeCloseTo(10)
    }
  })

  it('multi-page: returns one PageAnnots per page, correct page index', async () => {
    const out = await writeAnnots(await blankPdf(3), [
      {
        type: 'highlight',
        page: 1,
        quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 10, x4: 30, y4: 10 }],
        color: { r: 1, g: 0, b: 0 },
      },
    ])
    const pages = await readAnnots(out)
    expect(pages).toHaveLength(3)
    expect(pages[0].page).toBe(0)
    expect(pages[0].annots).toHaveLength(0)
    expect(pages[1].page).toBe(1)
    expect(pages[1].annots).toHaveLength(1)
    expect(pages[2].annots).toHaveLength(0)
  })

  it('ignores unknown subtype dicts gracefully (no crash, not returned)', async () => {
    // Build a PDF with a foreign annot of subtype /Widget (unknown to readAnnots)
    const base = await blankPdf()
    const doc = await PDFDocument.load(base)
    const page = doc.getPages()[0]
    const ctx = doc.context
    const foreignRef = ctx.register(
      ctx.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Widget'),
        Rect: [10, 10, 100, 50],
      }),
    )
    page.node.addAnnot(foreignRef)
    const bytes = await doc.save()

    const pages = await readAnnots(bytes)
    expect(pages[0].annots).toHaveLength(0)
  })

  it('handles page with no /Annots (empty annots array)', async () => {
    const pages = await readAnnots(await blankPdf())
    expect(pages).toHaveLength(1)
    expect(pages[0].annots).toHaveLength(0)
  })

  it('handles annot dict with missing /C gracefully (defaults to black)', async () => {
    const base = await blankPdf()
    const doc = await PDFDocument.load(base)
    const page = doc.getPages()[0]
    const ctx = doc.context
    const ref = ctx.register(
      ctx.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Text'),
        Rect: [10, 10, 30, 30],
        Contents: PDFString.of('no color key'),
      }),
    )
    page.node.addAnnot(ref)
    const bytes = await doc.save()

    const pages = await readAnnots(bytes)
    const a = pages[0].annots[0]
    expect(a.type).toBe('note')
    if (a.type === 'note') {
      expect(a.color).toEqual({ r: 0, g: 0, b: 0 })
      expect(a.contents).toBe('no color key')
    }
  })

  it('handles annot dict with no /Contents (defaults to empty string for note)', async () => {
    const base = await blankPdf()
    const doc = await PDFDocument.load(base)
    const page = doc.getPages()[0]
    const ctx = doc.context
    const ref = ctx.register(
      ctx.obj({
        Type: PDFName.of('Annot'),
        Subtype: PDFName.of('Text'),
        Rect: [10, 10, 30, 30],
        C: [1, 0, 0],
      }),
    )
    page.node.addAnnot(ref)
    const bytes = await doc.save()

    const pages = await readAnnots(bytes)
    const a = pages[0].annots[0]
    expect(a.type).toBe('note')
    if (a.type === 'note') {
      expect(a.contents).toBe('')
    }
  })
})
