import { describe, it, expect } from 'vitest'
import { computeLayout, DOC_HEIGHT, DOC_GAP_Y, MIN_DOC_WIDTH } from './layout'
import { computeDropTarget, betweenSlotPos } from './drop-target'
import type { DocEntry } from '../types'

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

const LETTER = { width: 612, height: 792 }

// Two-doc layout fixtures
const docsAB = [makeDoc('a', [LETTER]), makeDoc('b', [LETTER])]

describe('computeDropTarget — default mode (axisFlip=false) regression pin', () => {
  const layout = computeLayout(docsAB, false)
  const [itemA, itemB] = layout.items
  const scale = 1

  it('into: worldY inside doc A returns kind=into with docId=a', () => {
    const midY = itemA.y + DOC_HEIGHT / 2
    const result = computeDropTarget(layout, itemA.x + MIN_DOC_WIDTH / 2, midY, scale, null, true, false)
    expect(result.kind).toBe('into')
    if (result.kind === 'into') expect(result.docId).toBe('a')
  })

  it('into: worldY inside doc B returns kind=into with docId=b', () => {
    const midY = itemB.y + DOC_HEIGHT / 2
    const result = computeDropTarget(layout, itemB.x + MIN_DOC_WIDTH / 2, midY, scale, null, true, false)
    expect(result.kind).toBe('into')
    if (result.kind === 'into') expect(result.docId).toBe('b')
  })

  it('between: worldY above midpoint of doc A → docIndex=0', () => {
    // Y before the midpoint of the first doc
    const result = computeDropTarget(layout, 0, itemA.y - 1, scale, null, false, false)
    expect(result.kind).toBe('between')
    if (result.kind === 'between') expect(result.docIndex).toBe(0)
  })

  it('between: worldY between docs → docIndex=1', () => {
    // Y in the gap between doc A and doc B
    const gapY = itemA.y + DOC_HEIGHT + DOC_GAP_Y / 2
    const result = computeDropTarget(layout, 0, gapY, scale, null, false, false)
    expect(result.kind).toBe('between')
    if (result.kind === 'between') expect(result.docIndex).toBe(1)
  })

  it('between: worldY below both docs → docIndex=2', () => {
    const result = computeDropTarget(layout, 0, itemB.y + DOC_HEIGHT + 1, scale, null, false, false)
    expect(result.kind).toBe('between')
    if (result.kind === 'between') expect(result.docIndex).toBe(2)
  })
})

describe('computeDropTarget — flipped mode (axisFlip=true)', () => {
  const layout = computeLayout(docsAB, true)
  const [itemA, itemB] = layout.items
  const scale = 1

  it('into: worldX over second doc returns kind=into with docId=b (not a)', () => {
    // X is clearly over doc B's range; Y is within valid row
    const midX = itemB.x + itemB.width / 2
    const midY = itemB.y + itemB.height / 2
    const result = computeDropTarget(layout, midX, midY, scale, null, true, true)
    expect(result.kind).toBe('into')
    if (result.kind === 'into') expect(result.docId).toBe('b')
  })

  it('into: worldX over first doc returns kind=into with docId=a', () => {
    const midX = itemA.x + itemA.width / 2
    const midY = itemA.y + itemA.height / 2
    const result = computeDropTarget(layout, midX, midY, scale, null, true, true)
    expect(result.kind).toBe('into')
    if (result.kind === 'into') expect(result.docId).toBe('a')
  })

  it('between: worldX before doc A midpoint → docIndex=0', () => {
    const result = computeDropTarget(layout, itemA.x - 1, itemA.y, scale, null, false, true)
    expect(result.kind).toBe('between')
    if (result.kind === 'between') expect(result.docIndex).toBe(0)
  })

  it('between: worldX between doc A and B (past A midpoint) → docIndex=1', () => {
    // X in the gap between doc A and doc B
    const gapX = itemA.x + itemA.width + DOC_GAP_Y / 2
    const result = computeDropTarget(layout, gapX, itemA.y, scale, null, false, true)
    expect(result.kind).toBe('between')
    if (result.kind === 'between') expect(result.docIndex).toBe(1)
  })

  it('between: worldX past both docs → docIndex=2', () => {
    const result = computeDropTarget(layout, itemB.x + itemB.width + 1, itemB.y, scale, null, false, true)
    expect(result.kind).toBe('between')
    if (result.kind === 'between') expect(result.docIndex).toBe(2)
  })
})

describe('betweenSlotPos — default mode (axisFlip=false)', () => {
  const layout = computeLayout(docsAB, false)
  const [itemA, itemB] = layout.items

  it('docIndex=0 → y at item 0 y, x=0', () => {
    const pos = betweenSlotPos(layout, 0, false)
    expect(pos.y).toBe(itemA.y)
    expect(pos.x).toBe(0)
  })

  it('docIndex=1 → y at item 1 y, x=0', () => {
    const pos = betweenSlotPos(layout, 1, false)
    expect(pos.y).toBe(itemB.y)
    expect(pos.x).toBe(0)
  })

  it('docIndex=2 (past end) → y past last doc, x=0', () => {
    const pos = betweenSlotPos(layout, 2, false)
    expect(pos.y).toBeGreaterThan(itemB.y)
    expect(pos.x).toBe(0)
  })
})

describe('betweenSlotPos — flipped mode (axisFlip=true)', () => {
  const layout = computeLayout(docsAB, true)
  const [itemA, itemB] = layout.items

  it('docIndex=0 → x at item 0 x, y=0', () => {
    const pos = betweenSlotPos(layout, 0, true)
    expect(pos.x).toBe(itemA.x)
    expect(pos.y).toBe(0)
  })

  it('docIndex=1 → x at item 1 x (advancing), y=0', () => {
    const pos = betweenSlotPos(layout, 1, true)
    expect(pos.x).toBe(itemB.x)
    expect(pos.y).toBe(0)
  })

  it('docIndex=2 (past end) → x past last doc, y=0', () => {
    const pos = betweenSlotPos(layout, 2, true)
    expect(pos.x).toBeGreaterThan(itemB.x)
    expect(pos.y).toBe(0)
  })
})
