import type { Rect } from '@pdfx/core'

export interface PctRect {
  leftPct: number
  topPct: number
  wPct: number
  hPct: number
}

/**
 * Screen overlay uses top-left origin, y-down, percentages of page box.
 * PDF user space uses bottom-left origin, y-up, absolute points.
 * Converts from screen percentage rect to PDF Rect.
 */
export function pctRectToPdf(p: PctRect, pageW: number, pageH: number): Rect {
  const x = p.leftPct * pageW
  const w = p.wPct * pageW
  const h = p.hPct * pageH
  const topFromTop = p.topPct * pageH
  const y = pageH - topFromTop - h
  return { x, y, w, h }
}
