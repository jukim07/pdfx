import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { extractText } from '../src/extract/text.js'
import { renderPages } from '../src/extract/render.js'
import { createOcrEngine } from '../src/extract/ocr.js'

async function imageOnlyPdf(word: string): Promise<Uint8Array> {
  const canvas = createCanvas(360, 120)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, 360, 120)
  ctx.fillStyle = 'black'
  ctx.font = '48px sans-serif'
  ctx.fillText(word, 20, 80)
  const png = canvas.encodeSync('png')
  const doc = await PDFDocument.create()
  const image = await doc.embedPng(png)
  const page = doc.addPage([360, 120])
  page.drawImage(image, { x: 0, y: 0, width: 360, height: 120 })
  return doc.save()
}

describe('createOcrEngine', () => {
  it('recognizes text on an image-only page that has no native text', async () => {
    const bytes = await imageOnlyPdf('HELLO')

    // Fixture sanity: zero native text, so OCR is the only possible source.
    const [pageText] = await extractText(bytes)
    expect(pageText.text.trim()).toBe('')

    const engine = await createOcrEngine('eng')
    try {
      let png: Uint8Array | null = null
      for await (const entry of renderPages(bytes, { dpi: 150 })) png = entry.png
      const text = await engine.recognize(png!)
      expect(text).toContain('HELLO')
    } finally {
      await engine.terminate()
    }
  }, 120_000)
})
