import type { PageEntry } from '../types'
import type { DraftRedactRegion } from './useAnnotTool'

interface RedactPreviewProps {
  page: PageEntry
  drafts: DraftRedactRegion[]
}

/** Renders red-hatched overlays for pending redact regions on a given page.
 * Mounted regardless of the active tool so drafts stay visible when the user
 * switches to another tool before pressing Apply.
 * Filters by both sourceId and pageIndex so that in merged docs two sources
 * sharing the same pageIndex don't show each other's draft boxes. */
export function RedactPreview({ page, drafts }: RedactPreviewProps): React.JSX.Element | null {
  const pageDrafts = drafts.filter(
    (d) => d.sourceId === page.source.id && d.region.page === page.pageIndex
  )
  if (pageDrafts.length === 0) return null

  return (
    <div className="redact-preview-layer">
      {pageDrafts.map((d, i) => {
        // Convert PDF user-space rect (origin bottom-left, y-up) back to CSS % (origin top-left, y-down).
        const leftPct = (d.region.rect.x / page.width) * 100
        const topPct = ((page.height - d.region.rect.y - d.region.rect.h) / page.height) * 100
        const widthPct = (d.region.rect.w / page.width) * 100
        const heightPct = (d.region.rect.h / page.height) * 100
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
