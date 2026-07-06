import { describe, it, expect } from 'vitest'
import { itemQuad, itemsToQuads, quadContains, quadsIntersectRect } from '../../src/annots/quads.js'

describe('quads', () => {
  it('maps a TextItem transform+width+height to a PDF-space quad (bottom-left origin)', () => {
    // origin at (100, 700) baseline, 50 wide, 12 tall
    const q = itemQuad({ str: 'Hello', transform: [12, 0, 0, 12, 100, 700], width: 50, height: 12 })
    // upper-left
    expect(q.x1).toBe(100)
    expect(q.y1).toBe(712)
    // upper-right
    expect(q.x2).toBe(150)
    expect(q.y2).toBe(712)
    // lower-left
    expect(q.x3).toBe(100)
    expect(q.y3).toBe(700)
    // lower-right
    expect(q.x4).toBe(150)
    expect(q.y4).toBe(700)
  })

  it('builds one quad per item', () => {
    const quads = itemsToQuads([
      { str: 'a', transform: [10, 0, 0, 10, 0, 0], width: 5, height: 10 },
      { str: 'b', transform: [10, 0, 0, 10, 20, 0], width: 5, height: 10 }
    ])
    expect(quads).toHaveLength(2)
  })

  it('point-in-quad', () => {
    const q = itemQuad({ str: 'x', transform: [1, 0, 0, 1, 0, 0], width: 10, height: 10 })
    expect(quadContains(q, 5, 5)).toBe(true)
    expect(quadContains(q, 15, 5)).toBe(false)
  })

  it('quads intersect rect', () => {
    const quads = itemsToQuads([{ str: 'x', transform: [1, 0, 0, 1, 0, 0], width: 10, height: 10 }])
    expect(quadsIntersectRect(quads, { x: 5, y: 5, w: 20, h: 20 })).toBe(true)
    expect(quadsIntersectRect(quads, { x: 50, y: 50, w: 5, h: 5 })).toBe(false)
  })
})
