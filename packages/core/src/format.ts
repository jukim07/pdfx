import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream
} from 'pdf-lib'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export { buildPdf, buildPdfx, buildPdfxWithProvenance } from './build.js'

export const MANIFEST_NAME = 'pdfx-manifest.json'
export const PDFX_VERSION = '1.0'
export const PDFX_VERSION_MINOR = '1.1'

export interface PdfxManifestDocumentSource {
  filename: string
  sha256: string
  importedAt: string   // ISO 8601
  converted?: boolean  // true when a non-PDF was converted to PDF at intake
}

export interface PdfxManifestDocument {
  name: string
  pages: number
  source?: PdfxManifestDocumentSource
  tags?: string[]
}

export interface PdfxManifest {
  pdfx: string
  title?: string
  documents: PdfxManifestDocument[]
}

export interface PagePartition {
  name: string
  indices: number[]
}

export interface ExportPage {
  bytes: Uint8Array
  sourceKey: string
  pageIndex: number
}

export interface ExportDocument {
  name: string
  pages: ExportPage[]
}

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i)
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.(pdf|pdfx)$/i, '')
}

const SUPPORTED_VERSIONS = new Set(['1.0', '1.1'])

function validateManifest(manifest: PdfxManifest): PdfxManifest | null {
  const valid =
    manifest &&
    typeof manifest.pdfx === 'string' &&
    SUPPORTED_VERSIONS.has(manifest.pdfx) &&
    Array.isArray(manifest.documents) &&
    manifest.documents.every(
      (d) => typeof d.name === 'string' && Number.isInteger(d.pages) && d.pages > 0
    )
  return valid ? manifest : null
}

export async function readManifest(pdf: PDFDocumentProxy): Promise<PdfxManifest | null> {
  let attachments: Record<string, { filename?: string; content: Uint8Array }> | null
  try {
    attachments = (await pdf.getAttachments()) as Record<
      string,
      { filename?: string; content: Uint8Array }
    > | null
  } catch {
    return null
  }
  if (!attachments) return null

  for (const [key, attachment] of Object.entries(attachments)) {
    if ((attachment.filename ?? key) !== MANIFEST_NAME) continue
    try {
      return validateManifest(
        JSON.parse(new TextDecoder().decode(attachment.content)) as PdfxManifest
      )
    } catch {
      return null
    }
  }
  return null
}

// Headless counterpart to readManifest: locates pdfx-manifest.json in the
// embedded-file stream via pdf-lib's low-level object model so callers in
// Node (CLI, extract pipeline) and the renderer share one implementation
// without pulling the pdfjs runtime into the module. Only flat
// Names/EmbeddedFiles/Names arrays are supported — exactly what buildPdfx
// writes; nested /Kids name trees fall back to null (single-document
// behavior per SPEC.md "Reader behavior").
export async function parseManifest(bytes: Uint8Array): Promise<PdfxManifest | null> {
  let pdf: PDFDocument
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch {
    return null
  }
  let entries: PDFArray | undefined
  try {
    const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
    const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
    entries = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray)
  } catch {
    return null
  }
  if (!entries) return null
  for (let i = 0; i + 1 < entries.size(); i += 2) {
    const nameObj = entries.lookup(i)
    const filename =
      nameObj instanceof PDFString || nameObj instanceof PDFHexString
        ? nameObj.decodeText()
        : null
    if (filename !== MANIFEST_NAME) continue
    try {
      const spec = entries.lookup(i + 1, PDFDict)
      const ef = spec.lookup(PDFName.of('EF'), PDFDict)
      const stream = ef.lookup(PDFName.of('F'), PDFStream) as PDFRawStream
      const content = decodePDFRawStream(stream).decode()
      return validateManifest(JSON.parse(new TextDecoder().decode(content)) as PdfxManifest)
    } catch {
      return null
    }
  }
  return null
}

export function partitionPages(
  manifest: PdfxManifest | null,
  totalPages: number,
  fallbackName: string
): PagePartition[] {
  if (!manifest) return [{ name: fallbackName, indices: range(0, totalPages) }]

  const partitions: PagePartition[] = []
  let cursor = 0
  for (const entry of manifest.documents) {
    const count = Math.min(entry.pages, totalPages - cursor)
    if (count <= 0) break
    partitions.push({ name: entry.name, indices: range(cursor, count) })
    cursor += count
  }
  if (cursor < totalPages) {
    partitions.push({ name: 'Untitled', indices: range(cursor, totalPages - cursor) })
  }
  return partitions
}
