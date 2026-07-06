import { describe, it, expect, afterEach } from 'vitest'
import { watchExtract } from '../src/watch.js'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

async function onePagePdfBytes(): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  return new Uint8Array(await doc.save())
}

// Poll until predicate is true or timeout expires
function waitFor(predicate: () => boolean, timeoutMs = 8000, intervalMs = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const id = setInterval(() => {
      if (predicate()) {
        clearInterval(id)
        resolve()
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(id)
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`))
      }
    }, intervalMs)
  })
}

const tmpDirs: string[] = []
afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('watchExtract', () => {
  it('emits ok NDJSON line and .done marker when a PDF is dropped', async () => {
    const inDir = mkdtempSync(path.join(os.tmpdir(), 'pdfx-watch-in-'))
    const outRoot = mkdtempSync(path.join(os.tmpdir(), 'pdfx-watch-out-'))
    tmpDirs.push(inDir, outRoot)

    const lines: string[] = []
    const stop = await watchExtract(inDir, outRoot, (line) => lines.push(line))

    const pdfPath = path.join(inDir, 'test.pdf')
    const bytes = await onePagePdfBytes()
    writeFileSync(pdfPath, bytes)

    await waitFor(() => lines.length > 0)

    await stop()

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.status).toBe('ok')
    expect(parsed.file).toBe(pdfPath)
    expect(typeof parsed.outDir).toBe('string')

    // .done marker exists next to the source file
    expect(existsSync(pdfPath + '.done')).toBe(true)
  })

  it('emits error NDJSON line for a corrupt file', async () => {
    const inDir = mkdtempSync(path.join(os.tmpdir(), 'pdfx-watch-in2-'))
    const outRoot = mkdtempSync(path.join(os.tmpdir(), 'pdfx-watch-out2-'))
    tmpDirs.push(inDir, outRoot)

    const lines: string[] = []
    const stop = await watchExtract(inDir, outRoot, (line) => lines.push(line))

    const badPath = path.join(inDir, 'bad.pdf')
    writeFileSync(badPath, Buffer.from('not a pdf'))

    await waitFor(() => lines.length > 0)

    await stop()

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.status).toBe('error')
    expect(typeof parsed.error).toBe('string')
    expect(parsed.error.length).toBeGreaterThan(0)
  })

  it('ignores .done marker files (no infinite loop)', async () => {
    const inDir = mkdtempSync(path.join(os.tmpdir(), 'pdfx-watch-in3-'))
    const outRoot = mkdtempSync(path.join(os.tmpdir(), 'pdfx-watch-out3-'))
    tmpDirs.push(inDir, outRoot)

    const lines: string[] = []
    const stop = await watchExtract(inDir, outRoot, (line) => lines.push(line))

    // Drop a .done file — should be silently ignored
    writeFileSync(path.join(inDir, 'already.pdf.done'), '')

    // Give chokidar time to fire any spurious events
    await new Promise<void>((r) => setTimeout(r, 600))
    await stop()

    expect(lines).toHaveLength(0)
  })
})
