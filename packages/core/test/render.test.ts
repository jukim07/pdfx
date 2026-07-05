import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { renderPages } from '../src/extract/render.js'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47]

// PNG IHDR width is a big-endian uint32 at byte offset 16.
function pngWidth(png: Uint8Array): number {
  return new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16)
}

async function threePageFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) doc.addPage([200, 400])
  return doc.save()
}

describe('renderPages', () => {
  it('yields one valid PNG per page at the requested dpi', async () => {
    const out: { page: number; png: Uint8Array }[] = []
    for await (const entry of renderPages(await threePageFixture(), { dpi: 150 })) {
      out.push(entry)
    }
    expect(out.map((e) => e.page)).toEqual([1, 2, 3])
    for (const { png } of out) {
      expect(Array.from(png.slice(0, 4))).toEqual(PNG_SIG)
      // 200pt-wide page at 150dpi -> 200 * 150/72 = 416.67 -> ceil = 417px
      expect(pngWidth(png)).toBe(417)
    }
  })

  it('renders only the requested pages', async () => {
    const pages: number[] = []
    for await (const e of renderPages(await threePageFixture(), { dpi: 72, pages: [2] })) {
      pages.push(e.page)
    }
    expect(pages).toEqual([2])
  })
})
