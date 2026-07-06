import { PDFDocument } from 'pdf-lib'

import { MANIFEST_NAME, PDFX_VERSION, PDFX_VERSION_MINOR } from './format.js'
import type {
  ExportDocument,
  ExportPage,
  PdfxManifest,
  PdfxManifestDocument,
  PdfxManifestDocumentSource
} from './format.js'

export async function buildPdf(pages: ExportPage[]): Promise<Uint8Array> {
  const output = await PDFDocument.create()
  const sources = new Map<string, PDFDocument>()
  for (const page of pages) {
    let source = sources.get(page.sourceKey)
    if (!source) {
      source = await PDFDocument.load(page.bytes, { ignoreEncryption: true })
      sources.set(page.sourceKey, source)
    }
    const [copied] = await output.copyPages(source, [page.pageIndex])
    output.addPage(copied)
  }
  output.setProducer(`PDFX ${PDFX_VERSION}`)
  return output.save()
}

export async function buildPdfx(documents: ExportDocument[], title: string): Promise<Uint8Array> {
  const output = await PDFDocument.create()
  const manifest: PdfxManifest = { pdfx: PDFX_VERSION, title, documents: [] }
  const sources = new Map<string, PDFDocument>()

  for (const doc of documents) {
    if (doc.pages.length === 0) continue
    for (const page of doc.pages) {
      let source = sources.get(page.sourceKey)
      if (!source) {
        source = await PDFDocument.load(page.bytes, { ignoreEncryption: true })
        sources.set(page.sourceKey, source)
      }
      const [copied] = await output.copyPages(source, [page.pageIndex])
      output.addPage(copied)
    }
    manifest.documents.push({ name: doc.name, pages: doc.pages.length })
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

/**
 * Like buildPdfx but optionally embeds per-doc provenance fields.
 * Bumps manifest version to 1.1 only when at least one document entry
 * carries a source field (v1.0 readers are unaffected by unknown fields
 * per SPEC.md reader rules — they validate name+pages only).
 */
export async function buildPdfxWithProvenance(
  documents: ExportDocument[],
  title: string,
  provenance?: Map<string, PdfxManifestDocumentSource>
): Promise<Uint8Array> {
  const output = await PDFDocument.create()
  const hasProvenance = Boolean(provenance && provenance.size > 0)
  const version = hasProvenance ? PDFX_VERSION_MINOR : PDFX_VERSION
  const manifest: PdfxManifest = { pdfx: version, title, documents: [] }
  const sources = new Map<string, PDFDocument>()

  for (const doc of documents) {
    if (doc.pages.length === 0) continue
    for (const page of doc.pages) {
      let source = sources.get(page.sourceKey)
      if (!source) {
        source = await PDFDocument.load(page.bytes, { ignoreEncryption: true })
        sources.set(page.sourceKey, source)
      }
      const [copied] = await output.copyPages(source, [page.pageIndex])
      output.addPage(copied)
    }
    const entry: PdfxManifestDocument = { name: doc.name, pages: doc.pages.length }
    const src = provenance?.get(doc.name)
    if (src) entry.source = src
    manifest.documents.push(entry)
  }

  await output.attach(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), MANIFEST_NAME, {
    mimeType: 'application/json',
    description: 'PDFX manifest describing the documents in this collection',
    creationDate: new Date(),
    modificationDate: new Date()
  })

  output.setTitle(title)
  output.setProducer(`PDFX ${version}`)
  output.setKeywords(['PDFX'])

  return output.save()
}
