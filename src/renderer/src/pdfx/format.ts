import { PDFDocument } from 'pdf-lib'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'

/**
 * PDFX format, v1.0
 *
 * A .pdfx file is a fully valid PDF: the pages of every document are merged
 * sequentially, so any standard PDF viewer opens it as-is. What makes it a
 * PDFX collection is a JSON manifest embedded as a standard PDF file
 * attachment (PDF 32000-1:2008 §7.11.4) named `pdfx-manifest.json`:
 *
 *   {
 *     "pdfx": "1.0",
 *     "title": "Q1 Invoices",
 *     "documents": [
 *       { "name": "Invoice March", "pages": 3 },
 *       { "name": "Contract", "pages": 12 }
 *     ]
 *   }
 *
 * Page counts partition the merged page sequence in order. A PDF without a
 * manifest is simply a single-document collection.
 */

export const MANIFEST_NAME = 'pdfx-manifest.json'
export const PDFX_VERSION = '1.0'

export interface PdfxManifestDocument {
  name: string
  pages: number
}

export interface PdfxManifest {
  pdfx: string
  title?: string
  documents: PdfxManifestDocument[]
}

export interface SourceDocument {
  name: string
  bytes: Uint8Array
}

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i)
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.(pdf|pdfx)$/i, '')
}

/** Read the PDFX manifest from a loaded pdf.js document, or null if absent/invalid. */
export async function readManifest(pdf: PDFDocumentProxy): Promise<PdfxManifest | null> {
  const attachments = (await pdf.getAttachments()) as Record<
    string,
    { filename?: string; content: Uint8Array }
  > | null
  if (!attachments) return null

  for (const [key, attachment] of Object.entries(attachments)) {
    if ((attachment.filename ?? key) !== MANIFEST_NAME) continue
    try {
      const manifest = JSON.parse(new TextDecoder().decode(attachment.content)) as PdfxManifest
      const valid =
        manifest &&
        Array.isArray(manifest.documents) &&
        manifest.documents.every(
          (d) => typeof d.name === 'string' && Number.isInteger(d.pages) && d.pages > 0
        )
      return valid ? manifest : null
    } catch {
      return null
    }
  }
  return null
}

/** Split a PDFX container into standalone per-document PDFs, per its manifest. */
export async function splitPdfx(
  bytes: Uint8Array,
  manifest: PdfxManifest
): Promise<SourceDocument[]> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const total = source.getPageCount()
  const documents: SourceDocument[] = []
  let cursor = 0

  for (const entry of manifest.documents) {
    const count = Math.min(entry.pages, total - cursor)
    if (count <= 0) break
    const target = await PDFDocument.create()
    const pages = await target.copyPages(source, range(cursor, count))
    pages.forEach((page) => target.addPage(page))
    documents.push({ name: entry.name, bytes: await target.save() })
    cursor += count
  }

  // Lenient reading: pages beyond the manifest become one trailing document.
  if (cursor < total) {
    const target = await PDFDocument.create()
    const pages = await target.copyPages(source, range(cursor, total - cursor))
    pages.forEach((page) => target.addPage(page))
    documents.push({ name: 'Untitled', bytes: await target.save() })
  }

  return documents
}

/**
 * Import any .pdf or .pdfx file: returns one source document per logical
 * document. A plain PDF (no manifest) is a single document — unaffected.
 */
export async function importFile(filename: string, bytes: Uint8Array): Promise<SourceDocument[]> {
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  const pdf = await getDocument({ data: bytes.slice() }).promise
  try {
    const manifest = await readManifest(pdf)
    if (!manifest) return [{ name: stripExtension(filename), bytes }]
    return splitPdfx(bytes, manifest)
  } finally {
    void pdf.destroy()
  }
}

/** Merge documents into a single PDFX container: a valid PDF plus the manifest attachment. */
export async function buildPdfx(documents: SourceDocument[], title: string): Promise<Uint8Array> {
  const output = await PDFDocument.create()
  const manifest: PdfxManifest = { pdfx: PDFX_VERSION, title, documents: [] }

  for (const doc of documents) {
    const source = await PDFDocument.load(doc.bytes, { ignoreEncryption: true })
    const pages = await output.copyPages(source, source.getPageIndices())
    pages.forEach((page) => output.addPage(page))
    manifest.documents.push({ name: doc.name, pages: source.getPageCount() })
  }

  await output.attach(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), MANIFEST_NAME, {
    mimeType: 'application/json',
    description: 'PDFX manifest describing the documents in this collection',
    creationDate: new Date(),
    modificationDate: new Date()
  })

  output.setTitle(title)
  output.setProducer(`PDFX ${PDFX_VERSION}`)
  output.setKeywords(['PDFX'])

  return output.save()
}
