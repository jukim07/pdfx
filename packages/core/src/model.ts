import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Box } from './ops/crop.js'
import type { PdfxManifestDocumentSource } from './format.js'

export interface PdfSource {
  id: string
  bytes: Uint8Array
  pdf: PDFDocumentProxy
}

export interface PageSize {
  width: number
  height: number
}

export interface PageEntry {
  id: string
  source: PdfSource
  pageIndex: number
  width: number
  height: number
  rotation?: number // 0 | 90 | 180 | 270; undefined === 0
  cropBox?: Box // PDF user-space units; undefined === uncropped
}

export interface DocEntry {
  id: string
  name: string
  pages: PageEntry[]
  // All partitions of a multi-doc .pdfx share the same source object —
  // they all came from the same imported file.
  source?: PdfxManifestDocumentSource
}
