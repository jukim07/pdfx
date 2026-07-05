import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildPdfx, parseManifest, partitionPages, stripExtension } from '../src/index.js'

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
})
