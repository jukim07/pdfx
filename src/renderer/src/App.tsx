import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWatermark } from './app/useWatermark'
import { WatermarkPanel } from './components/WatermarkPanel'
import { computeLayout } from './canvas/layout'
import { Toolbar } from './components/Toolbar'
import { FullView } from './components/FullView'
import { CollectionCanvas } from './components/CollectionCanvas'
import type { CanvasHandle } from './components/Canvas'
import { useCollection } from './app/useCollection'
import { useFullView } from './app/useFullView'
import { useExport } from './app/useExport'
import { useImport } from './app/useImport'
import { usePaste } from './app/usePaste'
import { useDragController } from './app/useDragController'
import { useKeyboardShortcuts } from './app/useKeyboardShortcuts'
import { useFind } from './app/useFind'
import { useTestBridge } from './app/test-bridge'
import { useSearchIndex } from './search/useSearchIndex'
import { FindProvider } from './search/FindContext'
import { FindBar } from './components/FindBar'
import { CropRangeDialog } from './components/CropRangeDialog'
import type { CropRect } from './components/CropOverlay'
import { useAnnotTool } from './annots/useAnnotTool'
import { groupDraftsBySource } from './annots/groupDrafts'
import { groupRedactDraftsBySource } from './annots/groupRedactDrafts'
import type { Annot, StampAnnot, RedactMode } from '@pdfx/core'
import { loadSource } from './pdfx/source'
import { SignaturePicker } from './annots/SignaturePicker'

const TOAST_MS = 4000

