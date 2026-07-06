import { useState } from 'react'
import { parsePageRanges } from '@pdfx/core'

interface CropRangeDialogProps {
  /** number of pages in the document being cropped */
  pageCount: number
  /** 0-based index (within the doc) of the page the rubber-band was drawn on */
  currentIndex: number
  /** apply the crop to these 0-based page indices */
  onApply: (indices: number[]) => void
  onCancel: () => void
}

type Scope = 'this' | 'all' | 'range'

export function CropRangeDialog({
  pageCount,
  currentIndex,
  onApply,
  onCancel
}: CropRangeDialogProps): React.JSX.Element {
  const [scope, setScope] = useState<Scope>('this')
  const [rangeSpec, setRangeSpec] = useState(String(currentIndex + 1))
  const [error, setError] = useState<string | null>(null)

  const apply = (): void => {
    if (scope === 'this') return onApply([currentIndex])
    if (scope === 'all') return onApply(Array.from({ length: pageCount }, (_, i) => i))
    try {
      const indices = parsePageRanges(rangeSpec, pageCount)
      if (indices.length === 0) {
        setError(`No pages match "${rangeSpec}" (document has ${pageCount})`)
        return
      }
      onApply(indices)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="crop-dialog-backdrop" onClick={onCancel}>
      <div
        className="crop-dialog"
        role="dialog"
        aria-label="Apply crop"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter') apply()
        }}
      >
        <h3>Apply crop to</h3>
        <label>
          <input type="radio" checked={scope === 'this'} onChange={() => setScope('this')} />
          This page only
        </label>
        <label>
          <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
          All {pageCount} pages in this document
        </label>
        <label>
          <input type="radio" checked={scope === 'range'} onChange={() => setScope('range')} />
          Page range
          <input
            type="text"
            value={rangeSpec}
            disabled={scope !== 'range'}
            placeholder="e.g. 1-3,5"
            onChange={(e) => {
              setRangeSpec(e.target.value)
              setError(null)
            }}
          />
        </label>
        {error && <div className="crop-dialog-error">{error}</div>}
        <div className="crop-dialog-buttons">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  )
}
