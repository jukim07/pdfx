import { useCallback, useRef, useState } from 'react'
import type { DocEntry } from '../types'
import * as docOps from './doc-ops/docs'

export interface Command {
  do: () => DocEntry[]
  undo: () => DocEntry[]
}

const RING_CAP = 100

export interface CommandStack {
  dispatch: (cmd: Command) => void
  dispatchBulkRename: (currentDocs: DocEntry[], renames: { docId: string; name: string }[]) => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/** Pure factory — usable in tests without React. */
export function createCommandStack(setDocs: (docs: DocEntry[]) => void): CommandStack {
  const ring: Command[] = []
  let cursor = -1 // points to the last executed command

  const stack: CommandStack = {
    dispatch(cmd) {
      // Truncate redo branch
      ring.splice(cursor + 1)
      // Enforce ring cap: evict oldest entry if at capacity
      if (ring.length >= RING_CAP) ring.splice(0, ring.length - RING_CAP + 1)
      ring.push(cmd)
      cursor = ring.length - 1
      setDocs(cmd.do())
    },

    dispatchBulkRename(currentDocs, renames) {
      const prevNames = renames.map(({ docId }) => ({
        docId,
        name: currentDocs.find((d) => d.id === docId)?.name ?? ''
      }))
      // Capture currentDocs so both closures are self-contained
      const snapshot = currentDocs
      stack.dispatch({
        do: () => {
          let docs = snapshot
          for (const { docId, name } of renames) docs = docOps.renameDoc(docs, docId, name)
          return docs
        },
        undo: () => {
          let docs = snapshot
          for (const { docId, name } of prevNames) docs = docOps.renameDoc(docs, docId, name)
          return docs
        }
      })
    },

    undo() {
      if (cursor < 0) return
      setDocs(ring[cursor].undo())
      cursor--
    },

    redo() {
      if (cursor >= ring.length - 1) return
      cursor++
      setDocs(ring[cursor].do())
    },

    canUndo: () => cursor >= 0,
    canRedo: () => cursor < ring.length - 1
  }

  return stack
}

/** React hook wrapping createCommandStack. */
export function useCommandStack(setDocs: (docs: DocEntry[]) => void): {
  dispatch: CommandStack['dispatch']
  dispatchBulkRename: CommandStack['dispatchBulkRename']
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
} {
  const stackRef = useRef<CommandStack | null>(null)
  // Trigger re-render so canUndo/canRedo update in UI
  const [seq, setSeq] = useState(0)
  const bump = useCallback(() => setSeq((s) => s + 1), [])

  const setDocsAndBump = useCallback(
    (docs: DocEntry[]) => {
      setDocs(docs)
      bump()
    },
    // setDocs identity is stable (from useState setter); bump is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  if (!stackRef.current) {
    stackRef.current = createCommandStack(setDocsAndBump)
  }

  const stack = stackRef.current

  const dispatch = useCallback<CommandStack['dispatch']>(
    (cmd) => stack.dispatch(cmd),
    [stack]
  )
  const dispatchBulkRename = useCallback<CommandStack['dispatchBulkRename']>(
    (docs, renames) => stack.dispatchBulkRename(docs, renames),
    [stack]
  )
  const undo = useCallback(() => stack.undo(), [stack])
  const redo = useCallback(() => stack.redo(), [stack])

  // seq used only to trigger re-render; suppress unused-var warning
  void seq

  return {
    dispatch,
    dispatchBulkRename,
    undo,
    redo,
    canUndo: stack.canUndo(),
    canRedo: stack.canRedo()
  }
}
