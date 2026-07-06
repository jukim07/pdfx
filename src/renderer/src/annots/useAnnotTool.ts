import { useState, useCallback } from 'react'
import type { Annot } from '@pdfx/core'

/** Active annotation drawing tool. 'none' means the overlay is inactive.
 * 'ink' is reserved for Phase 4b freehand; button exists but records nothing. */
export type AnnotTool = 'none' | 'highlight' | 'underline' | 'strikeout' | 'note' | 'text' | 'ink'

export interface UseAnnotToolResult {
  tool: AnnotTool
  setTool: (t: AnnotTool) => void
  drafts: Annot[]
  addDraft: (a: Annot) => void
  clearDrafts: () => void
}

export function useAnnotTool(): UseAnnotToolResult {
  const [tool, setTool] = useState<AnnotTool>('none')
  const [drafts, setDrafts] = useState<Annot[]>([])

  const addDraft = useCallback((a: Annot) => setDrafts((prev) => [...prev, a]), [])
  const clearDrafts = useCallback(() => setDrafts([]), [])

  return { tool, setTool, drafts, addDraft, clearDrafts }
}
