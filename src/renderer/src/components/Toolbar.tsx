import type { AnnotTool, DraftRedactRegion } from '../annots/useAnnotTool'

interface ToolbarProps {
  documentCount: number
  pageCount: number
  busy: boolean
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onOpen: () => void
  onExportPdf: () => void
  onExportZip: () => void
  annotTool?: AnnotTool
  onAnnotTool?: (t: AnnotTool) => void
  annotDraftCount?: number
  onSaveAnnots?: () => void
  /** Opens the signature picker modal so the user can choose/draw a signature. */
  onOpenSignaturePicker?: () => void
  redactDrafts?: DraftRedactRegion[]
  onApplyRedact?: () => void
  onCancelRedact?: () => void
  // Added by E2:
  compareMode: boolean
  onToggleCompareMode: () => void
  // Added by E1:
  axisFlip: boolean
  onToggleAxisFlip: () => void
  // Added by E4:
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

const isMac = window.api.platform === 'darwin'

export function Toolbar({
  documentCount,
  pageCount,
  busy,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onOpen,
  onExportPdf,
  onExportZip,
  annotTool = 'none',
  onAnnotTool,
  annotDraftCount = 0,
  onSaveAnnots,
  onOpenSignaturePicker,
  redactDrafts,
  onApplyRedact,
  onCancelRedact,
  compareMode,
  onToggleCompareMode,
  axisFlip,
  onToggleAxisFlip,
  canUndo,
  canRedo,
  onUndo,
  onRedo
}: ToolbarProps): React.JSX.Element {
  const redactCount = redactDrafts?.length ?? 0
  return (
    <header className={`toolbar${isMac ? ' mac' : ''}`}>
      {documentCount > 0 && (
        <div className="toolbar-meta">
          {documentCount} {documentCount === 1 ? 'document' : 'documents'}
          <span className="dot">·</span>
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </div>
      )}
      <div className="toolbar-spacer" />
      {documentCount > 0 && (
        <div className="zoom-cluster">
          <button className="icon-btn" title="Zoom out" onClick={onZoomOut}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M5 12h14" />
            </svg>
          </button>
          <button className="zoom-value" title="Reset zoom" onClick={onZoomReset}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn" title="Zoom in" onClick={onZoomIn}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      )}
      {documentCount > 0 && (
        <div className="undo-cluster">
          <button className="icon-btn" title="Undo (⌘Z)" onClick={onUndo} disabled={!canUndo}>
            ↩
          </button>
          <button className="icon-btn" title="Redo (⌘⇧Z)" onClick={onRedo} disabled={!canRedo}>
            ↪
          </button>
        </div>
      )}
      {documentCount > 1 && (
        <button
          className={`btn glass${compareMode ? ' active' : ''}`}
          title="Compare mode — locks page positions"
          onClick={onToggleCompareMode}
        >
          Compare
        </button>
      )}
      {documentCount > 0 && (
        <button
          className={`btn glass${axisFlip ? ' active' : ''}`}
          title="Flip layout axis"
          onClick={onToggleAxisFlip}
        >
          ⇄
        </button>
      )}
      {documentCount > 0 && onAnnotTool && (
        <div className="annot-cluster">
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
          <button
            className="icon-btn"
            title="Ink (coming in Phase 4b)"
            disabled
          >
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
          <button
            className={`icon-btn${annotTool === 'redact' ? ' active' : ''}`}
            title="Redact region"
            onClick={() => onAnnotTool!(annotTool === 'redact' ? 'none' : 'redact')}
          >
            ▓
          </button>
        </div>
      )}
      {annotTool === 'redact' && redactCount > 0 && (
        <>
          <button
            className="btn glass"
            title="Permanently redact marked regions"
            onClick={onApplyRedact}
            disabled={busy}
          >
            Apply Redact ({redactCount})
          </button>
          <button
            className="btn glass"
            title="Discard redact regions"
            onClick={onCancelRedact}
            disabled={busy}
          >
            Cancel
          </button>
        </>
      )}
      {onSaveAnnots && (
        <button
          className="btn glass"
          title="Commit annotation drafts into the PDF"
          onClick={onSaveAnnots}
          disabled={busy || annotDraftCount === 0}
        >
          Save Annots{annotDraftCount > 0 ? ` (${annotDraftCount})` : ''}
        </button>
      )}
      <button className="btn glass" onClick={onOpen} disabled={busy}>
        Open
      </button>
      <button className="btn glass" onClick={onExportPdf} disabled={busy || documentCount === 0}>
        Export PDF
      </button>
      <button className="btn glass" onClick={onExportZip} disabled={busy || documentCount === 0}>
        Export ZIP
      </button>
    </header>
  )
}
