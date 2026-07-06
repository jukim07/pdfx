import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { buildPdfx, MANIFEST_NAME } from '@pdfx/core'
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, parsePagesFlag, runCli } from '../src/cli.js'

function collectIo() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    out,
    err
  }
}

async function fixturePdfxFile(): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const label of ['one', 'two', 'three']) {
    const page = doc.addPage([300, 300])
    page.drawText(`Page ${label} body text with enough characters.`, { x: 20, y: 200, size: 11, font })
  }
  const src = await doc.save()
  const p = (i: number) => ({ bytes: src, sourceKey: 's', pageIndex: i })
  const bytes = await buildPdfx(
    [
      { name: 'A', pages: [p(0)] },
      { name: 'B', pages: [p(1), p(2)] }
    ],
    'Packet'
  )
  const dir = await mkdtemp(join(tmpdir(), 'pdfx-cli-'))
  const file = join(dir, 'sample.pdfx')
  await writeFile(file, bytes)
  return file
}

describe('parsePagesFlag', () => {
  it('parses ranges and singles into sorted unique pages', () => {
    expect(parsePagesFlag('1-3,5,2')).toEqual([1, 2, 3, 5])
  })

  it('rejects malformed specs', () => {
    expect(() => parsePagesFlag('x')).toThrow(/Invalid --pages/)
    expect(() => parsePagesFlag('3-1')).toThrow(/Invalid --pages/)
  })
})

describe('runCli', () => {
  it('prints usage and exits 2 with no arguments', async () => {
    const { io, out } = collectIo()
    expect(await runCli([], io)).toBe(EXIT_USAGE)
    expect(out.join('\n')).toContain('Usage:')
  })

  it('rejects unknown verbs with exit 2', async () => {
    const { io, err } = collectIo()
    expect(await runCli(['bogus'], io)).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('Unknown command')
  })

  it('exits 1 when input file does not exist', async () => {
    const { io, err } = collectIo()
    expect(await runCli(['info', '/nonexistent/nope.pdf'], io)).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('pdfx info:')
  })

  it('info --json reports docs and embedded manifest', async () => {
    const file = await fixturePdfxFile()
    const { io, out } = collectIo()
    expect(await runCli(['info', file, '--json'], io)).toBe(EXIT_OK)
    const info = JSON.parse(out.join('\n'))
    expect(info.pageCount).toBe(3)
    expect(info.title).toBe('Packet')
    expect(info.docs).toEqual([
      { name: 'A', pages: 1 },
      { name: 'B', pages: 2 }
    ])
    expect(info.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('info --json includes source and tags for v1.1 manifest', async () => {
    // Build a minimal PDF and attach a v1.1 manifest that has source + tags.
    const pdf = await PDFDocument.create()
    pdf.addPage([300, 300])
    const manifest = {
      pdfx: '1.1',
      title: 'Provenance Test',
      documents: [
        {
          name: 'Doc',
          pages: 1,
          source: {
            filename: 'original.pdf',
            sha256: 'abc123',
            importedAt: '2024-01-01T00:00:00Z',
          },
          tags: ['contract'],
        },
      ],
    }
    await pdf.attach(
      new TextEncoder().encode(JSON.stringify(manifest)),
      MANIFEST_NAME,
      { mimeType: 'application/json', description: 'PDFX manifest' }
    )
    const bytes = await pdf.save()
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-cli-v11-'))
    const file = join(dir, 'provenance.pdfx')
    await writeFile(file, bytes)

    const { io, out } = collectIo()
    expect(await runCli(['info', file, '--json'], io)).toBe(EXIT_OK)
    const info = JSON.parse(out.join('\n'))
    expect(info.docs[0]).toMatchObject({
      name: 'Doc',
      pages: 1,
      source: { filename: 'original.pdf', sha256: 'abc123', importedAt: '2024-01-01T00:00:00Z' },
      tags: ['contract'],
    })
  })

  it('info --json omits source and tags for v1.0 manifest', async () => {
    const file = await fixturePdfxFile()
    const { io, out } = collectIo()
    expect(await runCli(['info', file, '--json'], io)).toBe(EXIT_OK)
    const info = JSON.parse(out.join('\n'))
    expect(info.docs[0]).not.toHaveProperty('source')
    expect(info.docs[0]).not.toHaveProperty('tags')
  })

  it('extract writes bundle and reports it as JSON', async () => {
    const file = await fixturePdfxFile()
    const outDir = await mkdtemp(join(tmpdir(), 'pdfx-cli-out-'))
    const { io, out } = collectIo()
    expect(await runCli(['extract', file, '-o', outDir, '--dpi', '72', '--json'], io)).toBe(EXIT_OK)
    const manifest = JSON.parse(out.join('\n'))
    expect(manifest.pages).toHaveLength(3)
    expect(manifest.docs.map((d: { name: string }) => d.name)).toEqual(['A', 'B'])
    expect(await readdir(join(outDir, 'pages'))).toEqual(['p0001.png', 'p0002.png', 'p0003.png'])
  })

  it('rejects invalid --format with exit 2', async () => {
    const file = await fixturePdfxFile()
    const { io, err } = collectIo()
    expect(
      await runCli(['extract', file, '-o', '/tmp/x', '--format', 'bogus'], io)
    ).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('Invalid --format')
  })
})
