import { useRef, useState, useCallback } from 'react'

export interface CropRect {
  x: number      // 0..1 fraction of page width
  y: number      // 0..1 fraction of page height
  width: number  // 0..1 fraction
  height: number // 0..1 fraction
}

interface CropOverlayProps {
  /** Called with fractional coords when the user finishes drawing */
  onCropFinished: (rect: CropRect) => void
  onCancel: () => void
}

/**
 * Full-page overlay for rubber-band crop selection.
 * The user clicks and drags to select a crop area.
 * Coordinates are expressed as fractions (0..1) of the overlay dimensions
 * so callers can scale to user-space page units.
 */
export function CropOverlay({ onCropFinished, onCancel }: CropOverlayProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null)

  const toFrac = (clientX: number, clientY: number): { fx: number; fy: number } => {
    const rect = containerRef.current!.getBoundingClientRect()
    return {
      fx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      fy: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    }
  }

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const { fx, fy } = toFrac(e.clientX, e.clientY)
    setDrag({ startX: fx, startY: fy, curX: fx, curY: fy })
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drag) return
    const { fx, fy } = toFrac(e.clientX, e.clientY)
    setDrag((d) => d ? { ...d, curX: fx, curY: fy } : null)
  }, [drag])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (!drag) return
    const { fx, fy } = toFrac(e.clientX, e.clientY)
    const x = Math.min(drag.startX, fx)
    const y = Math.min(drag.startY, fy)
    const width = Math.abs(fx - drag.startX)
    const height = Math.abs(fy - drag.startY)
    setDrag(null)
    if (width < 0.01 || height < 0.01) { onCancel(); return }
    onCropFinished({ x, y, width, height })
  }, [drag, onCropFinished, onCancel])

  const selectionStyle: React.CSSProperties = drag ? {
    position: 'absolute',
    left: `${Math.min(drag.startX, drag.curX) * 100}%`,
    top: `${Math.min(drag.startY, drag.curY) * 100}%`,
    width: `${Math.abs(drag.curX - drag.startX) * 100}%`,
    height: `${Math.abs(drag.curY - drag.startY) * 100}%`,
    border: '2px dashed #2196f3',
    backgroundColor: 'rgba(33, 150, 243, 0.15)',
    pointerEvents: 'none'
  } : {}

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', inset: 0,
        cursor: 'crosshair',
        zIndex: 20
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => setDrag(null)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); onCancel() }}
    >
      {drag && <div style={selectionStyle} />}
      <div style={{ position: 'absolute', top: 4, left: 0, right: 0, textAlign: 'center',
        fontSize: 11, color: '#fff', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>
        Drag to select crop area · Esc or double-click to cancel
      </div>
    </div>
  )
}
