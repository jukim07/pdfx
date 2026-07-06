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
