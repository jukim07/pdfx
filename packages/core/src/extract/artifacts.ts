import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseManifest, partitionPages } from '../format.js'
import { extractText, type PageText, type TextSpan } from './text.js'
import { renderPages } from './render.js'
import { createOcrEngine, type OcrEngine } from './ocr.js'
import { toMarkdown } from './markdown.js'

export type TextMethod = 'native' | 'ocr' | 'none'

export interface ArtifactPage {
  page: number // 1-based number in PDF
  doc: string // owning document name
  pageInDoc: number // 1-based number within owning document
  png: string | null // bundle-relative path, e.g. "pages/p0001.png"
  textMethod: TextMethod
}

export interface ArtifactDoc {
  name: string
  pages: number // total pages document owns in source
  markdown: string | null // bundle-relative path, e.g. "Invoice.md"
}

export interface ArtifactManifest {
  source: { sha256: string; bytes: number; pageCount: number; title: string | null }
  docs: ArtifactDoc[]
  pages: ArtifactPage[]
  dpi: number
  createdAt: string
}

export interface ExtractArtifactsOptions {
  formats?: ('md' | 'png')[] // default both
  dpi?: number // default 150
  pages?: number[] // 1-based source pages, default all
  ocr?: boolean // default true
  ocrLang?: string // default 'eng'
  ocrThreshold?: number // min native chars before OCR; default 20
}

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g

// Mirrors export-name sanitizing + dedupe in src/renderer/src/app/useExport.ts:57-62.
function docMarkdownNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    const safe = name.replace(ILLEGAL_FILENAME_CHARS, '-').trim() || 'Untitled'
    let filename = `${safe}.md`
    for (let n = 2; used.has(filename); n++) filename = `${safe} (${n}).md`
    used.add(filename)
    return filename
  })
}

async function inspectPdf(
  bytes: Uint8Array,
  pages?: number[]
): Promise<{ pageCount: number; withImages: Set<number> }> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise
  try {
    const pageCount = pdf.numPages
    const pageNumbers = pages ?? Array.from({ length: pageCount }, (_, i) => i + 1)
    const withImages = new Set<number>()
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > pageCount) {
        throw new Error(`Page ${pageNumber} out of range (1-${pageCount})`)
      }
      const page = await pdf.getPage(pageNumber)
      const ops = await page.getOperatorList()
      const hasImage =
        ops.fnArray.includes(OPS.paintImageXObject) ||
        ops.fnArray.includes(OPS.paintInlineImageXObject) ||
        ops.fnArray.includes(OPS.paintImageXObjectRepeat)
      if (hasImage) withImages.add(pageNumber)
    }
    return { pageCount, withImages }
  } finally {
    await pdf.destroy()
  }
}

function ocrSpans(text: string): TextSpan[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({ str: line, fontSize: 0, hasEOL: true }))
}

export async function extractArtifacts(
  bytes: Uint8Array,
  outDir: string,
  opts: ExtractArtifactsOptions = {}
): Promise<ArtifactManifest> {
  const formats = opts.formats ?? ['md', 'png']
  const dpi = opts.dpi ?? 150
  const ocrEnabled = opts.ocr !== false
  const ocrThreshold = opts.ocrThreshold ?? 20

  await mkdir(outDir, { recursive: true })

  // Parse embedded manifest (null for plain PDFs) and get image-page set.
  const embedded = await parseManifest(bytes)
  const { pageCount, withImages } = await inspectPdf(bytes, opts.pages)

  const parts = partitionPages(embedded, pageCount, 'Document')
  const selected = opts.pages ?? Array.from({ length: pageCount }, (_, i) => i + 1)
  const selectedSet = new Set(selected)

  // 1. Rasterize. OCR needs page rasters even when caller skipped PNG
  // output, so keep bytes for selected pages in memory either way.
  const pngBytes = new Map<number, Uint8Array>()
  const pngPaths = new Map<number, string>()
  if (formats.includes('png') || ocrEnabled) {
    if (formats.includes('png')) await mkdir(join(outDir, 'pages'), { recursive: true })
    for await (const { page, png } of renderPages(bytes, { dpi, pages: selected })) {
      pngBytes.set(page, png)
      if (formats.includes('png')) {
        const rel = `pages/p${String(page).padStart(4, '0')}.png`
        await writeFile(join(outDir, rel), png)
        pngPaths.set(page, rel)
      }
    }
  }

  // 2. Native text, with OCR fallback for image-bearing pages under threshold.
  const pageTexts = new Map<number, PageText>()
  for (const pageText of await extractText(bytes, { pages: selected })) {
    pageTexts.set(pageText.page, pageText)
  }
  const textMethods = new Map<number, TextMethod>()
  let engine: OcrEngine | null = null
  try {
    for (const page of selected) {
      const native = pageTexts.get(page)!
      const nativeLength = native.text.trim().length
      if (nativeLength >= ocrThreshold) {
        textMethods.set(page, 'native')
        continue
      }
      if (ocrEnabled && withImages.has(page)) {
        engine ??= await createOcrEngine(opts.ocrLang ?? 'eng')
        const text = (await engine.recognize(pngBytes.get(page)!)).trim()
        if (text.length > 0) {
          pageTexts.set(page, { page, text, spans: ocrSpans(text) })
          textMethods.set(page, 'ocr')
          continue
        }
      }
      textMethods.set(page, nativeLength > 0 ? 'native' : 'none')
    }
  } finally {
    if (engine) await engine.terminate()
  }

  // 3. Build docs and per-page markdown, write markdown files.
  const mdNames = docMarkdownNames(parts.map((p) => p.name))
  const docs: ArtifactDoc[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const docPages = part.indices.map((idx) => idx + 1).filter((page) => selectedSet.has(page))
    let markdown: string | null = null
    if (formats.includes('md') && docPages.length > 0) {
      markdown = mdNames[i]
      const pagesForDoc = docPages.map((page) => pageTexts.get(page)!)
      const md = toMarkdown(pagesForDoc)
      await writeFile(join(outDir, markdown), md, 'utf8')
    }

    docs.push({ name: part.name, pages: part.indices.length, markdown })
  }

  // 4. Build the pages array in source-page order.
  const pages: ArtifactPage[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    part.indices.forEach((index, position) => {
      const page = index + 1
      if (!selectedSet.has(page)) return
      pages.push({
        page,
        doc: part.name,
        pageInDoc: position + 1,
        png: pngPaths.get(page) ?? null,
        textMethod: textMethods.get(page)!
      })
    })
  }

  const manifest: ArtifactManifest = {
    source: {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      pageCount,
      title: embedded?.title ?? null
    },
    docs,
    pages,
    dpi,
    createdAt: new Date().toISOString()
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return manifest
}
