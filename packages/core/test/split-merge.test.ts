import { describe, it, expect, beforeAll } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { splitPdfx } from '../src/ops/split.js'
import { mergeInputs } from '../src/ops/merge.js'
import { buildPdfx, parseManifest } from '../src/index.js'

async function makePlainPdf(pageCount: number, width = 200): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) doc.addPage([width, 300])
  return doc.save()
}

/** pdfx bundle: Alpha (3 pages, width 200) + Beta (2 pages, width 250). */
async function makeBundle(): Promise<Uint8Array> {
  const a = await makePlainPdf(3, 200)
  const b = await makePlainPdf(2, 250)
  const page = (bytes: Uint8Array, key: string, i: number) => ({ bytes, sourceKey: key, pageIndex: i })
  return buildPdfx(
    [
      { name: 'Alpha', pages: [0, 1, 2].map((i) => page(a, 'a', i)) },
      { name: 'Beta', pages: [0, 1].map((i) => page(b, 'b', i)) }
    ],
    'Packet'
  )
}

let bundle: Uint8Array
beforeAll(async () => { bundle = await makeBundle() })

describe('splitPdfx', () => {
  it('splits a bundle into its member documents by manifest partition', async () => {
    const members = await splitPdfx(bundle)
    expect(members.map((m) => m.name)).toEqual(['Alpha', 'Beta'])
    const alpha = await PDFDocument.load(members[0].pdf)
    const beta = await PDFDocument.load(members[1].pdf)
    expect(alpha.getPageCount()).toBe(3)
    expect(beta.getPageCount()).toBe(2)
    expect(Math.round(alpha.getPage(0).getWidth())).toBe(200)
    expect(Math.round(beta.getPage(0).getWidth())).toBe(250)
  })

  it('treats a plain PDF as a single Untitled member', async () => {
    const members = await splitPdfx(await makePlainPdf(4))
    expect(members).toHaveLength(1)
    expect(members[0].name).toBe('Untitled')
    expect((await PDFDocument.load(members[0].pdf)).getPageCount()).toBe(4)
  })
})

describe('mergeInputs', () => {
  it("kind 'pdf': merges inputs into one flat PDF, honoring per-input ranges", async () => {
    const a = await makePlainPdf(2, 200)
    const b = await makePlainPdf(4, 250)
    const merged = await mergeInputs([{ bytes: a }, { bytes: b, ranges: '1,3' }], 'pdf')
    const doc = await PDFDocument.load(merged)
    expect(doc.getPageCount()).toBe(4)
    expect(await parseManifest(merged)).toBeNull() // flat pdf: no manifest
  })

  it("kind 'pdfx': writes a manifest with per-input names", async () => {
    const a = await makePlainPdf(2)
    const b = await makePlainPdf(3)
    const merged = await mergeInputs(
      [{ bytes: a, name: 'Invoice' }, { bytes: b, ranges: '2-3', name: 'Contract' }],
      'pdfx'
    )
    const manifest = await parseManifest(merged)
    expect(manifest?.documents).toEqual([
      { name: 'Invoice', pages: 2 },
      { name: 'Contract', pages: 2 }
    ])
  })

  it('throws on empty inputs', async () => {
    await expect(mergeInputs([], 'pdf')).rejects.toThrow()
  })

  it('split→merge round-trip preserves the manifest partition', async () => {
    const members = await splitPdfx(bundle)
    const merged = await mergeInputs(
      members.map((m) => ({ bytes: m.pdf, name: m.name })),
      'pdfx'
    )
    const manifest = await parseManifest(merged)
    expect(manifest?.documents).toEqual([
      { name: 'Alpha', pages: 3 },
      { name: 'Beta', pages: 2 }
    ])
    const doc = await PDFDocument.load(merged)
    expect(doc.getPageCount()).toBe(5)
    // page content preserved: widths still partition as 200,200,200,250,250
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([200, 200, 200, 250, 250])
  })
})
