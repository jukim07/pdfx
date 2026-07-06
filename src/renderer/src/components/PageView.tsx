import { memo, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { BASE_RASTER, dpr, logRenderError, renderBase, renderDetail } from './page-view/raster'
import { FindHighlight } from './find-highlight'
import type { OcrWord } from '../ocr/types'
import type { Annot } from '@pdfx/core'
import type { PageEntry } from '../types'
import { AnnotOverlay } from '../annots/AnnotOverlay'
import type { AnnotTool } from '../annots/useAnnotTool'

interface PageViewProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  naturalWidth: number
  naturalHeight: number
  version: number
  eager?: boolean
  detail?: boolean
  rotation?: number // 0 | 90 | 180 | 270, CSS-preview only; export baking is toExportPage's job
  highlightQuery?: string
  ocrWords?: OcrWord[]
  /** When set, mounts the annotation rubber-band overlay on this page. */
  annotTool?: AnnotTool
  /** The PageEntry for this page — required when annotTool is set. */
  pageEntry?: PageEntry
  /** Called when user finishes drawing an annotation on this page.
   *  sourceId is the PdfSource.id of the page so callers can group drafts by source. */
  onAnnotCommit?: (a: Annot, sourceId: string) => void
  /** PNG bytes for the stamp tool; passed to AnnotOverlay when tool === 'stamp'. */
  stampPng?: Uint8Array
}

function PageViewImpl({
  pdf,
  pageNumber,
  naturalWidth,
  naturalHeight,
  version,
  eager = false,
  detail = true,
  rotation = 0,
  highlightQuery,
  ocrWords,
  annotTool,
  pageEntry,
  onAnnotCommit,
  stampPng
}: PageViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const detailRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(eager)
  const [baseReady, setBaseReady] = useState(false)

  useEffect(() => {
    if (eager) return
    const el = rootRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [eager])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    let task: RenderTask | null = null
    void renderBase({
      pdf,
      pageNumber,
      naturalWidth,
      naturalHeight,
      baseRef,
      isCancelled: () => cancelled,
      onTask: (t) => (task = t),
      onReady: () => setBaseReady(true)
    }).catch(logRenderError(`Failed to render page ${pageNumber}`))
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [near, pdf, pageNumber, naturalWidth, naturalHeight])

  useEffect(() => {
    if (!near) return
    const root = rootRef.current
    const detailCanvas = detailRef.current
    if (!root || !detailCanvas) return
    if (!detail) {
      detailCanvas.style.display = 'none'
      return
    }

    const rect = root.getBoundingClientRect()
    const layoutW = root.offsetWidth
    const winW = window.innerWidth
    const winH = window.innerHeight
    const visLeft = Math.max(0, rect.left)
    const visTop = Math.max(0, rect.top)
    const visRight = Math.min(winW, rect.right)
    const visBottom = Math.min(winH, rect.bottom)
    const visW = visRight - visLeft
    const visH = visBottom - visTop

    const baseDevicePx = (BASE_RASTER / Math.max(naturalWidth, naturalHeight)) * naturalWidth
    if (visW <= 0 || visH <= 0 || rect.width * dpr() <= baseDevicePx * 1.05) {
      detailCanvas.style.display = 'none'
      return
    }

    let cancelled = false
    let task: RenderTask | null = null
    void renderDetail({
      pdf,
      pageNumber,
      naturalWidth,
      geometry: { rect, layoutW, visLeft, visTop, visW, visH },
      detailCanvas,
      isCancelled: () => cancelled,
      onTask: (t) => (task = t)
    }).catch(logRenderError(`Failed to render detail for page ${pageNumber}`))
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [near, version, detail, pdf, pageNumber, naturalWidth, naturalHeight])

  return (
    <div
      className="pageview"
      ref={rootRef}
      style={rotation ? { transform: `rotate(${rotation}deg)`, transformOrigin: 'center center' } : undefined}
    >
      <canvas ref={baseRef} className={baseReady ? 'pageview-base ready' : 'pageview-base'} />
      <canvas ref={detailRef} className="pageview-detail" style={{ display: 'none' }} />
      {near && highlightQuery ? (
        <FindHighlight
          pdf={pdf}
          pageNumber={pageNumber}
          naturalHeight={naturalHeight}
          query={highlightQuery}
          ocrWords={ocrWords}
        />
      ) : null}
      {annotTool && annotTool !== 'none' && pageEntry && onAnnotCommit ? (
        <AnnotOverlay
          page={pageEntry}
          tool={annotTool}
          onCommit={onAnnotCommit}
          stampPng={stampPng}
        />
      ) : null}
    </div>
  )
}

export const PageView = memo(PageViewImpl)
