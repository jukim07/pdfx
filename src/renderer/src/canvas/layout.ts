import type { DocEntry } from '../types'

export const BASE_PAGE_HEIGHT = 280
export const PAGE_GAP = 18
export const CARD_PAD_X = 16 + 6
const CARD_PAD_TOP = 10
const HEADER_BLOCK = 32
const CARD_PAD_BOTTOM = 14
export const DOC_GAP_Y = 30

const MIN_PAGES = 5
const REF_PAGE_WIDTH = Math.round((BASE_PAGE_HEIGHT * 612) / 792)
export const MIN_DOC_WIDTH =
  MIN_PAGES * REF_PAGE_WIDTH + (MIN_PAGES - 1) * PAGE_GAP + CARD_PAD_X * 2

export const ADD_PAGE_WIDTH = REF_PAGE_WIDTH
const ADD_PAGE_SLOT = PAGE_GAP + ADD_PAGE_WIDTH

export interface DocPlacement {
  doc: DocEntry
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasLayout {
  items: DocPlacement[]
  contentWidth: number
  contentHeight: number
  slotHeight: number
}

export function pageDisplayWidth(width: number, height: number): number {
  return Math.max(6, Math.round((BASE_PAGE_HEIGHT * width) / height))
}

function docWidth(doc: DocEntry): number {
  const pages = doc.pages
  const stripWidth =
    pages.reduce((sum, p) => sum + pageDisplayWidth(p.width, p.height), 0) +
    Math.max(0, pages.length - 1) * PAGE_GAP
  return stripWidth + ADD_PAGE_SLOT + CARD_PAD_X * 2
}

export const DOC_HEIGHT = CARD_PAD_TOP + HEADER_BLOCK + BASE_PAGE_HEIGHT + CARD_PAD_BOTTOM

export function computeLayout(docs: DocEntry[], axisFlip = false): CanvasLayout {
  if (axisFlip) {
    // Horizontal strip: docs placed side-by-side left→right, each with its natural height.
    const heights = docs.map((doc) => {
      const maxPageH = Math.max(...doc.pages.map((p) => pageDisplayWidth(p.width, p.height)), BASE_PAGE_HEIGHT)
      return CARD_PAD_TOP + HEADER_BLOCK + maxPageH + CARD_PAD_BOTTOM
    })
    const contentHeight = Math.max(1, Math.max(...heights, DOC_HEIGHT))

    let x = 0
    const items: DocPlacement[] = docs.map((doc, i) => {
      const w = Math.max(MIN_DOC_WIDTH, docWidth(doc))
      const placement: DocPlacement = { doc, x, y: 0, width: w, height: heights[i] }
      x += w + DOC_GAP_Y // reuse gap constant for horizontal spacing
      return placement
    })

    const contentWidth = Math.max(1, x - DOC_GAP_Y)
    // Add an extra slot-width so the "add doc" ghost has room.
    const slotHeight = contentHeight + DOC_GAP_Y
    return { items, contentWidth: contentWidth + DOC_GAP_Y + MIN_DOC_WIDTH, contentHeight, slotHeight }
  }

  // Original vertical layout: docs stacked top→bottom.
  const widths = docs.map((doc) => Math.max(MIN_DOC_WIDTH, docWidth(doc)))
  const contentWidth = Math.max(1, ...widths)

  let y = 0
  const items: DocPlacement[] = docs.map((doc, i) => {
    const placement: DocPlacement = {
      doc,
      x: 0,
      y,
      width: widths[i],
      height: DOC_HEIGHT
    }
    y += DOC_HEIGHT + DOC_GAP_Y
    return placement
  })

  let contentHeight = Math.max(1, y - DOC_GAP_Y)
  if (docs.length > 0) contentHeight += DOC_GAP_Y + DOC_HEIGHT
  return { items, contentWidth, contentHeight, slotHeight: DOC_HEIGHT + DOC_GAP_Y }
}

export const DOC_SLOT = DOC_HEIGHT + DOC_GAP_Y

export { computeDropTarget, betweenSlotY } from './drop-target'
export type { DropTarget } from './drop-target'
