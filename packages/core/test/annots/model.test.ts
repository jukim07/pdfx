import { describe, it, expect } from 'vitest'
import type { Annot, Quad, Rect, RGB, PageAnnots } from '../../src/annots/model.js'
import { isMarkup, EMPTY_PAGE_ANNOTS } from '../../src/annots/model.js'

describe('annot model', () => {
  it('narrows markup annots by type', () => {
    const hl: Annot = {
      type: 'highlight',
      page: 0,
      quads: [{ x1: 10, y1: 100, x2: 60, y2: 100, x3: 10, y3: 90, x4: 60, y4: 90 }],
      color: { r: 1, g: 0.83, b: 0.29 }
    }
    expect(isMarkup(hl)).toBe(true)
    const note: Annot = {
      type: 'note',
      page: 0,
      rect: { x: 10, y: 10, w: 20, h: 20 },
      color: { r: 1, g: 1, b: 0 },
      contents: 'hi'
    }
    expect(isMarkup(note)).toBe(false)
  })

  it('exposes an empty page-annots factory keyed by page', () => {
    const pa: PageAnnots = EMPTY_PAGE_ANNOTS(3)
    expect(pa).toEqual({ page: 3, annots: [] })
  })
})
