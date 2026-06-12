interface ToolbarProps {
  documentCount: number
  pageCount: number
  busy: boolean
  onOpen: () => void
  onExport: () => void
}

const isMac = window.api.platform === 'darwin'

export function Toolbar({
  documentCount,
  pageCount,
  busy,
  onOpen,
  onExport
}: ToolbarProps): React.JSX.Element {
  return (
    <header className={`toolbar${isMac ? ' mac' : ''}`}>
      <div className="brand">PDFX</div>
      {documentCount > 0 && (
        <div className="toolbar-meta">
          {documentCount} {documentCount === 1 ? 'document' : 'documents'}
          <span className="dot">·</span>
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
        </div>
      )}
      <div className="toolbar-spacer" />
      <button className="btn ghost" onClick={onOpen} disabled={busy}>
        Open
      </button>
      <button className="btn primary" onClick={onExport} disabled={busy || documentCount === 0}>
        Export .pdfx
      </button>
    </header>
  )
}
