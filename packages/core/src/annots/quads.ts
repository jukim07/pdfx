import type { Quad, Rect } from './model.js'

/** Minimal subset of pdfjs TextItem needed to build a quad. */
export interface TextItemLike {
  str: string
  /** [a,b,c,d,e,f]; e,f = baseline origin in PDF user space for an unscaled viewport. */
  transform: number[]
  width: number
  height: number
}

/** Axis-aligned quad in PDF user space (origin bottom-left). Ignores rotation/skew
 *  (transform b,c) — pdfx documents are upright; matches how the search layer treats runs. */
export function itemQuad(item: TextItemLike): Quad {
  const x = item.transform[4]
  const y = item.transform[5]
  const w = item.width
  const h = item.height
  return {
    x1: x, y1: y + h, // upper-left
    x2: x + w, y2: y + h, // upper-right
    x3: x, y3: y, // lower-left
    x4: x + w, y4: y // lower-right
  }
}

export function itemsToQuads(items: TextItemLike[]): Quad[] {
  return items.filter((it) => it.str.trim().length > 0).map(itemQuad)
}

function quadBounds(q: Quad): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = [q.x1, q.x2, q.x3, q.x4]
  const ys = [q.y1, q.y2, q.y3, q.y4]
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

export function quadContains(q: Quad, x: number, y: number): boolean {
  const b = quadBounds(q)
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
}

export function quadsIntersectRect(quads: Quad[], r: Rect): boolean {
  const rMinX = r.x
  const rMaxX = r.x + r.w
  const rMinY = r.y
  const rMaxY = r.y + r.h
  return quads.some((q) => {
    const b = quadBounds(q)
    return b.minX <= rMaxX && b.maxX >= rMinX && b.minY <= rMaxY && b.maxY >= rMinY
  })
}
