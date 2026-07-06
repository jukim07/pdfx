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
}

declare global {
  interface Window {
    __pdfxTest?: { getState: () => TestSnapshot }
  }
}

/**
 * Read-only e2e state bridge. Snapshots are built lazily on getState() so the
 * production render path pays only one ref assignment; nothing is exposed
 * unless the preload reports test mode.
 */
export function useTestBridge(getSnapshot: () => TestSnapshot): void {
  const ref = useRef(getSnapshot)
  ref.current = getSnapshot
  useEffect(() => {
    if (!window.api.isTestMode) return
    window.__pdfxTest = { getState: () => ref.current() }
  }, [])
}
