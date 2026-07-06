import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFArray,
  rgb,
  decodePDFRawStream,
} from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import { tokenizeContent, stripOps, SHOW_OPS } from './content-stream.js'
import type { ContentOp } from './content-stream.js'
import { removeContainedImages } from './redact-images.js'
import { StreamSurgeryError, regionsFromQuads } from './redact-model.js'
import type { RedactRegion, RedactOptions } from './redact-model.js'
import { itemQuad, quadsIntersectRect } from '../annots/quads.js'
import type { TextItemLike } from '../annots/quads.js'
import type { Quad, Rect } from '../annots/model.js'

// Use SAME pdfjs import Phase ① uses in extract/text.ts.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

interface PageItems {
  items: TextItemLike[]
  quads: Quad[]
}

async function pdfJsPageItems(
  bytes: Uint8Array,
  pages: Set<number>,
): Promise<Map<number, PageItems>> {
  // .slice(): pdfjs detaches the ArrayBuffer — callers keep theirs.
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise
  const out = new Map<number, PageItems>()
  for (const p of pages) {
    const page = await doc.getPage(p + 1) // pdfjs is 1-based
    const content = await page.getTextContent({ includeMarkedContent: false })
    const items = content.items.filter((it: unknown): it is TextItemLike => {
      return typeof it === 'object' && it !== null && 'str' in it && 'transform' in it
    }) as TextItemLike[]
    out.set(p, { items, quads: items.map(itemQuad) })
  }
  await doc.destroy()
  return out
}

/** Concatenate page's content stream(s), per PDF spec stream concatenation. */
function decodeContents(page: PDFPage): Uint8Array {
  const contents = page.node.Contents()
  if (!contents) return new Uint8Array()

  const streams: PDFRawStream[] = []
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const ref = contents.get(i)
      const resolved = page.doc.context.lookup(ref)
      if (resolved instanceof PDFRawStream) streams.push(resolved)
    }
  } else {
    // PDFStream — runtime type is PDFRawStream (content streams always are)
    streams.push(contents as unknown as PDFRawStream)
  }

  const parts: Uint8Array[] = streams.map((s) => decodePDFRawStream(s).decode())
  if (parts.length === 1) return parts[0]

  // Concatenate with newline separators per PDF spec
  const total = parts.reduce((acc, p) => acc + p.length + 1, 0)
  const buf = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    buf.set(p, at)
    at += p.length
    buf[at++] = 0x0a
  }
  return buf
}

function rectsForPage(regions: RedactRegion[], page: number): Rect[] {
  return regions.filter((r) => r.page === page).map((r) => r.rect)
}

export async function assertNoSurvivors(bytes: Uint8Array, regions: RedactRegion[]): Promise<void> {
  const pages = new Set(regions.map((r) => r.page))
  const byPage = await pdfJsPageItems(bytes, pages)
  for (const [page, { items, quads }] of byPage) {
    const rects = rectsForPage(regions, page)
    for (let i = 0; i < items.length; i++) {
      if (items[i].str.trim().length === 0) continue
      if (rects.some((rect) => quadsIntersectRect([quads[i]], rect))) {
        throw new StreamSurgeryError(page, `text still extractable in region: "${items[i].str}"`)
      }
    }
  }
}

