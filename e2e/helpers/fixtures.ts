import { PDFDocument, StandardFonts } from 'pdf-lib'
import { deflateSync } from 'zlib'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export const SENTINEL = 'The quick brown fox audits the ledger'

export interface Fixtures {
  dir: string
  reportPdf: string
  statementPdf: string
  photoPng: string
  notesTxt: string
}

export async function makeFixtures(): Promise<Fixtures> {
  const dir = await mkdtemp(join(tmpdir(), 'pdfx-fixtures-'))
  const reportPdf = join(dir, 'report.pdf')
  const statementPdf = join(dir, 'statement.pdf')
  const photoPng = join(dir, 'photo.png')
  const notesTxt = join(dir, 'notes.txt')
  await writeFile(reportPdf, await makeReportPdf())
  await writeFile(statementPdf, await makeStatementPdf())
  await writeFile(photoPng, makePng(64, 64, [200, 40, 40]))
  await writeFile(notesTxt, 'PDFX e2e text import fixture.\nSecond line of the note.\n')
  return { dir, reportPdf, statementPdf, photoPng, notesTxt }
}

async function makeReportPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages: string[][] = [
    ['PDFX E2E REPORT', SENTINEL, 'Page one body text.'],
    ['Chapter Two', 'A kangaroo appears only on this page.'],
    ['Chapter Three', 'Closing remarks without marsupials.']
  ]
  for (const lines of pages) {
    const page = doc.addPage([612, 792])
    lines.forEach((line, i) => page.drawText(line, { x: 72, y: 700 - i * 24, size: 14, font }))
  }
  return doc.save()
}

async function makeStatementPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= 4; n++) {
    const page = doc.addPage([612, 792])
    page.drawText(`STATEMENT — page ${n}`, { x: 72, y: 720, size: 16, font })
    for (let i = 0; i < 10; i++) {
      page.drawText(
        `2026-06-${String(i + 1).padStart(2, '0')}  Transaction ${i + 1}  $${(n * 100 + i).toFixed(2)}`,
        { x: 72, y: 660 - i * 54, size: 11, font } // lowest body line: y = 174
      )
    }
    page.drawText(`CONFIDENTIAL footer — page ${n}`, { x: 72, y: 30, size: 10, font })
  }
  return doc.save()
}

/** Minimal valid truecolor PNG (no interlace, filter 0) — avoids a canvas dependency. */
export function makePng(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  const raw = new Uint8Array(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = r
      raw[row + 1 + x * 3 + 1] = g
      raw[row + 1 + x * 3 + 2] = b
    }
  }
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))]
  const png = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let off = 0
  for (const p of parts) {
    png.set(p, off)
    off += p.length
  }
  return png
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
