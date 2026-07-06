import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { Annot } from '@pdfx/core'
import { loadSource } from './pdfx/source'

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

  const handleAnnotCommit = useCallback((a: Annot) => {
    annot.addDraft(a)
  }, [annot.addDraft])

  // Save annotation drafts into the source PDF bytes, then reload the in-memory
  // PdfSource so the next full-view open renders the persisted annotation.
  const handleSaveAnnots = useCallback(async () => {
    if (annot.drafts.length === 0 || !fullViewState.fullView) return
    const docId = fullViewState.fullView.docId
    const doc = collection.docsRef.current.find((d) => d.id === docId)
    if (!doc || doc.pages.length === 0) return
    const srcId = doc.pages[0].source.id
    const srcBytes = doc.pages[0].source.bytes
    setBusy(true)
    try {
      const newBytes = await window.api.writeAnnots(srcBytes, annot.drafts)
      // Reload the PDF document proxy so pdfjs-dist can render the new annotations.
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
      annot.clearDrafts()
      flash(`Annotations saved`)
    } catch (err) {
      console.error('Save annotations failed', err)
      flash('Failed to save annotations')
    } finally {
      setBusy(false)
    }
  }, [annot.drafts, annot.clearDrafts, fullViewState.fullView, collection.docsRef, collection.setDocs, setBusy, flash])

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
    movePageInto: collection.movePageInto,
    movePageToNewDoc: collection.movePageToNewDoc,
    onExternalDrop: handleExternalDropFiles
  })

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

  useTestBridge(() => ({
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
    cropDialogOpen: pendingCrop !== null
  }))

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
    return window.api.onMenu((action) => {
      if (action === 'open') void openViaDialog()
      else if (action === 'export-pdfx') void exportCollection('pdfx')
      else if (action === 'export-pdf') void exportCollection('pdf')
      else if (action === 'export-zip') void exportZip()
    })
  }, [openViaDialog, exportCollection, exportZip])

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
          onZoomIn={() => canvasRef.current?.zoomIn()}
          onZoomOut={() => canvasRef.current?.zoomOut()}
          onZoomReset={() => canvasRef.current?.reset()}
          onOpen={openViaDialog}
          onExportPdf={() => exportCollection('pdf')}
          onExportZip={exportZip}
          annotTool={annot.tool}
          onAnnotTool={annot.setTool}
          annotDraftCount={annot.drafts.length}
          onSaveAnnots={() => void handleSaveAnnots()}
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
            onAnnotCommit={handleAnnotCommit}
          />
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>
    </FindProvider>
  )
}
