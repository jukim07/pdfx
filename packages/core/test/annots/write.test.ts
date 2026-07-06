import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber } from 'pdf-lib'
import { writeAnnots } from '../../src/annots/write.js'
import type { Annot } from '../../src/annots/model.js'

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  return doc.save()
}

async function firstAnnotDict(bytes: Uint8Array): Promise<PDFDict> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPages()[0]
  const annots = page.node.Annots() as PDFArray
  // The entry may be an indirect ref — context.lookup unwraps it.
  return doc.context.lookup(annots.get(0), PDFDict)
}

describe('writeAnnots reparse', () => {
  it('highlight: /Highlight subtype with /QuadPoints and /Rect', async () => {
    const annots: Annot[] = [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
        color: { r: 1, g: 0.83, b: 0.29 },
      },
    ]
    const out = await writeAnnots(await blankPdf(), annots)
    const dict = await firstAnnotDict(out)
    expect(dict.lookup(PDFName.of('Subtype'), PDFName).asString()).toBe('/Highlight')
    expect(dict.lookup(PDFName.of('QuadPoints'), PDFArray).size()).toBe(8)
    expect(dict.lookup(PDFName.of('Rect'), PDFArray).size()).toBe(4)
  })

  it('underline and strikeout use right subtypes', async () => {
    for (const [type, subtype] of [
      ['underline', '/Underline'],
      ['strikeout', '/StrikeOut'],
    ] as const) {
      const out = await writeAnnots(await blankPdf(), [
        {
          type,
          page: 0,
          quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 10, x4: 30, y4: 10 }],
          color: { r: 0, g: 0, b: 1 },
        },
      ])
      const dict = await firstAnnotDict(out)
      expect(dict.lookup(PDFName.of('Subtype'), PDFName).asString()).toBe(subtype)
    }
  })

  it('markup: optional opacity /CA and /Contents', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 10, x4: 30, y4: 10 }],
        color: { r: 1, g: 1, b: 0 },
        opacity: 0.5,
        contents: 'note text',
      },
    ])
    const dict = await firstAnnotDict(out)
    expect(dict.lookup(PDFName.of('CA'), PDFNumber).asNumber()).toBeCloseTo(0.5)
    expect(dict.get(PDFName.of('Contents'))).toBeDefined()
  })

  it('note: /Text subtype with /Contents and /Rect', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'note',
        page: 0,
        rect: { x: 20, y: 700, w: 20, h: 20 },
        color: { r: 1, g: 1, b: 0 },
        contents: 'hello',
      },
    ])
    const dict = await firstAnnotDict(out)
    expect(dict.lookup(PDFName.of('Subtype'), PDFName).asString()).toBe('/Text')
    expect(dict.get(PDFName.of('Contents'))).toBeDefined()
    expect(dict.lookup(PDFName.of('Rect'), PDFArray).size()).toBe(4)
  })

  it('note: /Open flag written when specified', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'note',
        page: 0,
        rect: { x: 10, y: 10, w: 20, h: 20 },
        color: { r: 0, g: 0, b: 1 },
        contents: 'open note',
        open: true,
      },
    ])
    const dict = await firstAnnotDict(out)
    expect(dict.get(PDFName.of('Open'))).toBeDefined()
  })

  it('freetext: /FreeText subtype with /Rect and /DA', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'text',
        page: 0,
        rect: { x: 20, y: 600, w: 200, h: 40 },
        contents: 'box',
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 },
      },
    ])
    const dict = await firstAnnotDict(out)
    expect(dict.lookup(PDFName.of('Subtype'), PDFName).asString()).toBe('/FreeText')
    expect(dict.get(PDFName.of('DA'))).toBeDefined()
    expect(dict.lookup(PDFName.of('Rect'), PDFArray).size()).toBe(4)
    expect(dict.get(PDFName.of('Contents'))).toBeDefined()
  })

  it('ink: /Ink subtype with /InkList array of arrays', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'ink',
        page: 0,
        paths: [[10, 10, 20, 20, 30, 10]],
        color: { r: 1, g: 0, b: 0 },
        borderWidth: 2,
      },
    ])
    const dict = await firstAnnotDict(out)
    expect(dict.lookup(PDFName.of('Subtype'), PDFName).asString()).toBe('/Ink')
    expect(dict.lookup(PDFName.of('InkList'), PDFArray).size()).toBe(1)
  })

  it('ink: /InkList inner array has correct coordinate count', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'ink',
        page: 0,
        paths: [
          [10, 10, 20, 20, 30, 10], // 6 coords
          [50, 50, 60, 70],           // 4 coords
        ],
        color: { r: 0, g: 1, b: 0 },
        borderWidth: 1,
      },
    ])
    const dict = await firstAnnotDict(out)
    const inkList = dict.lookup(PDFName.of('InkList'), PDFArray)
    expect(inkList.size()).toBe(2)
    const inner0 = doc_context_lookup_array(inkList, 0)
    expect(inner0.size()).toBe(6)
  })

  it('stamp annot is skipped (no annot written)', async () => {
    const pngBytes = new Uint8Array([0x89, 0x50]) // fake PNG
    const out = await writeAnnots(await blankPdf(), [
      { type: 'stamp', page: 0, rect: { x: 10, y: 10, w: 100, h: 50 }, png: pngBytes },
    ])
    const doc = await PDFDocument.load(out)
    const page = doc.getPages()[0]
    const annots = page.node.Annots()
    expect(annots === undefined || annots.size() === 0).toBe(true)
  })

  it('throws when page index out of range', async () => {
    await expect(
      writeAnnots(await blankPdf(), [
        {
          type: 'highlight',
          page: 99,
          quads: [{ x1: 0, y1: 0, x2: 1, y2: 0, x3: 0, y3: 0, x4: 1, y4: 0 }],
          color: { r: 0, g: 0, b: 0 },
        },
      ])
    ).rejects.toThrow()
  })

  it('multiple annots on same page produce multiple entries', async () => {
    const out = await writeAnnots(await blankPdf(), [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 0, y1: 10, x2: 10, y2: 10, x3: 0, y3: 0, x4: 10, y4: 0 }],
        color: { r: 1, g: 0, b: 0 },
      },
      {
        type: 'note',
        page: 0,
        rect: { x: 50, y: 50, w: 20, h: 20 },
        color: { r: 0, g: 1, b: 0 },
        contents: 'second',
      },
    ])
    const doc = await PDFDocument.load(out)
    const page = doc.getPages()[0]
    const annots = page.node.Annots() as PDFArray
    expect(annots.size()).toBe(2)
  })
})

// Helper: resolve array entry (may be ref) to PDFArray
function doc_context_lookup_array(arr: PDFArray, index: number): PDFArray {
  const entry = arr.get(index)
  // If it's already a PDFArray return it directly; otherwise need context lookup
  // Since we build InkList as a nested literal, entries are direct PDFArrays
  if (entry instanceof PDFArray) return entry
  throw new Error(`Expected PDFArray at index ${index}`)
}
