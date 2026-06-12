import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocument } from 'pdfjs-dist'
import { buildPdfx, importFile, stripExtension, type SourceDocument } from './pdfx/format'
import type { DocEntry } from './types'
import { Toolbar } from './components/Toolbar'
import { DocumentRow } from './components/DocumentRow'
import { EmptyState } from './components/EmptyState'

interface IncomingFile {
  name: string
  data: Uint8Array
}

async function makeEntry(source: SourceDocument): Promise<DocEntry> {
  const pdf = await getDocument({ data: source.bytes.slice() }).promise
  const pageSizes: { width: number; height: number }[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    pageSizes.push({ width: viewport.width, height: viewport.height })
  }
  return {
    id: crypto.randomUUID(),
    name: source.name,
    bytes: source.bytes,
    pdf,
    pageCount: pdf.numPages,
    pageSizes
  }
}

export default function App(): React.JSX.Element {
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const dragDepth = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }, [])

  const addFiles = useCallback(
    async (files: IncomingFile[]) => {
      if (files.length === 0) return
      setBusy(true)
      const failed: string[] = []
      for (const file of files) {
        try {
          const sources = await importFile(file.name, file.data)
          const entries: DocEntry[] = []
          for (const source of sources) {
            entries.push(await makeEntry(source))
          }
          setDocs((prev) => [...prev, ...entries])
        } catch (error) {
          console.error(`Failed to import ${file.name}`, error)
          failed.push(file.name)
        }
      }
      setBusy(false)
      if (failed.length > 0) flash(`Could not open ${failed.join(', ')}`)
    },
    [flash]
  )

  // Files opened via Finder / Explorer file association
  useEffect(() => {
    const unsubscribe = window.api.onFilesOpened((files) => void addFiles(files))
    void window.api.rendererReady()
    return unsubscribe
  }, [addFiles])

  const openViaDialog = useCallback(async () => {
    const files = await window.api.openFiles()
    await addFiles(files)
  }, [addFiles])

  const exportPdfx = useCallback(async () => {
    if (docs.length === 0) return
    const path = await window.api.chooseSavePath('untitled.pdfx')
    if (!path) return
    setBusy(true)
    try {
      const filename = path.split(/[\\/]/).pop() ?? 'untitled.pdfx'
      const bytes = await buildPdfx(
        docs.map((d) => ({ name: d.name, bytes: d.bytes })),
        stripExtension(filename)
      )
      const saved = await window.api.writeFile(path, bytes)
      flash(`Saved ${saved}`)
    } catch (error) {
      console.error('Export failed', error)
      flash('Export failed')
    } finally {
      setBusy(false)
    }
  }, [docs, flash])

  const removeDoc = useCallback((id: string) => {
    setDocs((prev) => {
      const entry = prev.find((d) => d.id === id)
      if (entry) void entry.pdf.destroy()
      return prev.filter((d) => d.id !== id)
    })
  }, [])

  const moveDoc = useCallback((id: string, direction: -1 | 1) => {
    setDocs((prev) => {
      const index = prev.findIndex((d) => d.id === id)
      const target = index + direction
      if (index === -1 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }, [])

  const onDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const dropped = Array.from(event.dataTransfer.files).filter((f) =>
        /\.(pdf|pdfx)$/i.test(f.name)
      )
      const files = await Promise.all(
        dropped.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))
      )
      await addFiles(files)
    },
    [addFiles]
  )

  const totalPages = docs.reduce((sum, d) => sum + d.pageCount, 0)

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <Toolbar
        documentCount={docs.length}
        pageCount={totalPages}
        busy={busy}
        onOpen={openViaDialog}
        onExport={exportPdfx}
      />

      <main className="content">
        {docs.length === 0 ? (
          <EmptyState busy={busy} onOpen={openViaDialog} />
        ) : (
          <div className="doc-list">
            {docs.map((doc, index) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                index={index}
                total={docs.length}
                onRemove={() => removeDoc(doc.id)}
                onMove={(direction) => moveDoc(doc.id, direction)}
              />
            ))}
            <button className="add-row" onClick={openViaDialog} disabled={busy}>
              + Add documents
            </button>
          </div>
        )}
      </main>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">Drop to add</div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
