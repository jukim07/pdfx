import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { redactRegions } from '../../src/ops/redact.js'
import { renderPages } from '../../src/extract/render.js'
import type { RedactRegion } from '../../src/ops/redact-model.js'

// Build a 1-page PDF with a single high-contrast text run in a known rect.
async function makeTextPdf(): Promise<{ bytes: Uint8Array; region: RedactRegion }> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText('SECRETWORD', {
    x: 100,
    y: 600,
    size: 36,
    font,
    color: rgb(0, 0, 0),
  })
  const bytes = await doc.save()
  // Region covers the text; PDF origin is bottom-left.
  const region: RedactRegion = { page: 0, rect: { x: 90, y: 590, w: 250, h: 50 } }
  return { bytes, region }
}

/** Compute luminance stddev of the region in a rasterized page PNG. */
async function regionLuminanceStddev(
  pageBytes: Uint8Array,
  region: RedactRegion,
  dpi: number,
): Promise<number> {
  const targetPage = region.page + 1
  let pagePng: Uint8Array | null = null
  for await (const { page, png } of renderPages(pageBytes, { dpi, pages: [targetPage] })) {
    if (page === targetPage) pagePng = png
  }
  if (!pagePng) throw new Error(`renderPages returned no raster for page ${region.page}`)

  const img = await loadImage(Buffer.from(pagePng))
  // PDF points → raster pixels
  const scale = img.width / 612
  const rx = Math.floor(region.rect.x * scale)
  // PDF y-origin is bottom-left; raster y-origin is top-left.
  const ry = Math.floor((792 - region.rect.y - region.rect.h) * scale)
  const rw = Math.ceil(region.rect.w * scale)
  const rh = Math.ceil(region.rect.h * scale)

  const canvas = createCanvas(rw, rh)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh)
  const { data } = ctx.getImageData(0, 0, rw, rh)

  const luminances: number[] = []
  for (let i = 0; i < data.length; i += 4) {
    luminances.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
  }
  const mean = luminances.reduce((s, v) => s + v, 0) / luminances.length
  return Math.sqrt(luminances.reduce((s, v) => s + (v - mean) ** 2, 0) / luminances.length)
}

describe('redactRegions blur — post-surgery source', () => {
  it('blurred region near-uniform when all content removed by surgery', async () => {
    const { bytes, region } = await makeTextPdf()
    const dpi = 72

    const result = await redactRegions(bytes, [region], { mode: 'blur', dpi })

    const stddev = await regionLuminanceStddev(result, region, dpi)

    // Post-surgery blur: the region rasterizes an empty (white) background, so
    // blurred pixels are nearly uniform. Pure white = stddev 0; glyph-bearing
    // blur yields ~40–80. Threshold 15 is conservative — separation is large.
    //
    // If this threshold is ever flaky it means the blur is rasterizing pre-surgery
    // bytes (contains glyph energy). Tighten by comparing against a known
    // pre-surgery stddev rather than an absolute constant.
    expect(stddev).toBeLessThan(15)
  }, 30_000)
})
