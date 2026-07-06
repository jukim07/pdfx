import type { AnnotTool } from '../annots/useAnnotTool'

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
  onOpenSignaturePicker
}: ToolbarProps): React.JSX.Element {
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
        </div>
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
