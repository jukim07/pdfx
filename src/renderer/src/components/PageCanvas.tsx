import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

interface PageCanvasProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  width: number
  height: number
}

export function PageCanvas({ pdf, pageNumber, width, height }: PageCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [rendered, setRendered] = useState(false)

  // Lazy rendering: only rasterize pages near the viewport.
  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: RenderTask | null = null

    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const baseViewport = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (height / baseViewport.height) * dpr })

        // Render to an offscreen canvas, then blit — avoids pdf.js's
        // "same canvas in multiple render() calls" error under re-renders.
        const offscreen = document.createElement('canvas')
        offscreen.width = Math.floor(viewport.width)
        offscreen.height = Math.floor(viewport.height)
        task = page.render({ canvas: offscreen, viewport })
        await task.promise
        if (cancelled) return

        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = offscreen.width
        canvas.height = offscreen.height
        canvas.getContext('2d')!.drawImage(offscreen, 0, 0)
        setRendered(true)
      } catch (error) {
        if ((error as Error)?.name !== 'RenderingCancelledException') {
          console.error(`Failed to render page ${pageNumber}`, error)
        }
      }
    })()

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, pdf, pageNumber, height])

  return (
    <div className="page" ref={containerRef} style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className={rendered ? 'page-canvas visible' : 'page-canvas'}
        style={{ width, height }}
      />
      <span className="page-number">{pageNumber}</span>
    </div>
  )
}
