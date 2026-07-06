import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { EXIT_OK, EXIT_ERROR, EXIT_USAGE, runCli } from '../src/cli.js'

async function makeDraftPdf(pageCount = 5): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792])
    // Draw a prominent diagonal DRAFT watermark on most pages
    if (i < Math.ceil(pageCount * 0.8)) {
      page.drawText('DRAFT', {
        x: 306, y: 396, size: 72,
        rotate: degrees(45),
        opacity: 0.25,
        color: rgb(0.5, 0.5, 0.5)
      })
    }
    page.drawText(`Page ${i + 1}`, { x: 50, y: 740, size: 12 })
  }
  return doc.save()
}

function collectIo() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    out,
    err
  }
}

describe('CLI watermark', () => {
  it('pdfx watermark adds text to PDF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    const output = join(dir, 'out.pdf')
    await writeFile(input, await makeDraftPdf(3))
    const { io } = collectIo()
    const code = await runCli(['watermark', input, '--text', 'TEST', '--opacity', '0.3', '--angle', '45', '-o', output], io)
    expect(code).toBe(EXIT_OK)
    const loaded = await PDFDocument.load(await readFile(output))
    expect(loaded.getPageCount()).toBe(3)
  })

  it('pdfx watermark defaults output path to <input>.watermarked.pdf', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    await writeFile(input, await makeDraftPdf(2))
    const { io, out } = collectIo()
    const code = await runCli(['watermark', input, '--text', 'CONFIDENTIAL'], io)
    expect(code).toBe(EXIT_OK)
    expect(out.join('\n')).toContain('in.watermarked.pdf')
  })

  it('pdfx watermark exits 2 without --text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    await writeFile(input, await makeDraftPdf(1))
    const { io, err } = collectIo()
    const code = await runCli(['watermark', input], io)
    expect(code).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--text')
  })

  it('pdfx watermark exits 2 with no positional', async () => {
    const { io } = collectIo()
    const code = await runCli(['watermark'], io)
    expect(code).toBe(EXIT_USAGE)
  })

  it('pdfx watermark exits 1 when input file does not exist', async () => {
    const { io, err } = collectIo()
    const code = await runCli(['watermark', '/nonexistent/nope.pdf', '--text', 'X'], io)
    expect(code).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('pdfx watermark:')
  })

  it('pdfx watermark-rm --list shows candidates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    await writeFile(input, await makeDraftPdf(5))
    const { io, out } = collectIo()
    const code = await runCli(['watermark-rm', input, '--list'], io)
    expect(code).toBe(EXIT_OK)
    expect(out.join('\n').toLowerCase()).toContain('draft')
  })

  it('pdfx watermark-rm --json emits parseable JSON candidates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    await writeFile(input, await makeDraftPdf(5))
    const { io, out } = collectIo()
    const code = await runCli(['watermark-rm', input, '--list', '--json'], io)
    expect(code).toBe(EXIT_OK)
    const candidates = JSON.parse(out.join('\n'))
    expect(Array.isArray(candidates)).toBe(true)
    expect(candidates.length).toBeGreaterThan(0)
  })

  it('pdfx watermark-rm --strip removes watermark and preserves page count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    const output = join(dir, 'out.pdf')
    await writeFile(input, await makeDraftPdf(5))

    // Get candidates
    const { io: listIo, out: listOut } = collectIo()
    const listCode = await runCli(['watermark-rm', input, '--list', '--json'], listIo)
    expect(listCode).toBe(EXIT_OK)
    const candidates = JSON.parse(listOut.join('\n'))
    expect(candidates.length).toBeGreaterThan(0)

    // Strip first candidate
    const { io } = collectIo()
    const code = await runCli(['watermark-rm', input, '--strip', candidates[0].id, '-o', output], io)
    expect(code).toBe(EXIT_OK)
    const loaded = await PDFDocument.load(await readFile(output))
    expect(loaded.getPageCount()).toBe(5)
  })

  it('pdfx watermark-rm exits 2 with no mode flag', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    await writeFile(input, await makeDraftPdf(1))
    const { io, err } = collectIo()
    const code = await runCli(['watermark-rm', input], io)
    expect(code).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--list')
  })

  it('pdfx watermark-rm exits 2 with no positional', async () => {
    const { io } = collectIo()
    const code = await runCli(['watermark-rm'], io)
    expect(code).toBe(EXIT_USAGE)
  })

  it('pdfx watermark-rm exits 1 when input file does not exist', async () => {
    const { io, err } = collectIo()
    const code = await runCli(['watermark-rm', '/nonexistent/nope.pdf', '--list'], io)
    expect(code).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('pdfx watermark-rm:')
  })

  it('pdfx watermark-rm --list --json emits [] when no candidates (Finding D: JSON contract)', async () => {
    // A PDF with no repeated text ops → zero candidates → --json must emit [] not prose
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    const doc = await PDFDocument.create()
    for (let i = 0; i < 3; i++) {
      const page = doc.addPage([612, 792])
      page.drawText(`Unique page ${i}: ${i * 1234}`, { x: 50, y: 740, size: 12 })
    }
    await writeFile(input, await doc.save())
    const { io, out } = collectIo()
    const code = await runCli(['watermark-rm', input, '--list', '--json'], io)
    expect(code).toBe(EXIT_OK)
    const parsed = JSON.parse(out.join('\n'))
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(0)
  })

  it('pdfx watermark-rm --strip defaults output path to <input>.stripped.pdf', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wm-'))
    const input = join(dir, 'in.pdf')
    await writeFile(input, await makeDraftPdf(5))

    // Get a valid candidate id first
    const { io: listIo, out: listOut } = collectIo()
    await runCli(['watermark-rm', input, '--list', '--json'], listIo)
    const candidates = JSON.parse(listOut.join('\n'))
    expect(candidates.length).toBeGreaterThan(0)

    const { io, out } = collectIo()
    const code = await runCli(['watermark-rm', input, '--strip', candidates[0].id], io)
    expect(code).toBe(EXIT_OK)
    expect(out.join('\n')).toContain('in.stripped.pdf')
  })
})