export default function App(): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [scale, setScale] = useState(1)
  const [renderVersion, setRenderVersion] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canvasRef = useRef<CanvasHandle | null>(null)

  const flash = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const collection = useCollection(flash)
  const fullViewState = useFullView()
  const docs = collection.docs

  const [cropTarget, setCropTarget] = useState<{ docId: string; pageId: string } | null>(null)
  const [pendingCrop, setPendingCrop] = useState<{ docId: string; pageId: string; rect: CropRect } | null>(null)

  const handleStartCrop = useCallback((docId: string, pageId: string) => {
    setCropTarget({ docId, pageId })
  }, [])

  const handleCropFinished = useCallback(
    (rect: CropRect) => {
      if (cropTarget) setPendingCrop({ ...cropTarget, rect })
      setCropTarget(null)
    },
    [cropTarget]
  )
  const annot = useAnnotTool()
  // stampPng: PNG bytes currently loaded in placement mode (null = no active stamp).
  const [stampPng, setStampPng] = useState<Uint8Array | null>(null)
  const [showSignaturePicker, setShowSignaturePicker] = useState(false)

  // Wrapper so any tool switch away from 'stamp' clears the stale png immediately.
  // Without this, re-selecting stamp later would silently reuse the old bytes.
  const handleAnnotTool = useCallback(
    (tool: Parameters<typeof annot.setTool>[0]) => {
      if (tool !== 'stamp') setStampPng(null)
      annot.setTool(tool)
    },
    [annot.setTool]
  )

  const handleOpenSignaturePicker = useCallback(() => {
    setShowSignaturePicker(true)
  }, [])

  const handlePickSignature = useCallback(
    (png: Uint8Array) => {
      setStampPng(png)
      setShowSignaturePicker(false)
      annot.setTool('stamp')
    },
    [annot.setTool]
  )

  const handleAnnotCommit = useCallback((a: Annot, sourceId: string) => {
    annot.addDraft(a, sourceId)
    // After placing a stamp, exit placement mode so the user doesn't stamp again accidentally.
    if (a.type === 'stamp') {
      annot.setTool('none')
      setStampPng(null)
    }
  }, [annot.addDraft, annot.setTool])

  // Save annotation drafts into each affected source PDF, then reload the in-memory
  // PdfSource objects so pdfjs-dist renders persisted annotations on next full-view open.
  // A doc may span pages from multiple sources (merge/paste); each source is saved
  // independently so a failure in one never silently drops drafts for others.
  const handleSaveAnnots = useCallback(async () => {
    if (annot.drafts.length === 0 || !fullViewState.fullView) return
    const docId = fullViewState.fullView.docId
    const doc = collection.docsRef.current.find((d) => d.id === docId)
    if (!doc || doc.pages.length === 0) return

    // Build a lookup from sourceId → PdfSource using this doc's pages.
    const sourceById = new Map(doc.pages.map((p) => [p.source.id, p.source]))

    // Group drafts by the source they belong to.
    const draftsBySource = groupDraftsBySource(annot.drafts, sourceById)

    setBusy(true)
    const savedSourceIds = new Set<string>()
    const errors: string[] = []

    for (const [srcId, { source, annots }] of draftsBySource) {
      try {
        // Split stamp vs regular annots; write regular first, then stamps on the result.
        const regularAnnots = annots.filter((a) => a.type !== 'stamp')
        const stampAnnots = annots.filter((a): a is StampAnnot => a.type === 'stamp')
        let workingBytes = source.bytes
        if (regularAnnots.length > 0) {
          workingBytes = await window.api.writeAnnots(workingBytes, regularAnnots)
        }
        if (stampAnnots.length > 0) {
          workingBytes = await window.api.writeStampAnnots(workingBytes, stampAnnots)
        }
        const { source: newSource, sizes } = await loadSource(workingBytes)
        collection.setDocs((prev) =>
          prev.map((d) => {
            if (d.id !== docId) return d
            return {
              ...d,
              pages: d.pages.map((p) => {
                if (p.source.id !== srcId) return p
                return {
                  ...p,
                  source: newSource,
                  width: sizes[p.pageIndex]?.width ?? p.width,
                  height: sizes[p.pageIndex]?.height ?? p.height
                }
              })
            }
          })
        )
        savedSourceIds.add(srcId)
      } catch (err) {
        console.error(`Save annotations failed for source ${srcId}`, err)
        errors.push(srcId)
      }
    }

    // Only clear drafts for sources that saved successfully; keep drafts for failed sources.
    annot.clearDraftsForSources(savedSourceIds)
    setBusy(false)

    if (errors.length === 0) {
      flash('Annotations saved')
    } else if (savedSourceIds.size > 0) {
      flash(`Annotations partially saved (${errors.length} source(s) failed)`)
    } else {
      flash('Failed to save annotations')
    }
  }, [annot.drafts, annot.clearDraftsForSources, fullViewState.fullView, collection.docsRef, collection.setDocs, setBusy, flash])

  // Permanently redact accumulated draft regions, then reload the affected source.
  // Two-shot: first try 'black' (content-stream surgery); if StreamSurgeryError,
  // prompt to fall back to 'rasterize' (page becomes an image, no selectable text).
  // Each source's drafts are cleared immediately after that source succeeds, so a
  // mid-flow decline on the rasterize prompt leaves only unapplied sources' drafts.
  const handleApplyRedact = useCallback(async () => {
    if (annot.redactDrafts.length === 0 || !fullViewState.fullView) return
    const ok = window.confirm(
      `Permanently redact ${annot.redactDrafts.length} region(s)? ` +
        `Text and images under these boxes will be REMOVED from the PDF. ` +
        `This cannot be undone in the saved file.`
    )
    if (!ok) return

    const docId = fullViewState.fullView.docId
    const doc = collection.docsRef.current.find((d) => d.id === docId)
    if (!doc || doc.pages.length === 0) return

    // Group by sourceId captured at draw time; avoids pageIndex collision in merged docs.
    const sourceById = new Map(doc.pages.map((p) => [p.source.id, p.source]))
    const bySource = groupRedactDraftsBySource(annot.redactDrafts, sourceById)

    const applyBytes = async (srcId: string, source: { bytes: Uint8Array; id: string }, regions: Parameters<typeof window.api.redactDoc>[1], mode: RedactMode) => {
      const result = await window.api.redactDoc(source.bytes, regions, mode)
      if ('surgeryFailed' in result) {
        return result as { surgeryFailed: true; page: number }
      }
      const newBytes = result as Uint8Array
      const { source: newSource, sizes } = await loadSource(newBytes)
      collection.setDocs((prev) =>
        prev.map((d) => {
          if (d.id !== docId) return d
          return {
            ...d,
            pages: d.pages.map((p) => {
              if (p.source.id !== srcId) return p
              return {
                ...p,
                source: newSource,
                width: sizes[p.pageIndex]?.width ?? p.width,
                height: sizes[p.pageIndex]?.height ?? p.height
              }
            })
          }
        })
      )
      return null
    }

    setBusy(true)
    for (const [srcId, { source, regions }] of bySource) {
      try {
        const err = await applyBytes(srcId, source, regions, 'black')
        if (err) {
          setBusy(false)
          const retry = window.confirm(
            `Precise removal failed on page ${err.page + 1}. ` +
              `Rasterize the affected page(s) instead? ` +
              `(The page becomes an image; text will no longer be selectable.)`
          )
          if (!retry) return
          setBusy(true)
          const err2 = await applyBytes(srcId, source, regions, 'rasterize')
          if (err2) {
            setBusy(false)
            flash('Rasterize fallback failed')
            return
          }
        }
      } catch (err) {
        console.error('Redact failed', err)
        setBusy(false)
        flash('Redaction failed')
        return
      }
      // Clear this source's drafts immediately after it succeeds so a later
      // decline on a different source's rasterize prompt can't double-apply these.
      annot.clearRedactDraftsForSources(new Set([srcId]))
    }
    setBusy(false)
    flash('Redacted')
  }, [annot.redactDrafts, annot.clearRedactDraftsForSources, fullViewState.fullView, collection.docsRef, collection.setDocs, setBusy, flash])

  const handleCancelRedact = useCallback(() => {
    annot.clearRedactDrafts()
  }, [annot.clearRedactDrafts])

  const layout = useMemo(() => computeLayout(docs), [docs])

  const searchIndex = useSearchIndex(docs)
  const find = useFind(searchIndex.search, searchIndex.version)
  const findState = useMemo(
    () => ({
      active: find.active,
      query: find.matchedQuery,
      matchingDocIds: find.result.docIds,
      matchingPageIds: find.result.pageIds,
      getOcrWords: searchIndex.getOcrWords
    }),
    [find.active, find.matchedQuery, find.result, searchIndex.getOcrWords]
  )

  const { exportCollection, exportZip } = useExport(docs, setBusy, flash)
  const { addFiles, openViaDialog, addPagesToDoc, handleExternalDropFiles } = useImport(
    collection,
    setBusy,
    flash
  )
  const { handlePaste } = usePaste(collection, addFiles, setBusy, flash)

  const drag = useDragController({
    layout,
    canvasRef,
    compareMode: collection.compareMode,
    movePageInto: collection.movePageInto,
    movePageToNewDoc: collection.movePageToNewDoc,
    onExternalDrop: handleExternalDropFiles
  })

  // The active document bytes needed for watermark ops.
  // docs is from collection.docs (confirmed App.tsx:46). Each doc.pages[n].source.bytes
  // is the raw Uint8Array for that source (confirmed App.tsx:124 `source.bytes`).
  const getActiveDocBytes = useCallback((): Uint8Array | null => {
    const firstDoc = docs[0]
    if (!firstDoc || !firstDoc.pages[0]) return null
    return firstDoc.pages[0].source.bytes
  }, [docs])

  const handleBytesUpdated = useCallback(
    (_bytes: Uint8Array) => {
      // In Phase ①+, this should replace the source bytes and re-render pages.
      // For now, flash a message so the user knows to re-import.
      flash('Watermark removed — re-import the file to see changes')
    },
    [flash]
  )

  const watermark = useWatermark(getActiveDocBytes, handleBytesUpdated)

  const onPaste = useCallback(() => void handlePaste(), [handlePaste])
  useKeyboardShortcuts({
    active: !fullViewState.fullView,
    selected: collection.selected,
    onDeletePage: collection.deletePage,
    onCopy: collection.copySelected,
    onPaste,
    onClearSelection: collection.clearSelection,
    findOpen: find.open,
    onOpenFind: find.openFind,
    onCloseFind: find.closeFind
  })

  useTestBridge(
    () => ({
      docs: docs.map((d) => ({
        id: d.id,
        name: d.name,
        pages: d.pages.map((p) => ({
          id: p.id,
          pageIndex: p.pageIndex,
          width: p.width,
          height: p.height,
          rotation: p.rotation ?? 0,
          cropBox: p.cropBox ?? null
        }))
      })),
      selected: collection.selected,
      busy,
      toast,
      find: {
        open: find.open,
        query: find.query,
        matchedQuery: find.matchedQuery,
        pages: find.result.pages,
        occurrences: find.result.occurrences,
        matchingPageIds: [...find.result.pageIds],
        matchingDocIds: [...find.result.docIds]
      },
      cropOverlayActive: cropTarget !== null,
      cropDialogOpen: pendingCrop !== null,
      annotDraftCount: annot.drafts.length,
      annotTool: annot.tool
    }),
    { saveAnnots: handleSaveAnnots, closeFullView: fullViewState.closeFullView }
  )

  const onScaleChange = useCallback((next: number) => setScale(next), [])
  const onSettle = useCallback(() => setRenderVersion((v) => v + 1), [])

  const fullViewRef = fullViewState.fullViewRef
  useEffect(() => {
    return window.api.onZoom((action) => {
      if (fullViewRef.current) return
      if (action === 'in') canvasRef.current?.zoomIn()
      else if (action === 'out') canvasRef.current?.zoomOut()
      else canvasRef.current?.reset()
    })
  }, [fullViewRef])

  useEffect(() => {
    return window.api.onMenu(async (action) => {
      if (action === 'open') void openViaDialog()
      else if (action === 'export-pdfx') void exportCollection('pdfx')
      else if (action === 'export-pdf') void exportCollection('pdf')
      else if (action === 'export-zip') void exportZip()
      else if (action === 'watermark-panel') void watermark.scan()
      else if (action === 'export-legible') {
        const bytes = getActiveDocBytes()
        if (!bytes) { flash('No document open'); return }
        const path = await window.api.chooseSavePath('legible-copy.pdf', { name: 'PDF', extensions: ['pdf'] })
        if (!path) return
        setBusy(true)
        try {
          const result = await window.api.rebuildLegible(bytes)
          const saved = await window.api.writeFile(path, result)
          flash(`Saved ${saved}`)
        } catch (e) {
          console.error('rebuildLegible failed', e)
          flash('Export failed')
        } finally {
          setBusy(false)
        }
      }
    })
  }, [openViaDialog, exportCollection, exportZip, watermark.scan, getActiveDocBytes, flash, setBusy])

  const totalPages = docs.reduce((sum, d) => sum + d.pages.length, 0)
  const { fullView } = fullViewState
  const fullViewDoc = fullView ? docs.find((d) => d.id === fullView.docId) : undefined

  return (
    <FindProvider value={findState}>
      <div
        className={
          'app' + (drag.committing ? ' committing' : '') + (drag.dragKind ? ' dragging' : '')
        }
        onDragEnter={drag.handlers.onDragEnter}
        onDragOver={drag.handlers.onDragOver}
        onDragLeave={drag.handlers.onDragLeave}
        onDrop={drag.handlers.onDrop}
      >
        <Toolbar
          documentCount={docs.length}
          pageCount={totalPages}
          busy={busy}
          zoom={scale}
          compareMode={collection.compareMode}
          onZoomIn={() => canvasRef.current?.zoomIn()}
          onZoomOut={() => canvasRef.current?.zoomOut()}
          onZoomReset={() => canvasRef.current?.reset()}
          onOpen={openViaDialog}
          onExportPdf={() => exportCollection('pdf')}
          onExportZip={exportZip}
          annotTool={annot.tool}
          onAnnotTool={handleAnnotTool}
          annotDraftCount={annot.drafts.length}
          onSaveAnnots={() => void handleSaveAnnots()}
          onOpenSignaturePicker={handleOpenSignaturePicker}
          redactDrafts={annot.redactDrafts}
          onApplyRedact={() => void handleApplyRedact()}
          onCancelRedact={handleCancelRedact}
          onToggleCompareMode={collection.toggleCompareMode}
        />

        {find.open && (
          <FindBar
            query={find.query}
            result={find.result}
            ocrRemaining={searchIndex.ocrRemaining}
            hasScanned={searchIndex.hasScanned}
            ocrLanguage={searchIndex.ocrLanguage}
            onQuery={find.setQuery}
            onOcrLanguage={searchIndex.setOcrLanguage}
            onClose={find.closeFind}
          />
        )}

        <CollectionCanvas
          docs={docs}
          layout={layout}
          busy={busy}
          pagesDraggable={totalPages >= 2}
          renderVersion={renderVersion}
          selected={collection.selected}
          hiddenPageId={fullViewState.hiddenPageId}
          dragKind={drag.dragKind}
          draggingPage={drag.draggingPage}
          dropTarget={drag.dropTarget}
          collapsedId={drag.collapsedId}
          externalCount={drag.externalCount}
          canvasRef={canvasRef}
          onScaleChange={onScaleChange}
          onSettle={onSettle}
          onBackgroundClick={collection.clearSelection}
          onOpen={openViaDialog}
          onSelectPage={collection.selectPage}
          onOpenPage={fullViewState.openPage}
          onPageDragStart={drag.startPageDrag}
          onPageDragEnd={drag.clearDrag}
          onAddPage={addPagesToDoc}
          onMoveDoc={collection.moveDoc}
          onRemoveDoc={collection.removeDoc}
          onRenameDoc={collection.renameDoc}
          onRotatePage={collection.rotatePage}
          cropTargetPageId={cropTarget?.pageId ?? null}
          onStartCrop={handleStartCrop}
          onCropFinished={handleCropFinished}
          onCropCancel={() => setCropTarget(null)}
        />

        {pendingCrop && (() => {
          const doc = collection.docs.find((d) => d.id === pendingCrop.docId)
          if (!doc) return null
          const currentIndex = doc.pages.findIndex((p) => p.id === pendingCrop.pageId)
          return (
            <CropRangeDialog
              pageCount={doc.pages.length}
              currentIndex={Math.max(0, currentIndex)}
              onApply={(indices) => {
                collection.applyCrop(doc.id, indices.map((i) => doc.pages[i].id), pendingCrop.rect)
                setPendingCrop(null)
              }}
              onCancel={() => setPendingCrop(null)}
            />
          )
        })()}

        {fullView && fullViewDoc && (
          <FullView
            docs={docs}
            startDocId={fullView.docId}
            startPageId={fullView.pageId}
            originRect={fullView.originRect}
            onActivePageChange={fullViewState.setHiddenPageId}
            onClose={fullViewState.closeFullView}
            annotTool={annot.tool}
            onAnnotTool={handleAnnotTool}
            onAnnotCommit={handleAnnotCommit}
            annotDraftCount={annot.drafts.length}
            onSaveAnnots={() => void handleSaveAnnots()}
            busy={busy}
            stampPng={stampPng ?? undefined}
            onOpenSignaturePicker={handleOpenSignaturePicker}
            redactDrafts={annot.redactDrafts}
            onRedactDraft={annot.addRedactDraft}
            onApplyRedact={() => void handleApplyRedact()}
            onCancelRedact={handleCancelRedact}
          />
        )}

        {showSignaturePicker && (
          <SignaturePicker
            onPick={handlePickSignature}
            onClose={() => setShowSignaturePicker(false)}
          />
        )}

        {toast && <div className="toast">{toast}</div>}

        <WatermarkPanel
          step={watermark.step}
          candidates={watermark.candidates}
          selected={watermark.selected}
          onSelect={watermark.setSelected}
          onStrip={watermark.strip}
          onDismiss={watermark.dismiss}
          error={watermark.error}
        />
      </div>
    </FindProvider>
  )
}
