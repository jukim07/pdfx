import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { extractText } from '@pdfx/core/extract'
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, runCli } from '../src/cli.js'

// Inline fixture: @pdfx/core/src/ops/fixtures is not in the core exports map.
const SSN = '123-45-6789'

async function buildSsnFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.drawText('Employee record', { x: 72, y: 700, size: 14, font })
  page.drawText(`SSN: ${SSN}`, { x: 72, y: 660, size: 14, font })
  page.drawText('Other text stays', { x: 72, y: 620, size: 14, font })
  return doc.save()
}

// Two-page fixture with the SAME secret on both pages (page-scope test)
async function buildTwoPageFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page1 = doc.addPage([612, 792])
  page1.drawText(`Page one secret: ${SSN}`, { x: 72, y: 700, size: 14, font })
  const page2 = doc.addPage([612, 792])
  page2.drawText(`Page two secret: ${SSN}`, { x: 72, y: 700, size: 14, font })
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

describe('cli redact', () => {
  it('--find removes the string from output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    const outPath = join(dir, 'out.pdf')
    await writeFile(inPath, await buildSsnFixture())
    const { io, out } = collectIo()
    const code = await runCli(['redact', inPath, '--find', SSN, '-o', outPath], io)
    expect(code).toBe(EXIT_OK)
    expect(out.join('\n')).toContain(outPath)
    const pages = await extractText(new Uint8Array(await readFile(outPath)), {})
    expect(pages.map((p) => p.text).join('\n')).not.toContain(SSN)
    // surrounding text is preserved
    expect(pages.map((p) => p.text).join('\n')).toContain('Other text stays')
  })

  it('--box redacts an explicit region and removes the SSN', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    const outPath = join(dir, 'out.pdf')
    await writeFile(inPath, await buildSsnFixture())
    const { io } = collectIo()
    // SSN line is at y=660, font size 14 → approx bbox x=60,y=648,w=250,h=28
    const code = await runCli(['redact', inPath, '--box', '1:60,648,250,28', '-o', outPath], io)
    expect(code).toBe(EXIT_OK)
    const pages = await extractText(new Uint8Array(await readFile(outPath)), {})
    expect(pages.map((p) => p.text).join('\n')).not.toContain(SSN)
  })

  it('--regex redacts pattern matches', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    const outPath = join(dir, 'out.pdf')
    await writeFile(inPath, await buildSsnFixture())
    const { io } = collectIo()
    // Match SSN pattern
    const code = await runCli(['redact', inPath, '--regex', '\\d{3}-\\d{2}-\\d{4}', '-o', outPath], io)
    expect(code).toBe(EXIT_OK)
    const pages = await extractText(new Uint8Array(await readFile(outPath)), {})
    expect(pages.map((p) => p.text).join('\n')).not.toContain(SSN)
  })

  it('defaults output path to <input>.redacted.pdf', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    await writeFile(inPath, await buildSsnFixture())
    const { io, out } = collectIo()
    const code = await runCli(['redact', inPath, '--find', SSN], io)
    expect(code).toBe(EXIT_OK)
    expect(out.join('\n')).toContain('in.redacted.pdf')
  })

  it('exits 2 with no redaction target given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    await writeFile(inPath, await buildSsnFixture())
    const { io, err } = collectIo()
    const code = await runCli(['redact', inPath], io)
    expect(code).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('requires')
  })

  it('exits 2 with no positional', async () => {
    const { io } = collectIo()
    const code = await runCli(['redact'], io)
    expect(code).toBe(EXIT_USAGE)
  })

  it('exits 1 when input file does not exist', async () => {
    const { io, err } = collectIo()
    const code = await runCli(['redact', '/nonexistent/nope.pdf', '--find', SSN], io)
    expect(code).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('pdfx redact:')
  })

  it('exits 2 with invalid --mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    await writeFile(inPath, await buildSsnFixture())
    const { io, err } = collectIo()
    const code = await runCli(['redact', inPath, '--find', SSN, '--mode', 'invisible'], io)
    expect(code).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--mode')
  })

  it('exits 2 with clear message when --box page is 0 (below 1-based minimum)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    await writeFile(inPath, await buildSsnFixture())
    const { io, err } = collectIo()
    const code = await runCli(['redact', inPath, '--box', '0:60,648,250,28'], io)
    expect(code).toBe(EXIT_USAGE)
    expect(err.join('\n')).toMatch(/1-based/)
  })

  it('exits 2 when --pages is given without --find or --regex', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    await writeFile(inPath, await buildSsnFixture())
    const { io, err } = collectIo()
    const code = await runCli(['redact', inPath, '--box', '1:60,648,250,28', '--pages', '1'], io)
    expect(code).toBe(EXIT_USAGE)
    expect(err.join('\n')).toContain('--pages only applies to --find/--regex')
  })

  it('--pages scopes --find to the specified page only (security assertion)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pdfx-redact-'))
    const inPath = join(dir, 'in.pdf')
    const outPath = join(dir, 'out.pdf')
    await writeFile(inPath, await buildTwoPageFixture())
    const { io } = collectIo()
    // Only redact page 1 (1-based); page 2 must retain the SSN
    const code = await runCli(['redact', inPath, '--find', SSN, '--pages', '1', '-o', outPath], io)
    expect(code).toBe(EXIT_OK)
    const pages = await extractText(new Uint8Array(await readFile(outPath)), {})
    expect(pages).toHaveLength(2)
    // Page 1: secret must be gone
    expect(pages[0].text).not.toContain(SSN)
    // Page 2: secret must still be present
    expect(pages[1].text).toContain(SSN)
  })
})
