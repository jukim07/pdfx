import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFArray, PDFDict, PDFName } from 'pdf-lib'
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, runCli } from '../src/cli.js'

// Minimal 1x1 PNG (white pixel)
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

// Minimal 2x1 PNG (width=2, height=1) — aspect ratio 0.5, used to verify height derivation
const PNG_2x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAC0lEQVR4nGP4DwYAFPIF+6QNfF4AAAAASUVORK5CYII=',
  'base64'
)

function collectIo() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    out,
    err
  }
}

async function makeBlankPdf(): Promise<{ dir: string; inPath: string; pngPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfx-stamp-'))
  const src = await PDFDocument.create()
  src.addPage([612, 792])
  const inPath = join(dir, 'in.pdf')
  const pngPath = join(dir, 'sig.png')
  await writeFile(inPath, await src.save())
  await writeFile(pngPath, PNG_1x1)
  return { dir, inPath, pngPath }
}

describe('cli stamp', () => {
  it('adds a stamp annot at the given page/point/width with explicit -o', async () => {
    const { dir, inPath, pngPath } = await makeBlankPdf()
    const outPath = join(dir, 'out.pdf')
    const { io } = collectIo()
    expect(
      await runCli(['stamp', inPath, '--image', pngPath, '--page', '1', '--at', '100,150', '--w', '120', '-o', outPath], io)
    ).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(outPath))
    const annots = doc.getPages()[0].node.Annots() as PDFArray
    expect(annots).toBeDefined()
    expect(annots.size()).toBe(1)
  })

  it('defaults output to <input>.stamped.pdf when -o is omitted', async () => {
    const { inPath, pngPath } = await makeBlankPdf()
    const expectedOut = inPath.replace(/\.pdf$/i, '.stamped.pdf')
    const { io } = collectIo()
    expect(
      await runCli(['stamp', inPath, '--image', pngPath, '--page', '1', '--at', '100,150', '--w', '120'], io)
    ).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(expectedOut))
    const annots = doc.getPages()[0].node.Annots() as PDFArray
    expect(annots).toBeDefined()
    expect(annots.size()).toBe(1)
  })

  it('uses 1-based --page (page 1 → 0-based index 0)', async () => {
    const { dir, inPath, pngPath } = await makeBlankPdf()
    const outPath = join(dir, 'out.pdf')
    const { io } = collectIo()
    expect(
      await runCli(['stamp', inPath, '--image', pngPath, '--page', '1', '--at', '50,60', '--w', '80', '-o', outPath], io)
    ).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(outPath))
    // Page index 0 (first page) should have the annot
    const annots = doc.getPages()[0].node.Annots() as PDFArray
    expect(annots).toBeDefined()
    expect(annots.size()).toBe(1)
  })

  it('derives height from PNG aspect ratio (2x1 PNG → height === width / 2)', async () => {
    const { dir } = await makeBlankPdf()
    // Use a 2x1 PNG (width=2, height=1, aspect=0.5) so we can assert an exact height
    const nonSquarePngPath = join(dir, 'sig2x1.png')
    const inPath = join(dir, 'in.pdf')
    await writeFile(nonSquarePngPath, PNG_2x1)
    const outPath = join(dir, 'out.pdf')
    const { io } = collectIo()
    expect(
      await runCli(['stamp', inPath, '--image', nonSquarePngPath, '--page', '1', '--at', '100,100', '--w', '200', '-o', outPath], io)
    ).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(outPath))
    const annots = doc.getPages()[0].node.Annots() as PDFArray
    expect(annots.size()).toBe(1)
    // Read /Rect as [x0, y0, x1, y1]; width = x1-x0, height = y1-y0
    const dict = annots.lookup(0, PDFDict)
    const rect = dict.lookup(PDFName.of('Rect'), PDFArray)
    const x0 = (rect.get(0) as unknown as { numberValue?: number; value?: number }).numberValue
      ?? (rect.get(0) as unknown as { value: number }).value
    const y0 = (rect.get(1) as unknown as { numberValue?: number; value?: number }).numberValue
      ?? (rect.get(1) as unknown as { value: number }).value
    const x1 = (rect.get(2) as unknown as { numberValue?: number; value?: number }).numberValue
      ?? (rect.get(2) as unknown as { value: number }).value
    const y1 = (rect.get(3) as unknown as { numberValue?: number; value?: number }).numberValue
      ?? (rect.get(3) as unknown as { value: number }).value
    expect(x1 - x0).toBeCloseTo(200, 5)  // width = --w
    expect(y1 - y0).toBeCloseTo(100, 5)  // height = 200 * (1/2)
  })

  it('reports the output path on stdout', async () => {
    const { dir, inPath, pngPath } = await makeBlankPdf()
    const outPath = join(dir, 'reported.pdf')
    const { io, out } = collectIo()
    expect(
      await runCli(['stamp', inPath, '--image', pngPath, '--page', '1', '--at', '100,150', '--w', '120', '-o', outPath], io)
    ).toBe(EXIT_OK)
    expect(out.join('\n')).toContain(outPath)
  })

  it('exits 1 and emits error on invalid --at value (no comma)', async () => {
    const { dir, inPath, pngPath } = await makeBlankPdf()
    const outPath = join(dir, 'out.pdf')
    const { io, err } = collectIo()
    expect(
      await runCli(['stamp', inPath, '--image', pngPath, '--page', '1', '--at', 'notapoint', '--w', '120', '-o', outPath], io)
    ).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('--at')
  })

  it('exits 1 and emits error on invalid --at value (comma but non-numeric)', async () => {
    const { dir, inPath, pngPath } = await makeBlankPdf()
    const outPath = join(dir, 'out.pdf')
    const { io, err } = collectIo()
    expect(
      await runCli(['stamp', inPath, '--image', pngPath, '--page', '1', '--at', 'a,b', '--w', '120', '-o', outPath], io)
    ).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('--at')
  })

  it('exits 2 with usage when required --image is missing', async () => {
    const { dir, inPath } = await makeBlankPdf()
    const outPath = join(dir, 'out.pdf')
    const { io } = collectIo()
    expect(
      await runCli(['stamp', inPath, '--page', '1', '--at', '100,150', '--w', '120', '-o', outPath], io)
    ).toBe(EXIT_USAGE)
  })

  it('exits 2 with usage when no positional is given', async () => {
    const { io } = collectIo()
    expect(await runCli(['stamp'], io)).toBe(EXIT_USAGE)
  })

  it('exits 1 when input file does not exist', async () => {
    const { io, err } = collectIo()
    expect(
      await runCli(['stamp', '/nonexistent/nope.pdf', '--image', '/nonexistent/sig.png', '--page', '1', '--at', '100,150', '--w', '120'], io)
    ).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('pdfx stamp:')
  })

  it('places annot on page index 1 (not 0) when --page 2 on a 2-page PDF', async () => {
    const { io } = collectIo()
    const dir = await (await import('node:fs/promises')).mkdtemp(
      (await import('node:os')).tmpdir() + '/pdfx-stamp-p2-'
    )
    // Build a 2-page PDF
    const src = await PDFDocument.create()
    src.addPage([612, 792])
    src.addPage([612, 792])
    const inPath = join(dir, 'in2p.pdf')
    const pngPath = join(dir, 'sig.png')
    const outPath = join(dir, 'out.pdf')
    await writeFile(inPath, await src.save())
    await writeFile(pngPath, PNG_1x1)
    expect(
      await runCli(['stamp', inPath, '--image', pngPath, '--page', '2', '--at', '50,50', '--w', '80', '-o', outPath], io)
    ).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(outPath))
    // Page index 0 must have NO annots
    const annots0 = doc.getPages()[0].node.Annots()
    expect(!annots0 || (annots0 as PDFArray).size() === 0).toBe(true)
    // Page index 1 must have exactly 1 annot
    const annots1 = doc.getPages()[1].node.Annots() as PDFArray
    expect(annots1).toBeDefined()
    expect(annots1.size()).toBe(1)
  })
})
