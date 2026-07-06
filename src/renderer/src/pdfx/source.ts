import { getDocument } from 'pdfjs-dist'
import { PDFDocument, degrees } from 'pdf-lib'
import { findConverter, partitionPages, readManifest, stripExtension } from '@pdfx/core'
import type { ExportPage, PageSize, PdfxManifestDocumentSource } from '@pdfx/core'
import type { DocEntry, PageEntry, PdfSource } from '../types'

export interface LoadedSource {
  source: PdfSource
  sizes: PageSize[]
}


// A crafted PDF can advertise an enormous page count (or a shared/cyclic page tree)
// to exhaust renderer memory; refuse to materialize an absurd number of pages.
const MAX_PAGES = 10_000

export async function loadSource(bytes: Uint8Array): Promise<LoadedSource> {
  const pdf = await getDocument({ data: bytes.slice() }).promise
  if (pdf.numPages > MAX_PAGES) {
    throw new Error(`PDF declares ${pdf.numPages} pages; refusing to load more than ${MAX_PAGES}`)
  }
  const source: PdfSource = { id: crypto.randomUUID(), bytes, pdf }
  const sizes: PageSize[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    sizes.push({ width: viewport.width, height: viewport.height })
  }
  return { source, sizes }
}

export function pagesFromSource(
  source: PdfSource,
  sizes: PageSize[],
  indices: number[]
): PageEntry[] {
  return indices.map((pageIndex) => ({
    id: crypto.randomUUID(),
    source,
    pageIndex,
    width: sizes[pageIndex].width,
    height: sizes[pageIndex].height
  }))
}

export async function importIntoDocs(
  filename: string,
  bytes: Uint8Array,
  provenance?: PdfxManifestDocumentSource
): Promise<DocEntry[]> {
  const { source, sizes } = await loadSource(bytes)
  const manifest = await readManifest(source.pdf)
  // All partition entries of a multi-doc .pdfx get the same source object —
  // they all came from the same imported file.
  return partitionPages(manifest, source.pdf.numPages, stripExtension(filename)).map((part) => ({
    id: crypto.randomUUID(),
    name: part.name,
    pages: pagesFromSource(source, sizes, part.indices),
    source: provenance
  }))
}

export async function toExportPage(page: PageEntry): Promise<ExportPage> {
  if (!page.rotation && !page.cropBox) {
    return { sourceKey: page.source.id, bytes: page.source.bytes, pageIndex: page.pageIndex }
  }
  // Bake edits (rotation, crop) in a single load/save cycle instead of three
  // chained pullPages→rotatePages→cropPages each re-parsing the same bytes.
  const src = await PDFDocument.load(page.source.bytes, { ignoreEncryption: true })
  const out = await PDFDocument.create()
  const [copied] = await out.copyPages(src, [page.pageIndex])
  out.addPage(copied)
  const outPage = out.getPage(0)
  if (page.rotation) outPage.setRotation(degrees(((page.rotation % 360) + 360) % 360))
  if (page.cropBox) {
    const { x, y, width, height } = page.cropBox
    outPage.setCropBox(x, y, width, height)
  }
  return { sourceKey: page.id, bytes: await out.save(), pageIndex: 0 }
}

export async function loadIncomingPages(
  files: { name: string; data: Uint8Array; path?: string }[],
  reference?: PageSize
): Promise<PageEntry[]> {
  const entries: PageEntry[] = []
  for (const file of files) {
    const conv = findConverter(file.name, file.data)
    const bytes = conv ? await conv.toPdf(file.name, file.data, reference, file.path) : file.data
    const { source, sizes } = await loadSource(bytes)
    entries.push(
      ...pagesFromSource(
        source,
        sizes,
        sizes.map((_, i) => i)
      )
    )
  }
  return entries
}
