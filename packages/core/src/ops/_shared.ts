/**
 * Internal helpers shared across ops modules. Not part of @pdfx/core public API.
 */
import type { PDFDocument } from 'pdf-lib'
import { parsePageRanges } from './page-ranges.js'

/**
 * Resolve ranges to a list of 0-based page indices. If ranges is undefined,
 * returns all pages. Throws if the resolved set is empty.
 */
export function indicesFor(doc: PDFDocument, ranges: string | undefined, op: string): number[] {
  const count = doc.getPageCount()
  const idxs = ranges === undefined
    ? Array.from({ length: count }, (_, i) => i)
    : parsePageRanges(ranges, count)
  if (idxs.length === 0) throw new RangeError(`${op}: ranges "${ranges}" matches no pages (doc has ${count})`)
  return idxs
}
