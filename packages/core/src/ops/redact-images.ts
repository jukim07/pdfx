import { PDFName, PDFDict, PDFRef, PDFRawStream } from 'pdf-lib'
import type { PDFDocument, PDFPage } from 'pdf-lib'
import { tokenizeContent, stripOps } from './content-stream.js'
import type { ContentOp } from './content-stream.js'
import type { Rect } from '../annots/model.js'

interface Mat {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}
const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

// PDF matrix multiplication: n applied first, then m (cm post-multiplies the CTM).
function mul(m: Mat, n: Mat): Mat {
  return {
    a: n.a * m.a + n.b * m.c,
    b: n.a * m.b + n.b * m.d,
    c: n.c * m.a + n.d * m.c,
    d: n.c * m.b + n.d * m.d,
    e: n.e * m.a + n.f * m.c + m.e,
    f: n.e * m.b + n.f * m.d + m.f,
  }
}

function apply(m: Mat, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }
}

/** Device-space AABB of the unit square through the CTM (how an image XObject paints). */
function unitSquareBox(m: Mat): Rect {
  const pts = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)]
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

function containedIn(box: Rect, r: Rect): boolean {
  return box.x >= r.x && box.y >= r.y && box.x + box.w <= r.x + r.w && box.y + box.h <= r.y + r.h
}

/**
 * Collect every PDFRef referenced from any page's /Resources /XObject dict,
 * excluding the current page's own xobjects dict so we can tell if a ref is
 * shared with at least one other page before deleting it.
 */
function otherPageXObjectRefs(doc: PDFDocument, currentPage: PDFPage): Set<PDFRef> {
  const shared = new Set<PDFRef>()
  const currentNode = currentPage.node
  for (const p of doc.getPages()) {
    if (p.node === currentNode) continue
    const xobj = p.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobj) continue
    for (const key of xobj.keys()) {
      const val = xobj.get(key as PDFName)
      if (val instanceof PDFRef) shared.add(val)
    }
  }
  return shared
}

/**
 * Walk the content stream, tracking the CTM (q/Q stack + cm ops). For each Do op
 * that paints an image XObject whose device bbox is fully contained in any redaction
 * region: drop the Do op, remove the XObject entry from the page Resources dict, and
 * delete the object from the context so image bytes leave the file — UNLESS the same
 * ref is referenced by another page's Resources /XObject (e.g. a shared logo). In
 * that case the Do op and this page's Resources entry are still removed (the image no
 * longer paints on this page), but the object bytes are kept because another page
 * legitimately uses them.
 * Inline images in the same position are also dropped (their bytes live in the stream,
 * so stripOps removes them).
 */
export function removeContainedImages(
  doc: PDFDocument,
  page: PDFPage,
  src: Uint8Array,
  rects: Rect[],
): { rewritten: Uint8Array; removed: number } {
  const ops = tokenizeContent(src)
  const resources = page.node.Resources()
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)

  // Lazily computed on first image hit to avoid scanning all pages on text-only docs.
  let sharedRefs: Set<PDFRef> | undefined

  const remove = new Set<ContentOp>()
  const deadNames: string[] = []
  const stack: Mat[] = []
  let ctm = IDENTITY

  for (const op of ops) {
    if (op.operator === 'q') {
      stack.push(ctm)
    } else if (op.operator === 'Q') {
      ctm = stack.pop() ?? IDENTITY
    } else if (op.operator === 'cm' && op.operands.length === 6) {
      const [a, b, c, d, e, f] = op.operands.map((t) => parseFloat(t.text))
      ctm = mul(ctm, { a, b, c, d, e, f })
    } else if (op.operator === 'Do' && op.operands.length === 1 && xobjects) {
      const name = op.operands[0].text.slice(1) // strip leading /
      const raw = xobjects.get(PDFName.of(name))
      // The entry is typically a PDFRef; resolve to check Subtype.
      const ref = raw instanceof PDFRef ? raw : undefined
      const stream = ref != null ? doc.context.lookup(ref) : raw
      const isImage =
        stream instanceof PDFRawStream &&
        stream.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString() === '/Image'
      if (isImage && rects.some((r) => containedIn(unitSquareBox(ctm), r))) {
        remove.add(op)
        deadNames.push(name)
        if (ref != null) {
          // Only evict the object bytes if no other page holds a reference to it.
          // If another page uses the same image (e.g. a logo on every page), keep
          // the object alive; only this page's Resources entry and Do op are removed.
          sharedRefs ??= otherPageXObjectRefs(doc, page)
          if (!sharedRefs.has(ref)) {
            doc.context.delete(ref) // bytes leave the file
          }
        }
      }
    } else if (op.operator === 'INLINE_IMAGE') {
      // Inline images paint into the current CTM just like Do. Their bytes are
      // embedded in the stream so stripOps removes them with the op itself.
      if (rects.some((r) => containedIn(unitSquareBox(ctm), r))) {
        remove.add(op)
      }
    }
  }

  for (const name of deadNames) {
    xobjects?.delete(PDFName.of(name))
  }

  if (remove.size === 0) return { rewritten: src, removed: 0 }
  return { rewritten: stripOps(src, remove), removed: remove.size }
}