export async function redactRegions(
  bytes: Uint8Array,
  regions: RedactRegion[],
  opts: RedactOptions,
): Promise<Uint8Array> {
  if (regions.length === 0) return bytes

  if (opts.mode === 'rasterize') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error Task 7 module does not exist yet; fails at runtime only if rasterize mode requested
    const { rasterizeRedact } = await import('./redact-rasterize.js') // Task 7
    return rasterizeRedact(bytes, regions, opts)
  }

  const pageSet = new Set(regions.map((r) => r.page))
  const itemsByPage = await pdfJsPageItems(bytes, pageSet)
  const doc = await PDFDocument.load(bytes)
  const pages = doc.getPages()

  for (const pageIndex of pageSet) {
    const page = pages[pageIndex]
    if (!page) throw new Error(`region references page ${pageIndex} but doc has ${pages.length}`)
    const rects = rectsForPage(regions, pageIndex)

    // Work on the (possibly already spliced) stream so both passes see the same bytes.
    let current = decodeContents(page)
    let streamChanged = false

    // --- Text surgery pass ---
    const pageItems = itemsByPage.get(pageIndex)
    if (pageItems) {
      const { items, quads } = pageItems
      const ops = tokenizeContent(current)
      const showOps = ops.filter((op) => SHOW_OPS.has(op.operator))

      // Fast-path guard: 1:1 correspondence between show-ops and pdfjs items is required
      // so we can map by index. Mismatch → throw rather than under-redact.
      if (showOps.length !== items.length) {
        throw new StreamSurgeryError(
          pageIndex,
          `show-op count (${showOps.length}) ≠ pdfjs item count (${items.length}); cannot guarantee safe removal`,
        )
      }

      const toRemove = new Set<ContentOp>()
      for (let i = 0; i < showOps.length; i++) {
        if (rects.some((rect) => quadsIntersectRect([quads[i]], rect))) {
          toRemove.add(showOps[i])
        }
      }

      if (toRemove.size > 0) {
        // `'` and `"` ops advance the current text line as a side effect; replace
        // with T* to preserve line positioning so surrounding text stays aligned.
        current = stripOps(current, toRemove, (op) => {
          if (op.operator === "'") return 'T*'
          if (op.operator === '"') return 'T*'
          return ''
        })
        streamChanged = true
      }
    }

    // --- Image XObject removal pass (Task 5) ---
    // Runs on `current` (text-rewritten stream) so both passes compose correctly.
    const { rewritten, removed } = removeContainedImages(doc, page, current, rects)
    if (removed > 0) {
      current = rewritten
      streamChanged = true
    }

    if (streamChanged) {
      const ref = doc.context.register(doc.context.flateStream(current))
      page.node.set(PDFName.of('Contents'), ref)
    }
  }

  let out = await doc.save()
  await assertNoSurvivors(out, regions) // fail closed — Known risks 1 & 2

  // Cosmetic layer: draw black box ABOVE all content on second pass.
  const doc2 = await PDFDocument.load(out)
  const pages2 = doc2.getPages()
  for (const r of regions) {
    const page = pages2[r.page]
    if (opts.mode === 'blur') {
      // Task 6 replaces with real blur; until then black box (text
      // already removed above, so leak post-condition holds either way).
      page.drawRectangle({
        x: r.rect.x,
        y: r.rect.y,
        width: r.rect.w,
        height: r.rect.h,
        color: rgb(0, 0, 0),
      })
    } else {
      page.drawRectangle({
        x: r.rect.x,
        y: r.rect.y,
        width: r.rect.w,
        height: r.rect.h,
        color: rgb(0, 0, 0),
      })
    }
  }
  return doc2.save()
}

/** Find pattern matches in extracted text, redact covering item quads.
 * Over-approximates to whole matched items (fail-safe: never under-redacts). */
export async function redactText(
  bytes: Uint8Array,
  pattern: string | RegExp,
  opts: RedactOptions & { pages?: number[] },
): Promise<Uint8Array> {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise
  const re =
    typeof pattern === 'string'
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      : new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')

  const numPages = doc.numPages
  const targetPages =
    opts.pages ?? Array.from({ length: numPages }, (_, i) => i) // 0-based

  const regions: RedactRegion[] = []

  for (const p of targetPages) {
    const page = await doc.getPage(p + 1) // pdfjs is 1-based
    const content = await page.getTextContent({ includeMarkedContent: false })
    const items = content.items.filter((it: unknown): it is TextItemLike => {
      return typeof it === 'object' && it !== null && 'str' in it && 'transform' in it
    }) as TextItemLike[]

    // Build a concatenated string with range tracking to locate matching items.
    const ranges: Array<{ start: number; end: number; item: TextItemLike }> = []
    let text = ''
    for (const item of items) {
      ranges.push({ start: text.length, end: text.length + item.str.length, item })
      text += item.str
    }

    for (const m of text.matchAll(re)) {
      const mStart = m.index!
      const mEnd = mStart + m[0].length
      const hit = ranges.filter((r) => r.start < mEnd && r.end > mStart)
      const quads = hit.map((r) => itemQuad(r.item))
      regions.push(...regionsFromQuads(p, quads, 1))
    }
  }

  await doc.destroy()
  if (regions.length === 0) return bytes
  return redactRegions(bytes, regions, opts)
}
