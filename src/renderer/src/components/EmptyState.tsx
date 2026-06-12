interface EmptyStateProps {
  busy: boolean
  onOpen: () => void
}

export function EmptyState({ busy, onOpen }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-card">
        <div className="empty-glyph" aria-hidden="true">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
        </div>
        <h1>{busy ? 'Loading…' : 'Drop PDFs here'}</h1>
        <p>
          Each document flows horizontally, the collection stacks vertically.
          <br />
          Export everything as a single <code>.pdfx</code> file — still a valid PDF.
        </p>
        <button className="btn ghost" onClick={onOpen} disabled={busy}>
          Browse files
        </button>
      </div>
    </div>
  )
}
