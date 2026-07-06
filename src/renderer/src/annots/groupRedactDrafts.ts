import type { RedactRegion } from '@pdfx/core'
import type { PdfSource } from '../types'
import type { DraftRedactRegion } from './useAnnotTool'

export interface RedactSourceGroup {
  source: PdfSource
  regions: RedactRegion[]
}

/**
 * Groups redact draft regions by the source PDF they were drawn on.
 * Uses the sourceId recorded at draw time — avoids the pageIndex-collision
 * bug that occurs in merged docs where two sources can share the same pageIndex.
 * Drafts whose sourceId is not in sourceById are silently skipped.
 * Order within each group matches the order drafts were added.
 */
export function groupRedactDraftsBySource(
  drafts: DraftRedactRegion[],
  sourceById: Map<string, PdfSource>
): Map<string, RedactSourceGroup> {
  const groups = new Map<string, RedactSourceGroup>()
  for (const d of drafts) {
    const source = sourceById.get(d.sourceId)
    if (!source) continue
    const existing = groups.get(d.sourceId)
    if (existing) {
      existing.regions.push(d.region)
    } else {
      groups.set(d.sourceId, { source, regions: [d.region] })
    }
  }
  return groups
}
