import { useRef } from 'react'

interface SignaturePadProps {
  onSave: (png: Uint8Array) => void
  onCancel: () => void
}

export function SignaturePad({ onSave, onCancel }: SignaturePadProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)

  const pos = (e: React.PointerEvent): { x: number; y: number } => {
    const box = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }

  const ctx2d = (): CanvasRenderingContext2D => canvasRef.current!.getContext('2d')!

  const save = (): void => {
    const dataUrl = canvasRef.current!.toDataURL('image/png')
    const base64 = dataUrl.split(',')[1]
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    onSave(bytes)
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        width={480}
        height={200}
        className="signature-canvas"
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture(e.pointerId)
          drawing.current = true
          last.current = pos(e)
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const c = ctx2d()
          const p = pos(e)
          c.lineWidth = 2.5
          c.lineCap = 'round'
          c.strokeStyle = '#111'
          c.beginPath()
          c.moveTo(last.current!.x, last.current!.y)
          c.lineTo(p.x, p.y)
          c.stroke()
          last.current = p
        }}
        onPointerUp={() => {
          drawing.current = false
          last.current = null
        }}
        onPointerCancel={() => {
          drawing.current = false
          last.current = null
        }}
        onPointerLeave={() => {
          drawing.current = false
          last.current = null
        }}
      />
      <div className="signature-actions">
        <button
          onClick={() => {
            const c = ctx2d()
            c.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
          }}
        >
          Clear
        </button>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={save}>Save signature</button>
      </div>
    </div>
  )
}
