import { useRef, useState, useCallback } from 'react'
import type { Annot, Quad, Rect, RedactRegion } from '@pdfx/core'
import type { PageEntry } from '../types'
import type { AnnotTool } from './useAnnotTool'
import { pctRectToPdf } from './geometry'

interface AnnotOverlayProps {
  page: PageEntry
  tool: AnnotTool
  /** Called with the finished annot and the id of the source PDF the page belongs to. */
  onCommit: (a: Annot, sourceId: string) => void
  /** PNG bytes for the stamp tool; required when tool === 'stamp'. */
  stampPng?: Uint8Array
  /** Called when a redact region is drawn; receives the region and the owning sourceId. */
  onRedactDraft?: (r: RedactRegion, sourceId: string) => void
}

type DragState = { startX: number; startY: number; curX: number; curY: number }

const HIGHLIGHT_COLOR = { r: 1, g: 0.83, b: 0.29 }
const NOTE_COLOR = { r: 1, g: 0.84, b: 0 }

function rectToQuad(r: Rect): Quad {
  // PDF quad: UL, UR, LL, LR (y-up)
  return {
    x1: r.x,         y1: r.y + r.h, // upper-left
    x2: r.x + r.w,   y2: r.y + r.h, // upper-right
    x3: r.x,         y3: r.y,       // lower-left
    x4: r.x + r.w,   y4: r.y        // lower-right
  }
}

export function AnnotOverlay({ page, tool, onCommit, stampPng, onRedactDraft }: AnnotOverlayProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null)
  // Mirror drag state in ref to avoid stale-closure bug on fast pointer up (same pattern as CropOverlay).
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const toFrac = useCallback((clientX: number, clientY: number): { fx: number; fy: number } => {
    const rect = containerRef.current!.getBoundingClientRect()
    return {
      fx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      fy: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const { fx, fy } = toFrac(e.clientX, e.clientY)
    const next: DragState = { startX: fx, startY: fy, curX: fx, curY: fy }
    dragRef.current = next
    setDrag(next)
  }, [toFrac])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const { fx, fy } = toFrac(e.clientX, e.clientY)
    setDrag((d) => {
      if (!d) return null
      const next = { ...d, curX: fx, curY: fy }
      dragRef.current = next
      return next
    })
  }, [toFrac])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    const { fx, fy } = toFrac(e.clientX, e.clientY)

    const leftPct = Math.min(d.startX, fx)
    const topPct = Math.min(d.startY, fy)
    const wPct = Math.abs(fx - d.startX)
    const hPct = Math.abs(fy - d.startY)
    setDrag(null)

    // Ignore clicks with negligible area
    if (wPct < 0.01 || hPct < 0.01) return

    const pdfRect = pctRectToPdf({ leftPct, topPct, wPct, hPct }, page.width, page.height)

    const sourceId = page.source.id
    if (tool === 'redact') {
      onRedactDraft?.({ page: page.pageIndex, rect: pdfRect }, sourceId)
      return
    }
    if (tool === 'stamp' && stampPng) {
      onCommit({
        type: 'stamp',
        page: page.pageIndex,
        rect: pdfRect,
        png: stampPng
      }, sourceId)
    } else if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
      const quad = rectToQuad(pdfRect)
      onCommit({
        type: tool,
        page: page.pageIndex,
        quads: [quad],
        color: HIGHLIGHT_COLOR
      }, sourceId)
    } else if (tool === 'note') {
      onCommit({
        type: 'note',
        page: page.pageIndex,
        rect: pdfRect,
        color: NOTE_COLOR,
        contents: ''
      }, sourceId)
    } else if (tool === 'text') {
      onCommit({
        type: 'text',
        page: page.pageIndex,
        rect: pdfRect,
        contents: '',
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 }
      }, sourceId)
    }
  }, [toFrac, page, tool, stampPng, onCommit, onRedactDraft])

  if (tool === 'none') return null

  const selLeft   = drag ? Math.min(drag.startX, drag.curX) * 100 : 0
  const selTop    = drag ? Math.min(drag.startY, drag.curY) * 100 : 0
  const selWidth  = drag ? Math.abs(drag.curX - drag.startX) * 100 : 0
  const selHeight = drag ? Math.abs(drag.curY - drag.startY) * 100 : 0

  return (
    <div
      ref={containerRef}
      className="annot-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { dragRef.current = null; setDrag(null) }}
    >
      {drag && (
        <div
          className="annot-draft"
          style={{
            left: `${selLeft}%`,
            top: `${selTop}%`,
            width: `${selWidth}%`,
            height: `${selHeight}%`
          }}
        />
      )}
    </div>
  )
}
