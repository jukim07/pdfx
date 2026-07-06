import { PDFDocument } from 'pdf-lib'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { renderPages } from '../extract/render.js'
import type { RedactRegion, RedactOptions } from './redact-model.js'

/** Replace each affected page with a high-DPI raster of itself, black boxes burned in.
 *  Escape hatch for StreamSurgeryError; explicit flag only. */
export async function rasterizeRedact(
  bytes: Uint8Array,
  regions: RedactRegion[],
  opts: RedactOptions,
): Promise<Uint8Array> {
  const dpi = opts.dpi ?? 300
  // Unique 0-based page indices that have at least one region.
  const pageSet = [...new Set(regions.map((r) => r.page))]

  const doc = await PDFDocument.load(bytes)

  // Render all affected pages at once. renderPages is 1-based; regions are 0-based.
  const rasters = new Map<number, Uint8Array>()
  for await (const { page, png } of renderPages(bytes, { dpi, pages: pageSet.map((p) => p + 1) })) {
    // page is 1-based; store under 0-based key to match pageIndex below.
    rasters.set(page - 1, png)
  }

  for (const pageIndex of pageSet) {
    const page = doc.getPages()[pageIndex]
    if (!page) throw new Error(`region references page ${pageIndex} but doc has ${doc.getPageCount()} pages`)
    const { width, height } = page.getSize()

    const png = rasters.get(pageIndex)
    if (!png) throw new Error(`renderPages returned no raster for page ${pageIndex}`)

    // Draw the full page raster into a canvas, then burn black boxes over each region.
    const img = await loadImage(Buffer.from(png))
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    ctx.fillStyle = '#000'

    // PDF coordinate origin is bottom-left; canvas origin is top-left.
    const scale = img.width / width
    for (const r of regions.filter((x) => x.page === pageIndex)) {
      ctx.fillRect(
        r.rect.x * scale,
        (height - r.rect.y - r.rect.h) * scale,
        r.rect.w * scale,
        r.rect.h * scale,
      )
    }
    const burned = new Uint8Array(await canvas.encode('png'))

    // Swap out the original page for an image-only page of the same dimensions.
    doc.removePage(pageIndex)
    const fresh = doc.insertPage(pageIndex, [width, height])
    const embedded = await doc.embedPng(burned)
    fresh.drawImage(embedded, { x: 0, y: 0, width, height })
  }

  return doc.save()
}
