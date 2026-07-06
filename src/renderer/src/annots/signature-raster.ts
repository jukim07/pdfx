import { createCanvas } from '@napi-rs/canvas'

export interface Stroke {
  /** Flat [x1,y1,x2,y2,...] in canvas pixels. */
  points: number[]
}

/** Rasterize freehand strokes to PNG bytes on a transparent background.
 *  Used by the headless/test path; the DOM SignaturePad uses the same
 *  canvas ops against an HTMLCanvasElement directly. */
export async function rasterizeSignature(
  strokes: Stroke[],
  width: number,
  height: number
): Promise<Uint8Array> {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#111111'
  for (const s of strokes) {
    if (s.points.length < 4) continue
    ctx.beginPath()
    ctx.moveTo(s.points[0], s.points[1])
    for (let i = 2; i + 1 < s.points.length; i += 2) ctx.lineTo(s.points[i], s.points[i + 1])
    ctx.stroke()
  }
  const buf = await canvas.encode('png')
  return new Uint8Array(buf)
}
