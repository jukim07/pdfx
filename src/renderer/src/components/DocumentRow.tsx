import type { DocEntry } from '../types'
import { PageCanvas } from './PageCanvas'

export const PAGE_HEIGHT = 300

interface DocumentRowProps {
  doc: DocEntry
  index: number
  total: number
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
}

export function DocumentRow({
  doc,
  index,
  total,
  onRemove,
  onMove
}: DocumentRowProps): React.JSX.Element {
  return (
    <section className="doc-row">
      <header className="doc-header">
        <span className="doc-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="doc-name" title={doc.name}>
          {doc.name}
        </span>
        <span className="doc-pages">
          {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}
        </span>
        <div className="doc-actions">
          <button
            className="icon-btn"
            title="Move up"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <button
            className="icon-btn"
            title="Move down"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button className="icon-btn" title="Remove document" onClick={onRemove}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </header>
      <div className="page-strip">
        {doc.pageSizes.map((size, pageIndex) => (
          <PageCanvas
            key={pageIndex}
            pdf={doc.pdf}
            pageNumber={pageIndex + 1}
            width={Math.round((PAGE_HEIGHT * size.width) / size.height)}
            height={PAGE_HEIGHT}
          />
        ))}
      </div>
    </section>
  )
}
