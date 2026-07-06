import type { RedactRegion } from '@pdfx/core'
import type { PageEntry } from '../types'

interface RedactPreviewProps {
  page: PageEntry
  drafts: RedactRegion[]
}

/** Renders red-hatched overlays for pending redact regions on a given page.
 * Mounted regardless of the active tool so drafts stay visible when the user
 * switches to another tool before pressing Apply. */
export function RedactPreview({ page, drafts }: RedactPreviewProps): React.JSX.Element | null {
  const pageDrafts = drafts.filter((d) => d.page === page.pageIndex)
  if (pageDrafts.length === 0) return null

  return (
    <div className="redact-preview-layer">
      {pageDrafts.map((d, i) => {
        // Convert PDF user-space rect (origin bottom-left, y-up) back to CSS % (origin top-left, y-down).
        const leftPct = (d.rect.x / page.width) * 100
        const topPct = ((page.height - d.rect.y - d.rect.h) / page.height) * 100
        const widthPct = (d.rect.w / page.width) * 100
        const heightPct = (d.rect.h / page.height) * 100
        return (
          <div
            key={i}
            className="redact-preview-box"
            style={{
              left: `${leftPct}%`,
              top: `${topPct}%`,
              width: `${widthPct}%`,
              height: `${heightPct}%`
            }}
          />
        )
      })}
    </div>
  )
}
