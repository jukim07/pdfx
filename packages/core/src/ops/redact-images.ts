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
 * Walk the content stream, tracking the CTM (q/Q stack + cm ops). For each Do op
 * that paints an image XObject whose device bbox is fully contained in any redaction
 * region: drop the Do op, remove the XObject entry from the page Resources dict, and
 * ctx.delete(ref) so the image bytes leave the file. Inline images in the same position
 * are also dropped (their bytes live in the stream, so stripOps removes them).
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
        if (ref != null) doc.context.delete(ref) // bytes leave the file
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
