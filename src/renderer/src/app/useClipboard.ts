import { useCallback, useRef } from 'react'
import { insertPastedPage } from './doc-ops/pages'
import type { Command } from './useCommandStack'
import type { PageRef } from './types'
import type { DocEntry, PageEntry } from '../types'

export function useClipboard(
  docs: DocEntry[],
  selected: PageRef | null,
  docsRef: React.MutableRefObject<DocEntry[]>,
  dispatch: (cmd: Command) => void,
  setSelected: (sel: PageRef | null) => void,
  flash: (message: string) => void
) {
  const clipboardRef = useRef<PageEntry | null>(null)

  const copySelected = useCallback(() => {
    if (!selected) return
    const page = docs
      .find((d) => d.id === selected.docId)
      ?.pages.find((p) => p.id === selected.pageId)
    if (!page) return
    clipboardRef.current = page
    void window.api.clearClipboard()
    flash('Page copied — ⌘V pastes it after the selected page')
  }, [docs, selected, flash])

  const pasteAfterSelected = useCallback(() => {
    const clip = clipboardRef.current
    if (!clip || !selected) return
    const snapshot = docsRef.current
    const pasted: PageEntry = { ...clip, id: crypto.randomUUID() }
    dispatch({
      do: () => insertPastedPage(snapshot, selected, pasted),
      undo: () => snapshot
    })
    setSelected({ docId: selected.docId, pageId: pasted.id })
  }, [selected, docsRef, dispatch, setSelected])

  return { copySelected, pasteAfterSelected }
}
