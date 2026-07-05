import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { buildPdfx } from '../src/index.js'
import { extractArtifacts } from '../src/extract/artifacts.js'

async function textSourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of ['Invoice', 'ContractA', 'ContractB']) {
    const page = doc.addPage([300, 300])
    page.drawText(`${label} heading`, { x: 20, y: 250, size: 20, font })
    page.drawText(`${label} body text enough characters stay native.`, {
      x: 20,
      y: 200,
      size: 11,
      font
    })
  }
  return doc.save()
}

async function fixturePdfx(): Promise<Uint8Array> {
  const src = await textSourcePdf()
  const page = (i: number) => ({ bytes: src, sourceKey: 's', pageIndex: i })
  return buildPdfx(
    [
      { name: 'Invoice', pages: [page(0)] },
      { name: 'Contract', pages: [page(1), page(2)] }
    ],
    'Packet'
  )
}

describe('extractArtifacts', () => {
  it('writes full bundle: manifest.json schema, markdown, PNGs, page map', async () => {
    const bytes = await fixturePdfx()
    const outDir = await mkdtemp(join(tmpdir(), 'pdfx-artifacts-'))
    const manifest = await extractArtifacts(bytes, outDir, { dpi: 72 })

    expect(manifest.source.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(manifest.source.bytes).toBe(bytes.byteLength)
    expect(manifest.source.pageCount).toBe(3)
    expect(manifest.source.title).toBe('Packet')
    expect(manifest.dpi).toBe(72)
    expect(manifest.docs).toEqual([
      { name: 'Invoice', pages: 1, markdown: 'Invoice.md' },
      { name: 'Contract', pages: 2, markdown: 'Contract.md' }
    ])
    expect(manifest.pages.map((p) => [p.page, p.doc, p.pageInDoc, p.png, p.textMethod])).toEqual([
      [1, 'Invoice', 1, 'pages/p0001.png', 'native'],
      [2, 'Contract', 1, 'pages/p0002.png', 'native'],
      [3, 'Contract', 2, 'pages/p0003.png', 'native']
    ])

    // manifest.json written to disk equals the returned manifest
    const diskManifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'))
    expect(diskManifest).toEqual(manifest)

    // markdown files exist on disk
    expect(await readFile(join(outDir, 'Invoice.md'), 'utf8')).toContain('Invoice')
    expect(await readFile(join(outDir, 'Contract.md'), 'utf8')).toContain('Contract')

    // PNGs exist on disk
    for (const p of manifest.pages) {
      const buf = await readFile(join(outDir, p.png!))
      expect(buf.length).toBeGreaterThan(0)
    }
  }, 60_000)

  it('OCR fallback: image-only page gets ocr provenance', async () => {
    // Build a single-page image-only pdfx (no manifest → partitionPages fallback "Document")
    const canvas = createCanvas(360, 120)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, 360, 120)
    ctx.fillStyle = 'black'
    ctx.font = '48px sans-serif'
    ctx.fillText('SCANNED', 20, 80)
    const png = canvas.encodeSync('png')
    const doc = await PDFDocument.create()
    const image = await doc.embedPng(png)
    const p = doc.addPage([360, 120])
    p.drawImage(image, { x: 0, y: 0, width: 360, height: 120 })
    const bytes = await doc.save()

    const outDir = await mkdtemp(join(tmpdir(), 'pdfx-ocr-'))
    const manifest = await extractArtifacts(bytes, outDir, { dpi: 150 })

    // partitionPages fallback name for plain PDF with no pdfx manifest
    expect(manifest.docs[0].name).toBe('Document')
    expect(manifest.pages[0].textMethod).toBe('ocr')
    expect(await readFile(join(outDir, 'Document.md'), 'utf8')).toContain('SCANNED')
  }, 120_000)
})
