import { useCallback, useRef, useState } from 'react'
import * as docOps from './doc-ops/docs'
import * as pageOps from './doc-ops/pages'
import * as moveOps from './doc-ops/move'
import { useClipboard } from './useClipboard'
import { useCommandStack } from './useCommandStack'
import type { SelectedTarget } from './selection'
import type { PageRef } from './types'
import type { DocEntry, PageEntry } from '../types'

export function useCollection(flash: (message: string) => void) {
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [selected, setSelected] = useState<PageRef | null>(null)
  const [compareMode, setCompareMode] = useState(false)

  const toggleCompareMode = useCallback(() => setCompareMode((v) => !v), [])

  const docsRef = useRef(docs)
  docsRef.current = docs

  // Validate selection after any docs update; clear if page no longer exists.
  const setDocsAndValidateSelection = useCallback((next: DocEntry[]) => {
    setDocs(next)
    setSelected((sel) => {
      if (!sel) return sel
      const doc = next.find((d) => d.id === sel.docId)
      if (!doc) return null
      const page = doc.pages.find((p) => p.id === sel.pageId)
      if (!page) return null
      return sel
    })
  }, [])

  const { dispatch, dispatchBulkRename, undo: rawUndo, redo: rawRedo, canUndo, canRedo } =
    useCommandStack(setDocsAndValidateSelection)

  const undo = useCallback(() => rawUndo(), [rawUndo])
  const redo = useCallback(() => rawRedo(), [rawRedo])

  const { copySelected, pasteAfterSelected } = useClipboard(
    docs,
    selected,
    docsRef,
    dispatch,
    setSelected,
    flash
  )

  const selectPage = useCallback((docId: string, pageId: string) => {
    setSelected({ docId, pageId })
  }, [])

  const clearSelection = useCallback(() => setSelected(null), [])

  const removeDoc = useCallback(
    (id: string) => {
      const current = docsRef.current
      const idx = current.findIndex((d) => d.id === id)
      if (idx === -1) return
      const removed = current[idx]
      dispatch({
        do: () => docOps.removeDoc(current, id),
        undo: () => {
          const next = [...current]
          next.splice(idx, 0, removed)
          return next
        }
      })
      setSelected((sel) => (sel?.docId === id ? null : sel))
    },
    [dispatch]
  )

  const renameDoc = useCallback(
    (id: string, name: string) => {
      const current = docsRef.current
      const oldName = current.find((d) => d.id === id)?.name ?? ''
      dispatch({
        do: () => docOps.renameDoc(current, id, name),
        undo: () => docOps.renameDoc(current, id, oldName)
      })
    },
    [dispatch]
  )

  const rotatePage = useCallback(
    (docId: string, pageId: string, delta: 90 | -90) => {
      const current = docsRef.current
      const applyDelta = (docs: DocEntry[], d: 90 | -90): DocEntry[] =>
        docs.map((doc) => {
          if (doc.id !== docId) return doc
          return {
            ...doc,
            pages: doc.pages.map((p) => {
              if (p.id !== pageId) return p
              const cur = p.rotation ?? 0
              return { ...p, rotation: (((cur + d) % 360) + 360) % 360 }
            })
          }
        })
      dispatch({
        do: () => applyDelta(current, delta),
        undo: () => applyDelta(current, (-delta) as 90 | -90)
      })
    },
    [dispatch]
  )

  const moveDoc = useCallback(
    (id: string, direction: -1 | 1) => {
      const current = docsRef.current
      dispatch({
        do: () => docOps.reorderDoc(current, id, direction),
        undo: () => docOps.reorderDoc(current, id, (-direction) as -1 | 1)
      })
    },
    [dispatch]
  )

  const deletePage = useCallback(
    (target: PageRef) => {
      const current = docsRef.current
      const doc = current.find((d) => d.id === target.docId)
      const index = doc?.pages.findIndex((p) => p.id === target.pageId) ?? -1
      if (!doc || index === -1) return
      const page = doc.pages[index]
      const pages = doc.pages.filter((p) => p.id !== target.pageId)
      const neighbor = pages[Math.min(index, pages.length - 1)]
      dispatch({
        do: () =>
          current
            .map((d) => (d.id === doc.id ? { ...d, pages } : d))
            .filter((d) => d.pages.length > 0),
        undo: () =>
          current.map((d) => {
            if (d.id !== doc.id) return d
            const restored = [...d.pages.filter((p) => p.id !== page.id)]
            restored.splice(index, 0, page)
            return { ...d, pages: restored }
          })
      })
      setSelected(neighbor ? { docId: doc.id, pageId: neighbor.id } : null)
    },
    [dispatch]
  )

  const insertPagesAfter = useCallback(
    (target: SelectedTarget, entries: PageEntry[]) => {
      if (entries.length === 0) return
      const snapshot = docsRef.current
      dispatch({
        do: () => pageOps.insertPagesAfter(snapshot, target.doc.id, target.index, entries),
        undo: () => snapshot
      })
      setSelected({ docId: target.doc.id, pageId: entries[entries.length - 1].id })
    },
    [dispatch]
  )

  const appendPagesToDoc = useCallback(
    (docId: string, entries: PageEntry[]) => {
      if (entries.length === 0) return
      const snapshot = docsRef.current
      dispatch({
        do: () => pageOps.appendPages(snapshot, docId, entries),
        undo: () => snapshot
      })
      setSelected({ docId, pageId: entries[entries.length - 1].id })
    },
    [dispatch]
  )

  const insertPagesIntoDoc = useCallback(
    (docId: string, index: number, entries: PageEntry[]) => {
      if (entries.length === 0) return
      const snapshot = docsRef.current
      dispatch({
        do: () => pageOps.insertPagesIntoDoc(snapshot, docId, index, entries),
        undo: () => snapshot
      })
      setSelected({ docId, pageId: entries[entries.length - 1].id })
    },
    [dispatch]
  )

  const movePageInto = useCallback(
    (source: PageRef, targetDocId: string, index: number) => {
      const current = docsRef.current
      const srcDoc = current.find((d) => d.id === source.docId)
      const originalIndex = srcDoc?.pages.findIndex((p) => p.id === source.pageId) ?? 0
      dispatch({
        do: () => moveOps.movePageInto(current, source, targetDocId, index),
        undo: () => {
          // Reverse: move page from targetDocId back to source.docId at originalIndex
          const afterDo = moveOps.movePageInto(current, source, targetDocId, index)
          return moveOps.movePageInto(
            afterDo,
            { docId: targetDocId, pageId: source.pageId },
            source.docId,
            originalIndex
          )
        }
      })
      setSelected({ docId: targetDocId, pageId: source.pageId })
    },
    [dispatch]
  )

  const movePageToNewDoc = useCallback(
    (source: PageRef, docIndex: number) => {
      const newDocId = crypto.randomUUID()
      const snapshot = docsRef.current
      dispatch({
        do: () => moveOps.movePageToNewDoc(snapshot, source, docIndex, newDocId),
        undo: () => snapshot
      })
      setSelected({ docId: newDocId, pageId: source.pageId })
    },
    [dispatch]
  )

  const spliceDocsAfter = useCallback(
    (anchorDocId: string | null, newDocs: DocEntry[]) => {
      if (newDocs.length === 0) return
      const snapshot = docsRef.current
      dispatch({
        do: () => docOps.spliceDocsAfter(snapshot, anchorDocId, newDocs),
        undo: () => snapshot
      })
      const last = newDocs[newDocs.length - 1]
      setSelected({ docId: last.id, pageId: last.pages[last.pages.length - 1].id })
    },
    [dispatch]
  )

  const applyCrop = useCallback(
    (docId: string, pageIds: string[], rect: { x: number; y: number; width: number; height: number }) => {
      const snapshot = docsRef.current
      dispatch({
        do: () =>
          snapshot.map((doc) => {
            if (doc.id !== docId) return doc
            return {
              ...doc,
              pages: doc.pages.map((p) => {
                if (!pageIds.includes(p.id)) return p
                return {
                  ...p,
                  cropBox: {
                    x: rect.x * p.width,
                    // rect.y is from the top of the thumbnail; PDF user space is bottom-up
                    y: (1 - rect.y - rect.height) * p.height,
                    width: rect.width * p.width,
                    height: rect.height * p.height
                  }
                }
              })
            }
          }),
        undo: () => snapshot
      })
    },
    [dispatch]
  )

  return {
    docs,
    setDocs,
    docsRef,
    dispatch,
    selected,
    setSelected,
    selectPage,
    clearSelection,
    compareMode,
    toggleCompareMode,
    removeDoc,
    renameDoc,
    rotatePage,
    applyCrop,
    moveDoc,
    deletePage,
    copySelected,
    pasteAfterSelected,
    insertPagesAfter,
    appendPagesToDoc,
    insertPagesIntoDoc,
    movePageInto,
    movePageToNewDoc,
    spliceDocsAfter,
    undo,
    redo,
    canUndo,
    canRedo,
    dispatchBulkRename
  }
}

export type Collection = ReturnType<typeof useCollection>
