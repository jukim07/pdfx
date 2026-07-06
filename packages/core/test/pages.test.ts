import { describe, it, expect, beforeAll } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { pullPages, deletePages, duplicatePages, insertPages, rotatePages } from '../src/ops/pages.js'

/** Build an n-page pdf with distinct page widths (100+i) so order is checkable. */
async function makePdf(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < n; i++) doc.addPage([100 + i, 300])
  return doc.save()
}

const widths = async (bytes: Uint8Array): Promise<number[]> => {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => Math.round(p.getWidth()))
}

let five: Uint8Array
beforeAll(async () => { five = await makePdf(5) })

describe('rotatePages', () => {
  it('sets /Rotate 90 on the selected range only', async () => {
    const out = await rotatePages(five, 90, '1-2')
    const doc = await PDFDocument.load(out)
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(1).getRotation().angle).toBe(90)
    expect(doc.getPage(2).getRotation().angle).toBe(0)
  })

  it('rotates all pages when ranges omitted, normalising 360 → 0', async () => {
    const out = await rotatePages(five, 360)
    const doc = await PDFDocument.load(out)
    for (const p of doc.getPages()) expect(p.getRotation().angle).toBe(0)
  })

  it('throws on non-multiple-of-90 angle', async () => {
    await expect(rotatePages(five, 45, '1')).rejects.toThrow()
  })

  it('throws when ranges matches no pages', async () => {
    await expect(rotatePages(five, 90, '99')).rejects.toThrow()
  })
})

describe('deletePages', () => {
  it('removes the selected pages', async () => {
    const out = await deletePages(five, '2,4')
    expect(await widths(out)).toEqual([100, 102, 104])
  })

  it('throws when deleting every page', async () => {
    await expect(deletePages(five, '1-')).rejects.toThrow()
  })
})

describe('duplicatePages', () => {
  it('inserts each copy immediately after its original', async () => {
    const out = await duplicatePages(five, '2')
    expect(await widths(out)).toEqual([100, 101, 101, 102, 103, 104])
  })
})

describe('pullPages', () => {
  it('extracts the range into a new PDF, preserving order', async () => {
    const out = await pullPages(five, '4-5,1')
    expect(await widths(out)).toEqual([103, 104, 100])
  })

  it('throws when ranges matches no pages', async () => {
    await expect(pullPages(five, '99')).rejects.toThrow()
  })
})

describe('insertPages', () => {
  it('inserts all donor pages before position 2', async () => {
    const donor = await makePdf(2) // widths 100, 101
    const out = await insertPages(five, donor, 2)
    expect(await widths(out)).toEqual([100, 100, 101, 101, 102, 103, 104])
  })

  it('inserts a ranges subset at the end (at = pageCount + 1)', async () => {
    const donor = await makePdf(3) // widths 100, 101, 102
    const out = await insertPages(five, donor, 6, '3')
    expect(await widths(out)).toEqual([100, 101, 102, 103, 104, 102])
  })

  it('throws on out-of-bounds at', async () => {
    const donor = await makePdf(1)
    await expect(insertPages(five, donor, 0)).rejects.toThrow()
    await expect(insertPages(five, donor, 7)).rejects.toThrow()
  })
})
