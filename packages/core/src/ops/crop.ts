import { PDFDocument } from 'pdf-lib'
import { indicesFor } from './_shared.js'

export interface Box {
  x: number
  y: number
  width: number
  height: number
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
