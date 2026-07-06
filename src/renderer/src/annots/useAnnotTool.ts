import { useState, useCallback } from 'react'
import type { Annot, RedactRegion } from '@pdfx/core'

/** Active annotation drawing tool. 'none' means the overlay is inactive.
 * 'ink' is reserved for Phase 4b freehand; button exists but records nothing.
 * 'stamp' places a stored-signature PNG on the page.
 * 'redact' draws redaction regions that are committed via Apply, not inline. */
export type AnnotTool = 'none' | 'highlight' | 'underline' | 'strikeout' | 'note' | 'text' | 'ink' | 'stamp' | 'redact'

/** Renderer-local draft record: pairs an annotation with the source PDF it belongs to.
 * sourceId mirrors PdfSource.id so save can group drafts by source without
 * touching the core Annot model (Annot.page stays source-relative pageIndex). */
export interface DraftAnnot {
  annot: Annot
  sourceId: string
}

/** Renderer-local draft record: pairs a redact region with the source PDF it belongs to.
 * Captured at draw time (AnnotOverlay knows the page's source), so apply can group by
 * sourceId directly rather than re-resolving via pageIndex (which collides in merged docs). */
export interface DraftRedactRegion {
  region: RedactRegion
  sourceId: string
}

export interface UseAnnotToolResult {
  tool: AnnotTool
  setTool: (t: AnnotTool) => void
  drafts: DraftAnnot[]
  addDraft: (a: Annot, sourceId: string) => void
  clearDraftsForSources: (sourceIds: Set<string>) => void
  redactDrafts: DraftRedactRegion[]
  addRedactDraft: (r: RedactRegion, sourceId: string) => void
  clearRedactDrafts: () => void
  clearRedactDraftsForSources: (sourceIds: Set<string>) => void
}

export function useAnnotTool(): UseAnnotToolResult {
  const [tool, setTool] = useState<AnnotTool>('none')
  const [drafts, setDrafts] = useState<DraftAnnot[]>([])
  const [redactDrafts, setRedactDrafts] = useState<DraftRedactRegion[]>([])

  const addDraft = useCallback(
    (a: Annot, sourceId: string) => setDrafts((prev) => [...prev, { annot: a, sourceId }]),
    []
  )

  // Only clear drafts for sources that were saved successfully; failed sources keep their drafts.
  const clearDraftsForSources = useCallback(
    (sourceIds: Set<string>) =>
      setDrafts((prev) => prev.filter((d) => !sourceIds.has(d.sourceId))),
    []
  )

  const addRedactDraft = useCallback(
    (r: RedactRegion, sourceId: string) =>
      setRedactDrafts((prev) => [...prev, { region: r, sourceId }]),
    []
  )
  const clearRedactDrafts = useCallback(() => setRedactDrafts([]), [])
  // Clear only the drafts whose source was successfully redacted; leave others intact.
  const clearRedactDraftsForSources = useCallback(
    (sourceIds: Set<string>) =>
      setRedactDrafts((prev) => prev.filter((d) => !sourceIds.has(d.sourceId))),
    []
  )

  return {
    tool,
    setTool,
    drafts,
    addDraft,
    clearDraftsForSources,
    redactDrafts,
    addRedactDraft,
    clearRedactDrafts,
    clearRedactDraftsForSources
  }
}
