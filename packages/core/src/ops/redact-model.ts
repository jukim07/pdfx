import type { Quad, Rect } from '../annots/model.js'

/** page is 0-based; rect is PDF user space, origin bottom-left (same as annots). */
export interface RedactRegion {
  page: number
  rect: Rect
}

export type RedactMode = 'black' | 'blur' | 'rasterize'

export interface RedactOptions {
  mode: RedactMode
  /** raster dpi for blur/rasterize modes; default 150 (blur) / 300 (rasterize). */
  dpi?: number
}

/** Selection quads -> one padded region per quad bounding box. */
export function regionsFromQuads(page: number, quads: Quad[], padding = 0): RedactRegion[] {
  return quads.map((q) => {
    const xs = [q.x1, q.x2, q.x3, q.x4]
    const ys = [q.y1, q.y2, q.y3, q.y4]
    const minX = Math.min(...xs) - padding
    const minY = Math.min(...ys) - padding
    return {
      page,
      rect: {
        x: minX,
        y: minY,
        w: Math.max(...xs) + padding - minX,
        h: Math.max(...ys) + padding - minY
      }
    }
  })
}

/** Thrown when content-stream surgery cannot guarantee removal. NEVER swallow this:
 *  the caller must re-run with mode 'rasterize'. */
export class StreamSurgeryError extends Error {
  readonly page: number
  constructor(page: number, reason: string) {
    super(`stream surgery failed on page ${page}: ${reason}. Re-run with --rasterize.`)
    this.name = 'StreamSurgeryError'
    this.page = page
  }
}
