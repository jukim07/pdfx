import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface DocEntry {
  id: string
  name: string
  /** Standalone PDF bytes for this document (used for export). */
  bytes: Uint8Array
  pdf: PDFDocumentProxy
  pageCount: number
  /** Page dimensions at scale 1, used to reserve layout before rendering. */
  pageSizes: { width: number; height: number }[]
}
