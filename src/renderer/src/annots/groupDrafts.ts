import type { Annot } from '@pdfx/core'
import type { PdfSource } from '../types'
import type { DraftAnnot } from './useAnnotTool'

export interface SourceGroup {
  source: PdfSource
  annots: Annot[]
}

/**
 * Groups drafts by the source PDF they were drawn on.
 * Order within each group matches the order drafts were added.
 * Sources not referenced by any draft are omitted.
 */
export function groupDraftsBySource(
  drafts: DraftAnnot[],
  sourceById: Map<string, PdfSource>
): Map<string, SourceGroup> {
  const groups = new Map<string, SourceGroup>()
  for (const d of drafts) {
    const source = sourceById.get(d.sourceId)
    // Drafts for sources not in this doc are skipped (shouldn't happen in practice).
    if (!source) continue
    const existing = groups.get(d.sourceId)
    if (existing) {
      existing.annots.push(d.annot)
    } else {
      groups.set(d.sourceId, { source, annots: [d.annot] })
    }
  }
  return groups
}
