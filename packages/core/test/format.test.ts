import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import {
  buildPdfx,
  buildPdfxWithProvenance,
  parseManifest,
  partitionPages,
  stripExtension
} from '../src/index.js'
import type { ExportDocument, PdfxManifestDocumentSource } from '../src/index.js'

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  return doc.save()
}

describe('pdfx manifest round-trip', () => {
  it('buildPdfx embeds a manifest that parseManifest recovers', async () => {
    const src = await onePagePdf()
    const page = { bytes: src, sourceKey: 'a', pageIndex: 0 }
    const bytes = await buildPdfx(
      [
        { name: 'Invoice', pages: [page] },
        { name: 'Contract', pages: [page, page] }
      ],
      'Packet'
    )
    const manifest = await parseManifest(bytes)
    expect(manifest).not.toBeNull()
    expect(manifest!.pdfx).toBe('1.0')
    expect(manifest!.title).toBe('Packet')
    expect(manifest!.documents).toEqual([
      { name: 'Invoice', pages: 1 },
      { name: 'Contract', pages: 2 }
    ])
  })

  it('parseManifest returns null for a plain PDF', async () => {
    expect(await parseManifest(await onePagePdf())).toBeNull()
  })

  it('parseManifest returns null for garbage bytes', async () => {
    expect(await parseManifest(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('partitionPages falls back to one document without a manifest', () => {
    expect(partitionPages(null, 3, 'Fallback')).toEqual([
      { name: 'Fallback', indices: [0, 1, 2] }
    ])
  })

  it('partitionPages adds a trailing Untitled doc for unclaimed pages', () => {
    const manifest = { pdfx: '1.0', documents: [{ name: 'A', pages: 1 }] }
    expect(partitionPages(manifest, 3, 'x')).toEqual([
      { name: 'A', indices: [0] },
      { name: 'Untitled', indices: [1, 2] }
    ])
  })

  it('stripExtension strips .pdf and .pdfx case-insensitively', () => {
    expect(stripExtension('a.pdfx')).toBe('a')
    expect(stripExtension('b.PDF')).toBe('b')
  })

  it('parseManifest returns null when catalog /Names is wrong type (not a PDFDict)', async () => {
    // Build a PDF where catalog /Names entry is a PDFArray instead of the expected PDFDict.
    // pdf-lib's lookupMaybe throws "Expected instance of PDFDict, but got instance of PDFArray"
    // when the type guard fails — the fix wraps that traversal in try/catch and returns null.
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    // Set catalog /Names to an array (wrong type — should be a dict)
    doc.catalog.set(PDFName.of('Names'), doc.context.obj([]))
    const bytes = await doc.save()
    await expect(parseManifest(bytes)).resolves.toBeNull()
  })

  it('parseManifest returns null when manifest JSON lacks the pdfx field', async () => {
    // Embed a manifest JSON without the required pdfx version field.
    // validateManifest must reject it and parseManifest must return null.
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    const badManifest = { documents: [{ name: 'Doc', pages: 1 }] }
    await doc.attach(
      new TextEncoder().encode(JSON.stringify(badManifest)),
      'pdfx-manifest.json',
      { mimeType: 'application/json' }
    )
    const bytes = await doc.save()
    await expect(parseManifest(bytes)).resolves.toBeNull()
  })
})

describe('manifest v1.1', () => {
  it('buildPdfxWithProvenance bumps version to 1.1 when source present', async () => {
    const src = await onePagePdf()
    const source: PdfxManifestDocumentSource = {
      filename: 'invoice.pdf',
      sha256: 'abc123def456',
      importedAt: '2026-07-05T10:00:00.000Z'
    }
    const docs: ExportDocument[] = [
      { name: 'Invoice', pages: [{ bytes: src, sourceKey: 'k1', pageIndex: 0 }] }
    ]
    const result = await buildPdfxWithProvenance(docs, 'Test', new Map([['Invoice', source]]))
    const mf = await parseManifest(result)
    expect(mf).not.toBeNull()
    expect(mf!.pdfx).toBe('1.1')
    expect(mf!.documents[0].source).toEqual(source)
  })

  it('buildPdfx (no provenance) still writes version 1.0', async () => {
    const src = await onePagePdf()
    const docs: ExportDocument[] = [
      { name: 'X', pages: [{ bytes: src, sourceKey: 'k2', pageIndex: 0 }] }
    ]
    const result = await buildPdfx(docs, 'NoProvenance')
    const mf = await parseManifest(result)
    expect(mf!.pdfx).toBe('1.0')
    expect((mf!.documents[0] as any).source).toBeUndefined()
  })

  it('parseManifest accepts v1.1 file with source and tags fields', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    const manifest = {
      pdfx: '1.1',
      title: 'New',
      documents: [{
        name: 'Doc B',
        pages: 1,
        source: { filename: 'doc_b.pdf', sha256: 'deadbeef', importedAt: '2026-07-05T00:00:00.000Z' },
        tags: ['contract']
      }]
    }
    await doc.attach(
      new TextEncoder().encode(JSON.stringify(manifest)),
      'pdfx-manifest.json',
      { mimeType: 'application/json' }
    )
    const bytes = await doc.save()
    const result = await parseManifest(bytes)
    expect(result!.pdfx).toBe('1.1')
    expect(result!.documents[0].source!.sha256).toBe('deadbeef')
    expect(result!.documents[0].tags).toEqual(['contract'])
  })

  it('buildPdfxWithProvenance without provenance map falls back to version 1.0', async () => {
    const src = await onePagePdf()
    const docs: ExportDocument[] = [
      { name: 'Solo', pages: [{ bytes: src, sourceKey: 'sk', pageIndex: 0 }] }
    ]
    const result = await buildPdfxWithProvenance(docs, 'Solo')
    const mf = await parseManifest(result)
    expect(mf!.pdfx).toBe('1.0')
  })

  it('parseManifest rejects unknown version (e.g. 2.0)', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 200])
    const manifest = { pdfx: '2.0', documents: [{ name: 'A', pages: 1 }] }
    await doc.attach(
      new TextEncoder().encode(JSON.stringify(manifest)),
      'pdfx-manifest.json',
      { mimeType: 'application/json' }
    )
    const bytes = await doc.save()
    await expect(parseManifest(bytes)).resolves.toBeNull()
  })

  it('buildPdfxWithProvenance with empty Map produces 1.0 manifest with no source fields', async () => {
    const src = await onePagePdf()
    const docs: ExportDocument[] = [
      { name: 'Invoice', pages: [{ bytes: src, sourceKey: 'k1', pageIndex: 0 }] }
    ]
    const result = await buildPdfxWithProvenance(docs, 'T', new Map())
    const mf = await parseManifest(result)
    expect(mf).not.toBeNull()
    expect(mf!.pdfx).toBe('1.0')
    expect((mf!.documents[0] as any).source).toBeUndefined()
  })

  it('buildPdfxWithProvenance with name-mismatch map produces 1.0 manifest and no source', async () => {
    const src = await onePagePdf()
    const source: PdfxManifestDocumentSource = {
      filename: 'wrong.pdf',
      sha256: 'deadbeef',
      importedAt: '2026-07-06T00:00:00.000Z'
    }
    const docs: ExportDocument[] = [
      { name: 'Invoice', pages: [{ bytes: src, sourceKey: 'k1', pageIndex: 0 }] }
    ]
    // Provenance map key 'WrongName' does not match document name 'Invoice'
    const result = await buildPdfxWithProvenance(docs, 'T', new Map([['WrongName', source]]))
    const mf = await parseManifest(result)
    expect(mf).not.toBeNull()
    expect(mf!.pdfx).toBe('1.0')
    expect((mf!.documents[0] as any).source).toBeUndefined()
  })
})
