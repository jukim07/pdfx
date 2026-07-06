import type { DocPlacement, CanvasLayout } from './layout'
import { DOC_HEIGHT, DOC_SLOT, CARD_PAD_X, PAGE_GAP, pageDisplayWidth } from './layout'

export type DropTarget =
  | { kind: 'into'; docId: string; index: number }
  | { kind: 'between'; docIndex: number }

const INTO_MIN_SCREEN_PX = 90

function insertionIndexInStrip(item: DocPlacement, wx: number, excludeId: string | null): number {
  let x = item.x + CARD_PAD_X
  let index = 0
  for (const page of item.doc.pages) {
    if (page.id === excludeId) continue
    const w = pageDisplayWidth(page.width, page.height)
    if (wx <= x + w / 2) return index
    index++
    x += w + PAGE_GAP
  }
  return index
}

export function computeDropTarget(
  layout: CanvasLayout,
  worldX: number,
  worldY: number,
  scale: number,
  excludeId: string | null,
  allowInto: boolean,
  axisFlip = false
): DropTarget {
  const items = layout.items

  if (axisFlip) {
    // Horizontal strip: docs advance in X; doc height may vary per item.
    if (allowInto && DOC_HEIGHT * scale >= INTO_MIN_SCREEN_PX) {
      for (const item of items) {
        if (
          worldX >= item.x && worldX <= item.x + item.width &&
          worldY >= item.y && worldY <= item.y + item.height
        ) {
          return {
            kind: 'into',
            docId: item.doc.id,
            index: insertionIndexInStrip(item, worldX, excludeId)
          }
        }
      }
    }
    let docIndex = 0
    for (const item of items) {
      if (item.x + item.width / 2 < worldX) docIndex++
    }
    return { kind: 'between', docIndex }
  }

  // Default vertical layout: docs advance in Y.
  if (allowInto && DOC_HEIGHT * scale >= INTO_MIN_SCREEN_PX) {
    for (const item of items) {
      if (worldY >= item.y && worldY <= item.y + DOC_HEIGHT) {
        return {
          kind: 'into',
          docId: item.doc.id,
          index: insertionIndexInStrip(item, worldX, excludeId)
        }
      }
    }
  }
  let docIndex = 0
  for (const item of items) {
    if (item.y + DOC_HEIGHT / 2 < worldY) docIndex++
  }
  return { kind: 'between', docIndex }
}

/** Axis-aware slot position for the between-doc ghost and AddDocGhost. */
export function betweenSlotPos(
  layout: CanvasLayout,
  docIndex: number,
  axisFlip: boolean
): { x: number; y: number } {
  const items = layout.items
  if (axisFlip) {
    if (items.length === 0) return { x: 0, y: 0 }
    if (docIndex >= items.length) {
      const last = items[items.length - 1]
      return { x: last.x + last.width + DOC_SLOT, y: 0 }
    }
    return { x: items[docIndex].x, y: 0 }
  }
  // Default (vertical): advancing Y.
  if (items.length === 0) return { x: 0, y: 0 }
  if (docIndex >= items.length) return { x: 0, y: items[items.length - 1].y + DOC_SLOT }
  return { x: 0, y: items[docIndex].y }
}

/** @deprecated Use betweenSlotPos(layout, docIndex, false).y for default-mode callers. */
export function betweenSlotY(layout: CanvasLayout, docIndex: number): number {
  return betweenSlotPos(layout, docIndex, false).y
}
