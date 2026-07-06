import type { AnnotTool } from '../../annots/useAnnotTool'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '../icons'
import { isMac } from './geometry'

interface FullViewChromeProps {
  chromeOpacity: number
  docName: string
  pi: number
  pageCount: number
  runClose: () => void
  navByKey: (axis: 'x' | 'y', dir: 1 | -1) => void
  annotTool?: AnnotTool
  onAnnotTool?: (t: AnnotTool) => void
  annotDraftCount?: number
  onSaveAnnots?: () => void
  busy?: boolean
  /** Opens the signature picker modal so the user can choose/draw a signature. */
  onOpenSignaturePicker?: () => void
}

export function FullViewChrome({
  chromeOpacity,
  docName,
  pi,
  pageCount,
  runClose,
  navByKey,
  annotTool = 'none',
  onAnnotTool,
  annotDraftCount = 0,
  onSaveAnnots,
  busy = false,
  onOpenSignaturePicker
}: FullViewChromeProps): React.JSX.Element {
  return (
    <div className="full-chrome" style={{ opacity: chromeOpacity }}>
      <header className={`full-bar${isMac ? ' mac' : ''}`}>
        <span className="full-title">{docName}</span>
        {onAnnotTool && (
          <div className="annot-cluster full-bar-annot-cluster">
            <button
              className={`icon-btn${annotTool === 'highlight' ? ' active' : ''}`}
              title="Highlight"
              onClick={() => onAnnotTool(annotTool === 'highlight' ? 'none' : 'highlight')}
            >
              H
            </button>
            <button
              className={`icon-btn${annotTool === 'underline' ? ' active' : ''}`}
              title="Underline"
              onClick={() => onAnnotTool(annotTool === 'underline' ? 'none' : 'underline')}
            >
              U
            </button>
            <button
              className={`icon-btn${annotTool === 'strikeout' ? ' active' : ''}`}
              title="Strikeout"
              onClick={() => onAnnotTool(annotTool === 'strikeout' ? 'none' : 'strikeout')}
            >
              S
            </button>
            <button
              className={`icon-btn${annotTool === 'note' ? ' active' : ''}`}
              title="Note"
              onClick={() => onAnnotTool(annotTool === 'note' ? 'none' : 'note')}
            >
              N
            </button>
            <button
              className={`icon-btn${annotTool === 'text' ? ' active' : ''}`}
              title="Free text"
              onClick={() => onAnnotTool(annotTool === 'text' ? 'none' : 'text')}
            >
              T
            </button>
            <button className="icon-btn" title="Ink (coming in Phase 4b)" disabled>
              I
            </button>
            <button
              className={`icon-btn${annotTool === 'stamp' ? ' active' : ''}`}
              title="Stamp signature"
              onClick={onOpenSignaturePicker}
              disabled={!onOpenSignaturePicker}
            >
              ✍
            </button>
          </div>
        )}
        {onSaveAnnots && (
          <button
            className="btn glass full-bar-save-annots"
            title="Commit annotation drafts into PDF"
            onClick={onSaveAnnots}
            disabled={busy || annotDraftCount === 0}
          >
            Save Annots{annotDraftCount > 0 ? ` (${annotDraftCount})` : ''}
          </button>
        )}
        <div className="full-bar-spacer" />
        <button className="icon-btn" title="Close (Esc)" onClick={runClose}>
          <CloseIcon size={16} />
        </button>
      </header>

      <button
        className="full-nav prev"
        disabled={pi === 0}
        onClick={() => navByKey('x', -1)}
        title="Previous page (←)"
      >
        <ChevronLeftIcon size={18} />
      </button>
      <button
        className="full-nav next"
        disabled={pi === pageCount - 1}
        onClick={() => navByKey('x', 1)}
        title="Next page (→)"
      >
        <ChevronRightIcon size={18} />
      </button>

      <div className="full-count">
        {pi + 1} / {pageCount}
      </div>
    </div>
  )
}
