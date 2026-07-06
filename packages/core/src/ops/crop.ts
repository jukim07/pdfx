import { PDFDocument } from 'pdf-lib'
import { parsePageRanges } from './page-ranges.js'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

function indicesFor(doc: PDFDocument, ranges: string | undefined, op: string): number[] {
  const count = doc.getPageCount()
  const idxs = ranges === undefined
    ? Array.from({ length: count }, (_, i) => i)
    : parsePageRanges(ranges, count)
  if (idxs.length === 0) throw new RangeError(`${op}: ranges "${ranges}" matches no pages (doc has ${count})`)
  return idxs
}

/**
 * Apply a CropBox to the selected pages (all pages when ranges omitted).
 * MediaBox is preserved unchanged — only CropBox is written. Undo with resetCrop.
 */
export async function cropPages(bytes: Uint8Array, box: Box, ranges?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  for (const i of indicesFor(doc, ranges, 'cropPages')) {
    doc.getPage(i).setCropBox(box.x, box.y, box.width, box.height)
  }
  return doc.save()
}

/** Reset CropBox to equal MediaBox on the selected pages (all when ranges omitted). */
export async function resetCrop(bytes: Uint8Array, ranges?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  for (const i of indicesFor(doc, ranges, 'resetCrop')) {
    const page = doc.getPage(i)
    const { x, y, width, height } = page.getMediaBox()
    page.setCropBox(x, y, width, height)
  }
  return doc.save()
}
