import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { writeAnnots } from '@pdfx/core'
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, runCli } from '../src/cli.js'

function collectIo() {
  const out: string[] = []
  const err: string[] = []
  return {
    io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
    out,
    err
  }
}

async function makeAnnotatedPdf(): Promise<{ dir: string; inPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfx-flatten-'))
  const src = await PDFDocument.create()
  src.addPage([612, 792])
  const withAnnot = await writeAnnots(await src.save(), [
    {
      type: 'highlight',
      page: 0,
      quads: [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
      color: { r: 1, g: 0.83, b: 0.29 }
    }
  ])
  const inPath = join(dir, 'in.pdf')
  await writeFile(inPath, withAnnot)
  return { dir, inPath }
}

describe('cli flatten', () => {
  it('writes a flattened pdf to explicit -o path with no /Annots', async () => {
    const { dir, inPath } = await makeAnnotatedPdf()
    const outPath = join(dir, 'out.pdf')
    const { io } = collectIo()
    expect(await runCli(['flatten', inPath, '-o', outPath], io)).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(outPath))
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('defaults output to <input>.flat.pdf when -o is omitted', async () => {
    const { inPath } = await makeAnnotatedPdf()
    const expectedOut = inPath.replace(/\.pdf$/i, '.flat.pdf')
    const { io } = collectIo()
    expect(await runCli(['flatten', inPath], io)).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(expectedOut))
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('reports the output path on stdout', async () => {
    const { dir, inPath } = await makeAnnotatedPdf()
    const outPath = join(dir, 'reported.pdf')
    const { io, out } = collectIo()
    expect(await runCli(['flatten', inPath, '-o', outPath], io)).toBe(EXIT_OK)
    expect(out.join('\n')).toContain(outPath)
  })

  it('refuses to overwrite without -f (exit 1), allows with -f', async () => {
    const { dir, inPath } = await makeAnnotatedPdf()
    const outPath = join(dir, 'overwrite.pdf')
    // First write
    const { io: io1 } = collectIo()
    expect(await runCli(['flatten', inPath, '-o', outPath], io1)).toBe(EXIT_OK)
    // Second write without -f
    const { io: io2, err: err2 } = collectIo()
    expect(await runCli(['flatten', inPath, '-o', outPath], io2)).toBe(EXIT_ERROR)
    expect(err2.join('\n')).toContain('overwrite')
    // Third write with -f
    const { io: io3 } = collectIo()
    expect(await runCli(['flatten', inPath, '-o', outPath, '-f'], io3)).toBe(EXIT_OK)
  })

  it('exits 1 when input file does not exist', async () => {
    const { io, err } = collectIo()
    expect(await runCli(['flatten', '/nonexistent/nope.pdf'], io)).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('pdfx flatten:')
  })

  it('exits 2 with usage when no positional is given', async () => {
    const { io } = collectIo()
    expect(await runCli(['flatten'], io)).toBe(EXIT_USAGE)
  })
})
