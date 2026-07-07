import { memo, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { BASE_RASTER, dpr, evictRaster, logRenderError, renderBase, renderDetail } from './page-view/raster'
import { rasterPool } from '../canvas/raster-pool'
import { FindHighlight } from './find-highlight'
import type { OcrWord } from '../ocr/types'
import type { Annot } from '@pdfx/core'
import type { PageEntry } from '../types'
import { AnnotOverlay } from '../annots/AnnotOverlay'
import { RedactPreview } from '../annots/RedactPreview'
import type { AnnotTool, DraftRedactRegion } from '../annots/useAnnotTool'
import type { RedactRegion } from '@pdfx/core'

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
  /** Accumulated redact region drafts for this doc; RedactPreview filters to this page. */
  redactDrafts?: DraftRedactRegion[]
  /** Called when user draws a redact region on this page. */
  onRedactDraft?: (r: RedactRegion, sourceId: string) => void
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
  stampPng,
  redactDrafts,
  onRedactDraft
}: PageViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const detailRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(eager)
  const [baseReady, setBaseReady] = useState(false)

  const poolKey = `${pdf.fingerprints[0] ?? pageNumber}:${pageNumber}`

  useEffect(() => {
    if (eager) {
      // Eager pages don't need viewport detection; register with an evict callback
      // so the pool can still reclaim them under budget pressure.
      rasterPool.register(poolKey, naturalWidth, naturalHeight, () => {
        setNear(false)
        setBaseReady(false)
        evictRaster(baseRef)
        rasterPool.deregister(poolKey)
      })
      return () => rasterPool.deregister(poolKey)
    }
    const el = rootRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        const isNear = entries.some((e) => e.isIntersecting)
        if (isNear) {
          setNear(true)
          // Touch on re-entry to push to back of eviction queue
          rasterPool.touch(poolKey)
        }
        // When going out of view entirely, raster stays — LRU pool handles eviction
        if (!isNear && near) {
          // page left viewport; pool decides when to evict
        }
      },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      rasterPool.deregister(poolKey)
    }
  }, [eager, poolKey, naturalWidth, naturalHeight, near])

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
      onReady: () => {
        setBaseReady(true)
        rasterPool.register(poolKey, naturalWidth, naturalHeight, () => {
          setNear(false)
          setBaseReady(false)
          evictRaster(baseRef)
          rasterPool.deregister(poolKey)
        })
      }
    }).catch(logRenderError(`Failed to render page ${pageNumber}`))
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [near, pdf, pageNumber, naturalWidth, naturalHeight, poolKey])

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
          onRedactDraft={onRedactDraft}
        />
      ) : null}
      {pageEntry && redactDrafts && redactDrafts.some((d) => d.sourceId === pageEntry.source.id && d.region.page === pageEntry.pageIndex) ? (
        <RedactPreview page={pageEntry} drafts={redactDrafts} />
      ) : null}
    </div>
  )
}

export const PageView = memo(PageViewImpl)
