import { useEffect, useRef } from 'react'

export interface TestPage {
  id: string
  pageIndex: number
  width: number
  height: number
  rotation: number
  cropBox: { x: number; y: number; width: number; height: number } | null
}

export interface TestDoc {
  id: string
  name: string
  pages: TestPage[]
}

export interface TestSnapshot {
  docs: TestDoc[]
  selected: { docId: string; pageId: string } | null
  busy: boolean
  toast: string | null
  find: {
    open: boolean
    query: string
    matchedQuery: string
    pages: number
    occurrences: number
    matchingPageIds: string[]
    matchingDocIds: string[]
  }
  cropOverlayActive: boolean
  cropDialogOpen: boolean
  /** Number of uncommitted annotation drafts in the current drawing session. */
  annotDraftCount: number
  /** Active annotation tool, or 'none'. */
  annotTool: string
}

export interface TestActions {
  /** Trigger the Save Annots flow programmatically (bypasses the toolbar button
   *  that is occluded by the full-view overlay in test scenarios). */
  saveAnnots: () => Promise<void>
  /** Close the full-view programmatically (bypasses the close button which can
   *  be unreliable in test mode due to pointer-event layering). */
  closeFullView: () => void
}

declare global {
  interface Window {
    __pdfxTest?: { getState: () => TestSnapshot; actions: TestActions }
  }
}

/**
 * Read-only e2e state bridge plus a small set of test-only actions.
 * Snapshots are built lazily on getState() so the production render path
 * pays only one ref assignment; nothing is exposed unless the preload
 * reports test mode.
 */
export function useTestBridge(getSnapshot: () => TestSnapshot, actions?: TestActions): void {
  const snapshotRef = useRef(getSnapshot)
  snapshotRef.current = getSnapshot
  const actionsRef = useRef<TestActions | undefined>(actions)
  actionsRef.current = actions
  useEffect(() => {
    if (!window.api.isTestMode) return
    window.__pdfxTest = {
      getState: () => snapshotRef.current(),
      actions: {
        saveAnnots: () => actionsRef.current?.saveAnnots() ?? Promise.resolve(),
        closeFullView: () => actionsRef.current?.closeFullView()
      }
    }
  }, [])
}
