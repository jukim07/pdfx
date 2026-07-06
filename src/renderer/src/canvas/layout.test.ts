import { describe, it, expect } from 'vitest'
import {
  computeLayout,
  DOC_HEIGHT,
  DOC_GAP_Y,
  MIN_DOC_WIDTH
} from './layout'
import type { DocEntry } from '../types'

// Minimal fixture that satisfies DocEntry without a real PdfSource/PDFDocumentProxy.
// pageDisplayWidth uses page.width and page.height; other fields are not touched by layout.
function makeDoc(id: string, pages: { width: number; height: number }[]): DocEntry {
  return {
    id,
    name: id,
    pages: pages.map((p, i) => ({
      id: `${id}-p${i}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      source: {} as any,
      pageIndex: i,
      width: p.width,
      height: p.height
    }))
  }
}

// Standard letter-ratio page (612×792) used in most tests.
const LETTER = { width: 612, height: 792 }

describe('computeLayout — vertical (default, axisFlip=false)', () => {
  it('empty docs → valid empty layout', () => {
    const layout = computeLayout([])
    expect(layout.items).toHaveLength(0)
    expect(layout.contentWidth).toBeGreaterThanOrEqual(1)
    expect(layout.contentHeight).toBeGreaterThanOrEqual(1)
  })

  it('single doc: x=0, y=0, height=DOC_HEIGHT, width≥MIN_DOC_WIDTH', () => {
    const doc = makeDoc('a', [LETTER])
    const layout = computeLayout([doc])
    expect(layout.items).toHaveLength(1)
    const item = layout.items[0]
    expect(item.x).toBe(0)
    expect(item.y).toBe(0)
    expect(item.height).toBe(DOC_HEIGHT)
    expect(item.width).toBeGreaterThanOrEqual(MIN_DOC_WIDTH)
  })

  it('two docs: stacked vertically (y increases, x stays 0)', () => {
    const docA = makeDoc('a', [LETTER])
    const docB = makeDoc('b', [LETTER])
    const layout = computeLayout([docA, docB])
    expect(layout.items).toHaveLength(2)
    expect(layout.items[0].x).toBe(0)
    expect(layout.items[1].x).toBe(0)
    // Second doc should be below the first
    expect(layout.items[1].y).toBeGreaterThan(layout.items[0].y)
    expect(layout.items[1].y).toBe(DOC_HEIGHT + DOC_GAP_Y)
  })

  it('contentHeight grows to include a trailing ghost slot', () => {
    const doc = makeDoc('a', [LETTER])
    const layout = computeLayout([doc])
    // original layout adds DOC_GAP_Y + DOC_HEIGHT for the ghost slot
    expect(layout.contentHeight).toBeGreaterThan(DOC_HEIGHT)
  })
})

describe('computeLayout — horizontal strip (axisFlip=true)', () => {
  it('empty docs → valid empty layout', () => {
    const layout = computeLayout([], true)
    expect(layout.items).toHaveLength(0)
    expect(layout.contentWidth).toBeGreaterThanOrEqual(1)
    expect(layout.contentHeight).toBeGreaterThanOrEqual(1)
  })

  it('single doc: y=0, x=0, width≥MIN_DOC_WIDTH', () => {
    const doc = makeDoc('a', [LETTER])
    const layout = computeLayout([doc], true)
    expect(layout.items).toHaveLength(1)
    const item = layout.items[0]
    expect(item.y).toBe(0)
    expect(item.x).toBe(0)
    expect(item.width).toBeGreaterThanOrEqual(MIN_DOC_WIDTH)
  })

  it('two docs: placed side-by-side (x increases, y stays 0)', () => {
    const docA = makeDoc('a', [LETTER])
    const docB = makeDoc('b', [LETTER])
    const layout = computeLayout([docA, docB], true)
    expect(layout.items).toHaveLength(2)
    expect(layout.items[0].y).toBe(0)
    expect(layout.items[1].y).toBe(0)
    // Second doc should be to the right of the first
    expect(layout.items[1].x).toBeGreaterThan(layout.items[0].x)
    expect(layout.items[1].x).toBe(layout.items[0].width + DOC_GAP_Y)
  })

  it('contentWidth includes room for a trailing ghost slot', () => {
    const doc = makeDoc('a', [LETTER])
    const layout = computeLayout([doc], true)
    // spec: contentWidth = contentWidth + DOC_GAP_Y + MIN_DOC_WIDTH
    expect(layout.contentWidth).toBeGreaterThan(MIN_DOC_WIDTH)
  })
})

describe('computeLayout — axis flip transposes layout axes', () => {
  it('default layout: docs differ in y, not x', () => {
    const docs = [makeDoc('a', [LETTER]), makeDoc('b', [LETTER])]
    const layout = computeLayout(docs, false)
    expect(layout.items[0].x).toBe(layout.items[1].x) // both at x=0
    expect(layout.items[0].y).not.toBe(layout.items[1].y)
  })

  it('axisFlip=true: docs differ in x, not y', () => {
    const docs = [makeDoc('a', [LETTER]), makeDoc('b', [LETTER])]
    const layout = computeLayout(docs, true)
    expect(layout.items[0].y).toBe(layout.items[1].y) // both at y=0
    expect(layout.items[0].x).not.toBe(layout.items[1].x)
  })

  it('doc placements are not the same between default and flipped for 2-doc fixture', () => {
    const docs = [makeDoc('a', [LETTER]), makeDoc('b', [LETTER])]
    const def = computeLayout(docs, false)
    const flipped = computeLayout(docs, true)
    // At minimum the second doc's position must differ between the two modes
    expect(flipped.items[1]).not.toEqual(def.items[1])
  })
})
