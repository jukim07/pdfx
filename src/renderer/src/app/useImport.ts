import { useCallback, useEffect, useMemo, useRef } from 'react'
import { findConverter } from '@pdfx/core'
import { importIntoDocs, loadIncomingPages } from '../pdfx/source'
import { dedupeNames } from './names'
import { applyExternalDrop } from './external-drop'
import { buildProvenance } from './provenance'
import type { Collection } from './useCollection'
import type { DropTarget } from '../canvas/layout'
import type { IncomingFile } from './types'
import type { DocEntry } from '../types'

/**
 * Derive the deduplicated list of file paths for currently-open docs.
 * Only docs that have an entry in pathByDocId (i.e. were imported from a file)
 * contribute; in-app-created docs have no path and are silently excluded.
 *
 * Exported for unit testing; not part of the public hook API.
 */
export function deriveOpenedPaths(
  docs: Pick<DocEntry, 'id'>[],
  pathByDocId: ReadonlyMap<string, string>
): string[] {
  const seen = new Set<string>()
  for (const doc of docs) {
    const p = pathByDocId.get(doc.id)
    if (p) seen.add(p)
  }
  return [...seen]
}

export function useImport(
  collection: Collection,
  setBusy: (busy: boolean) => void,
  flash: (message: string) => void
) {
  const { docs, docsRef, dispatch, appendPagesToDoc, insertPagesIntoDoc, spliceDocsAfter } =
    collection

  // Maps every docId that was produced by a file import to the originating file path.
  // Docs without a backing file (created in-app, pasted, etc.) are never inserted here,
  // so they are naturally excluded from the persisted path list.
  // This is a ref (not state) — mutations don't need to trigger a re-render; the
  // openedPaths memo below derives from docs (reactive) which already triggers re-renders.
  const pathByDocId = useRef<Map<string, string>>(new Map())

  const addFiles = useCallback(
    async (files: IncomingFile[]) => {
      if (files.length === 0) return
      setBusy(true)
      const failed: string[] = []
      const allEntries: import('../types').DocEntry[] = []
      // Collect (docId, path) pairs as we import; applied to the map after dispatch.
      const docPathPairs: Array<{ docId: string; path: string }> = []
      for (const file of files) {
        try {
          const conv = findConverter(file.name, file.data)
          const name = conv ? conv.rename(file.name) : file.name
          const data = conv
            ? await conv.toPdf(file.name, file.data, undefined, file.path)
            : file.data
          const provenance = buildProvenance(file, conv !== null)
          const entries = await importIntoDocs(name, data, provenance)
          allEntries.push(...entries)
          if (file.path) {
            for (const entry of entries) {
              docPathPairs.push({ docId: entry.id, path: file.path })
            }
          }
        } catch (error) {
          console.error(`Failed to import ${file.name}`, error)
          failed.push(file.name)
        }
      }
      if (allEntries.length > 0) {
        const snapshot = docsRef.current
        dispatch({
          do: () => [...snapshot, ...dedupeNames(snapshot, allEntries)],
          undo: () => snapshot
        })
      }
      // Register paths only after dispatch, so the map is always a superset of current docs.
      for (const { docId, path } of docPathPairs) {
        pathByDocId.current.set(docId, path)
      }
      setBusy(false)
      if (failed.length > 0) flash(`Could not open ${failed.join(', ')}`)
    },
    [flash, setBusy, docsRef, dispatch]
  )

  useEffect(() => {
    const unsubscribe = window.api.onFilesOpened((files) => void addFiles(files))
    void window.api.rendererReady()
    return unsubscribe
  }, [addFiles])

  const openViaDialog = useCallback(async () => {
    await addFiles(await window.api.openFiles())
  }, [addFiles])

  const addPagesToDoc = useCallback(
    async (docId: string) => {
      const files = await window.api.openFiles()
      if (files.length === 0) return
      const doc = docsRef.current.find((d) => d.id === docId)
      if (!doc) return
      setBusy(true)
      try {
        const reference = doc.pages[doc.pages.length - 1]
        const ref = reference ? { width: reference.width, height: reference.height } : undefined
        appendPagesToDoc(docId, await loadIncomingPages(files, ref))
      } catch (error) {
        console.error('Add page failed', error)
        flash('Could not add pages')
      } finally {
        setBusy(false)
      }
    },
    [flash, setBusy, docsRef, appendPagesToDoc]
  )

  const handleExternalDropFiles = useCallback(
    async (files: IncomingFile[], target: DropTarget | null) => {
      if (files.length === 0) return
      if (docsRef.current.length === 0 || !target) {
        await addFiles(files)
        return
      }
      setBusy(true)
      try {
        await applyExternalDrop(files, target, {
          docs: docsRef.current,
          addFiles,
          insertPagesIntoDoc,
          spliceDocsAfter
        })
      } catch (error) {
        console.error('Drop failed', error)
        flash('Could not add files')
      } finally {
        setBusy(false)
      }
    },
    [addFiles, insertPagesIntoDoc, spliceDocsAfter, flash, setBusy, docsRef]
  )

  // Derive the persisted path list from LIVE docs.
  // When a doc is removed (removeDoc, undo, etc.) it leaves collection.docs, so
  // its path automatically falls out of this list on the next render — no
  // accumulation, no stale entries on relaunch.
  // Docs created in-app without a backing file have no pathByDocId entry and are
  // naturally excluded (they can't be restored from disk anyway).
  const openedPaths = useMemo(
    () => deriveOpenedPaths(docs, pathByDocId.current),
    [docs]
  )

  return { addFiles, openViaDialog, addPagesToDoc, handleExternalDropFiles, openedPaths }
}
