import { PDFDocument } from 'pdf-lib'
import { buildPdf, buildPdfx } from '../build.js'
import type { ExportDocument } from '../format.js'
import { parsePageRanges } from './page-ranges.js'

export interface MergeInput {
  bytes: Uint8Array
  /** Optional 1-based page-range spec (e.g. "3-5,9"). Defaults to all pages. */
  ranges?: string
  /** Member-document name in pdfx output. Defaults to "doc-<n>". */
  name?: string
}

/**
 * Merge inputs into one output. kind 'pdf' → flat PDF (no manifest);
 * kind 'pdfx' → .pdfx whose manifest has one member document per input.
 */
export async function mergeInputs(inputs: MergeInput[], kind: 'pdf' | 'pdfx'): Promise<Uint8Array> {
  if (inputs.length === 0) throw new Error('mergeInputs: inputs must not be empty')
  const docs: ExportDocument[] = []
  for (let i = 0; i < inputs.length; i++) {
    const { bytes, ranges, name } = inputs[i]
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
    const idxs = ranges === undefined
      ? Array.from({ length: src.getPageCount() }, (_, n) => n)
      : parsePageRanges(ranges, src.getPageCount())
    if (idxs.length === 0) throw new RangeError(`mergeInputs: input ${i + 1} ranges "${ranges}" matches no pages`)
    docs.push({
      name: name ?? `doc-${i + 1}`,
      pages: idxs.map((pageIndex) => ({ bytes, sourceKey: `input-${i}`, pageIndex }))
    })
  }
  if (kind === 'pdfx') return buildPdfx(docs, 'Merged')
  return buildPdf(docs.flatMap((d) => d.pages))
}
