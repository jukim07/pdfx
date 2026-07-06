import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildPdfx, parseManifest } from '@pdfx/core'
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, parseMergeArg, runCli } from '../src/cli.js'

function collectIo() {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err }
}

let tmp: string
let pdf4: string // 4-page plain pdf, page widths 100..103
let bundle: string // pdfx: Alpha (2 pages) + Beta (1 page)

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([100 + i, 300])
  return doc.save()
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pdfx-surgery-'))
  pdf4 = join(tmp, 'four.pdf')
  await writeFile(pdf4, await makePdf(4))
  const src = await makePdf(3)
  const page = (i: number) => ({ bytes: src, sourceKey: 's', pageIndex: i })
  bundle = join(tmp, 'bundle.pdfx')
  await writeFile(bundle, await buildPdfx(
    [
      { name: 'Alpha', pages: [page(0), page(1)] },
      { name: 'Beta', pages: [page(2)] }
    ],
    'Packet'
  ))
})

describe('parseMergeArg', () => {
  it('passes plain paths through', () => {
    expect(parseMergeArg('a.pdf')).toEqual({ path: 'a.pdf' })
  })
  it('parses #range selectors', () => {
    expect(parseMergeArg('a.pdf#3-5')).toEqual({ path: 'a.pdf', ranges: '3-5' })
    expect(parseMergeArg('a.pdf#1,4-')).toEqual({ path: 'a.pdf', ranges: '1,4-' })
  })
  it('parses #name selectors', () => {
    expect(parseMergeArg('b.pdfx#Contract')).toEqual({ path: 'b.pdfx', name: 'Contract' })
  })
})

describe('rotate / delete / pull / crop', () => {
  it('rotate sets /Rotate on the range and exits 0', async () => {
    const out = join(tmp, 'rotated.pdf')
    const { io } = collectIo()
    expect(await runCli(['rotate', pdf4, '--angle', '90', '--pages', '1-2', '-o', out], io)).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(out))
    expect(doc.getPage(0).getRotation().angle).toBe(90)
    expect(doc.getPage(2).getRotation().angle).toBe(0)
  })

  it('rotate rejects a non-multiple-of-90 angle with exit 2', async () => {
    const { io } = collectIo()
    expect(await runCli(['rotate', pdf4, '--angle', '45', '-o', join(tmp, 'x.pdf')], io)).toBe(EXIT_USAGE)
  })

  it('delete removes the range', async () => {
    const out = join(tmp, 'deleted.pdf')
    const { io } = collectIo()
    expect(await runCli(['delete', pdf4, '--pages', '2', '-o', out], io)).toBe(EXIT_OK)
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(3)
  })

  it('pull extracts the range into a new PDF, with --json report', async () => {
    const out = join(tmp, 'pulled.pdf')
    const { io, out: lines } = collectIo()
    expect(await runCli(['pull', pdf4, '--pages', '3-4', '-o', out, '--json'], io)).toBe(EXIT_OK)
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(2)
    expect(JSON.parse(lines.join('\n')).output).toBe(out)
  })

  it('crop sets CropBox; --reset restores it', async () => {
    const cropped = join(tmp, 'cropped.pdf')
    const { io } = collectIo()
    expect(await runCli(['crop', pdf4, '--box', '10,20,50,60', '--pages', '1', '-o', cropped], io)).toBe(EXIT_OK)
    const doc = await PDFDocument.load(await readFile(cropped))
    expect(doc.getPage(0).getCropBox().width).toBeCloseTo(50)

    const reset = join(tmp, 'reset.pdf')
    expect(await runCli(['crop', cropped, '--reset', '-o', reset], collectIo().io)).toBe(EXIT_OK)
    const rdoc = await PDFDocument.load(await readFile(reset))
    expect(rdoc.getPage(0).getCropBox().width).toBeCloseTo(rdoc.getPage(0).getMediaBox().width)
  })
})

describe('split', () => {
  it('writes one <member-name>.pdf per manifest member', async () => {
    const outDir = join(tmp, 'split-out')
    const { io } = collectIo()
    expect(await runCli(['split', bundle, '-o', outDir], io)).toBe(EXIT_OK)
    expect((await readdir(outDir)).sort()).toEqual(['Alpha.pdf', 'Beta.pdf'])
    expect((await PDFDocument.load(await readFile(join(outDir, 'Alpha.pdf')))).getPageCount()).toBe(2)
  })
})

describe('merge', () => {
  it('merges plain paths into a flat pdf', async () => {
    const out = join(tmp, 'merged.pdf')
    const { io } = collectIo()
    expect(await runCli(['merge', pdf4, pdf4, '-o', out], io)).toBe(EXIT_OK)
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(8)
    expect(await parseManifest(new Uint8Array(await readFile(out)))).toBeNull()
  })

  it('honors #range selectors', async () => {
    const out = join(tmp, 'merged-range.pdf')
    const { io } = collectIo()
    expect(await runCli(['merge', `${pdf4}#1-2`, `${pdf4}#4`, '-o', out], io)).toBe(EXIT_OK)
    expect((await PDFDocument.load(await readFile(out))).getPageCount()).toBe(3)
  })

  it('honors #name selectors against a .pdfx and writes pdfx output by extension', async () => {
    const out = join(tmp, 'merged.pdfx')
    const { io } = collectIo()
    expect(await runCli(['merge', `${bundle}#Beta`, `${pdf4}#1`, '-o', out], io)).toBe(EXIT_OK)
    const manifest = await parseManifest(new Uint8Array(await readFile(out)))
    expect(manifest?.documents).toEqual([
      { name: 'Beta', pages: 1 },
      { name: 'four', pages: 1 }
    ])
  })

  it('unknown #name is an operational error (exit 1)', async () => {
    const { io, err } = collectIo()
    expect(await runCli(['merge', `${bundle}#Nope`, '-o', join(tmp, 'x2.pdfx')], io)).toBe(EXIT_ERROR)
    expect(err.join('\n')).toContain('Nope')
  })
})

describe('assets and -f guard', () => {
  it('assets writes files under outDir and reports counts with --json', async () => {
    const outDir = join(tmp, 'assets-out')
    const { io, out: lines } = collectIo()
    expect(await runCli(['assets', pdf4, '-o', outDir, '--json'], io)).toBe(EXIT_OK)
    const report = JSON.parse(lines.join('\n'))
    expect(report).toHaveProperty('images')
    expect(report).toHaveProperty('attachments')
  })

  it('refuses to overwrite without -f (exit 1), allows with -f', async () => {
    const out = join(tmp, 'rotated.pdf') // exists from the rotate test
    expect(await runCli(['rotate', pdf4, '--angle', '90', '-o', out], collectIo().io)).toBe(EXIT_ERROR)
    expect(await runCli(['rotate', pdf4, '--angle', '90', '-o', out, '-f'], collectIo().io)).toBe(EXIT_OK)
  })
})
