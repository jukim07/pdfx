import { createCanvas, loadImage } from '@napi-rs/canvas'
import { renderPages } from '../extract/render.js'
import type { RedactRegion } from './redact-model.js'

/** One box-blur pass along one axis for all four RGBA channels. */
function boxPass(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean,
): void {
  const lineLen = horizontal ? w : h
  const lines = horizontal ? h : w
  const win = radius * 2 + 1
  for (let line = 0; line < lines; line++) {
    for (let ch = 0; ch < 4; ch++) {
      const idx = (i: number): number =>
        horizontal ? (line * w + i) * 4 + ch : (i * w + line) * 4 + ch
      let sum = 0
      // Prime sliding window with clamped-edge padding.
      for (let i = -radius; i <= radius; i++) {
        sum += src[idx(Math.min(lineLen - 1, Math.max(0, i)))]
      }
      for (let i = 0; i < lineLen; i++) {
        dst[idx(i)] = Math.round(sum / win)
        const outI = Math.max(0, i - radius)
        const inI = Math.min(lineLen - 1, i + radius + 1)
        sum += src[idx(inI)] - src[idx(outI)]
      }
    }
  }
}

/**
 * 3 iterated box blurs ≈ gaussian (in-place, RGBA).
 * Deterministic — no CSS filter dependency.
 */
export function boxBlur3(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
): void {
  const tmp = new Uint8ClampedArray(data.length)
  for (let pass = 0; pass < 3; pass++) {
    boxPass(data, tmp, w, h, radius, true)
    boxPass(tmp, data, w, h, radius, false)
  }
}

/**
 * Raster the redaction region from POST-surgery page bytes, apply box-blur ×3,
 * and return a PNG crop sized to the region.
 *
 * @param postSurgeryBytes  Post-surgery PDF bytes — blur renders only content
 *                          that survived text removal, so blurred pixels contain
 *                          no recoverable glyph information.
 * @param region            0-based page index + PDF-space rect (origin bottom-left).
 * @param pageWidthPt       PDF page width in points (from pdf-lib page.getSize()).
 * @param pageHeightPt      PDF page height in points.
 * @param dpi               Raster resolution; default 150.
 */
export async function blurredRegionPng(
  postSurgeryBytes: Uint8Array,
  region: RedactRegion,
  pageWidthPt: number,
  pageHeightPt: number,
  dpi = 150,
): Promise<Uint8Array> {
  // renderPages is 1-based; RedactRegion.page is 0-based.
  const targetPage = region.page + 1
  let pagePng: Uint8Array | null = null
  for await (const { page, png } of renderPages(postSurgeryBytes, { dpi, pages: [targetPage] })) {
    if (page === targetPage) pagePng = png
  }
  if (!pagePng) throw new Error(`renderPages returned no raster for page ${region.page}`)

  const img = await loadImage(Buffer.from(pagePng))
  // raster px per PDF point
  const scale = img.width / pageWidthPt

  // PDF coordinate origin is bottom-left; raster origin is top-left.
  const rx = Math.floor(region.rect.x * scale)
  const rw = Math.max(1, Math.ceil(region.rect.w * scale))
  const rh = Math.max(1, Math.ceil(region.rect.h * scale))
  const ry = Math.floor((pageHeightPt - region.rect.y - region.rect.h) * scale)

  const canvas = createCanvas(rw, rh)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, rx, ry, rw, rh, 0, 0, rw, rh)
  const imageData = ctx.getImageData(0, 0, rw, rh)
  boxBlur3(imageData.data, rw, rh, Math.max(4, Math.round(dpi / 12)))
  ctx.putImageData(imageData, 0, 0)
  return new Uint8Array(await canvas.encode('png'))
}
