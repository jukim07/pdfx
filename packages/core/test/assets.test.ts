import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { extractAssets } from '../src/extract/assets.js'

/**
 * 2-page fixture: page 0 has an embedded 1×1 PNG drawn via XObject,
 * page 1 blank; plus a "notes.txt" attachment.
 */
async function makeFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()

  // Minimal 1×1 white PNG
  const PNG_1X1 = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ])

  const img = await doc.embedPng(PNG_1X1)
  const page0 = doc.addPage([200, 200])
  page0.drawImage(img, { x: 10, y: 10, width: 50, height: 50 })
  doc.addPage([200, 200]) // blank page 1

  await doc.attach(new TextEncoder().encode('hello'), 'notes.txt', {
    mimeType: 'text/plain',
    description: 'test attachment'
  })

  return doc.save()
}

let fixture: Uint8Array
let outDir: string
beforeAll(async () => {
  fixture = await makeFixture()
})
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'pdfx-assets-'))
})
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true })
})

describe('extractAssets', () => {
  it('returns at least one image from page 0 and writes its PNG file', async () => {
    const manifest = await extractAssets(fixture, outDir)
    const page0imgs = manifest.images.filter((img) => img.page === 0)
    expect(page0imgs.length).toBeGreaterThanOrEqual(1)
    const file = join(outDir, page0imgs[0].file)
    expect((await stat(file)).size).toBeGreaterThan(0)
    // PNG signature on disk
    const bytes = await readFile(file)
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('deduplicates: refIds are unique across pages', async () => {
    const manifest = await extractAssets(fixture, outDir)
    const ids = manifest.images.map((i) => i.refId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('writes the notes.txt attachment and reports its mime type', async () => {
    const manifest = await extractAssets(fixture, outDir)
    const att = manifest.attachments.find((a) => a.filename === 'notes.txt')
    expect(att).toBeDefined()
    expect(att!.mimeType).toBe('text/plain')
    expect(await readFile(join(outDir, att!.file), 'utf8')).toBe('hello')
  })

  it('attachment count is 1 (plain-pdf fixture has no pdfx manifest)', async () => {
    const manifest = await extractAssets(fixture, outDir)
    expect(manifest.attachments).toHaveLength(1)
  })
})
