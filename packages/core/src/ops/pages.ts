import { PDFDocument, degrees } from 'pdf-lib'
import { parsePageRanges } from './page-ranges.js'

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true })
}

function indicesFor(doc: PDFDocument, ranges: string | undefined, op: string): number[] {
  const count = doc.getPageCount()
  const idxs = ranges === undefined
    ? Array.from({ length: count }, (_, i) => i)
    : parsePageRanges(ranges, count)
  if (idxs.length === 0) throw new RangeError(`${op}: ranges "${ranges}" matches no pages (doc has ${count})`)
  return idxs
}

/** Set /Rotate (absolute) on the selected pages; all pages when ranges omitted. */
export async function rotatePages(bytes: Uint8Array, angleDeg: number, ranges?: string): Promise<Uint8Array> {
  if (angleDeg % 90 !== 0) throw new RangeError(`angleDeg must be a multiple of 90, got ${angleDeg}`)
  const doc = await load(bytes)
  const normalized = ((angleDeg % 360) + 360) % 360
  for (const i of indicesFor(doc, ranges, 'rotatePages')) doc.getPage(i).setRotation(degrees(normalized))
  return doc.save()
}

/** Delete the selected pages. Throws if that would leave an empty document. */
export async function deletePages(bytes: Uint8Array, ranges: string): Promise<Uint8Array> {
  const doc = await load(bytes)
  const idxs = indicesFor(doc, ranges, 'deletePages')
  if (idxs.length >= doc.getPageCount()) throw new RangeError('deletePages: refusing to delete every page')
  // Delete descending so earlier removals do not shift later indices.
  for (const i of [...idxs].sort((a, b) => b - a)) doc.removePage(i)
  return doc.save()
}

/** Duplicate the selected pages; each copy lands immediately after its original. */
export async function duplicatePages(bytes: Uint8Array, ranges: string): Promise<Uint8Array> {
  const doc = await load(bytes)
  const idxs = indicesFor(doc, ranges, 'duplicatePages')
  // Descending so insertions do not shift indices still to be processed.
  for (const i of [...idxs].sort((a, b) => b - a)) {
    const [copy] = await doc.copyPages(doc, [i])
    doc.insertPage(i + 1, copy)
  }
  return doc.save()
}

/** Extract the selected pages, in spec order, into a new PDF. */
export async function pullPages(bytes: Uint8Array, ranges: string): Promise<Uint8Array> {
  const src = await load(bytes)
  const idxs = indicesFor(src, ranges, 'pullPages')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, idxs)
  for (const p of copied) out.addPage(p)
  return out.save()
}

/**
 * Insert pages of `insert` (all pages, or the `ranges` subset) into `bytes`
 * before 1-based position `at`; `at === pageCount + 1` appends.
 */
export async function insertPages(
  bytes: Uint8Array,
  insert: Uint8Array,
  at: number,
  ranges?: string,
): Promise<Uint8Array> {
  const doc = await load(bytes)
  if (!Number.isInteger(at) || at < 1 || at > doc.getPageCount() + 1) {
    throw new RangeError(`insertPages: at ${at} out of range 1..${doc.getPageCount() + 1}`)
  }
  const donor = await load(insert)
  const idxs = indicesFor(donor, ranges, 'insertPages')
  const copied = await doc.copyPages(donor, idxs)
  let pos = at - 1
  for (const p of copied) doc.insertPage(pos++, p)
  return doc.save()
}
