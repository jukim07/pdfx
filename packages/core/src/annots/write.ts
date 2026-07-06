import { PDFDocument, PDFName, PDFString, PDFRef } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import type { Annot, MarkupAnnot, NoteAnnot, FreeTextAnnot, InkAnnot, Quad, RGB } from './model.js'

const SUBTYPE: Record<MarkupAnnot['type'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
}

/** Flat number[] for /QuadPoints: UL, UR, LL, LR per quad (PDF spec §12.5.6.10). */
function quadPoints(quads: Quad[]): number[] {
  const out: number[] = []
  for (const q of quads) {
    out.push(q.x1, q.y1, q.x2, q.y2, q.x3, q.y3, q.x4, q.y4)
  }
  return out
}

/** Axis-aligned bounding rect [llx, lly, urx, ury] enclosing all quads. */
function quadsRect(quads: Quad[]): number[] {
  const xs = quads.flatMap((q) => [q.x1, q.x2, q.x3, q.x4])
  const ys = quads.flatMap((q) => [q.y1, q.y2, q.y3, q.y4])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function colorArray(c: RGB): number[] {
  return [c.r, c.g, c.b]
}

function markupRef(page: PDFPage, a: MarkupAnnot): PDFRef {
  const ctx = page.doc.context
  const literal: Record<string, unknown> = {
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of(SUBTYPE[a.type]),
    Rect: quadsRect(a.quads),
    QuadPoints: quadPoints(a.quads),
    C: colorArray(a.color),
    P: page.ref,
  }
  if (a.opacity !== undefined) {
    literal['CA'] = a.opacity
  }
  if (a.contents !== undefined) {
    literal['Contents'] = PDFString.of(a.contents)
  }
  return ctx.register(ctx.obj(literal as Parameters<typeof ctx.obj>[0]))
}

function noteRef(page: PDFPage, a: NoteAnnot): PDFRef {
  const ctx = page.doc.context
  const literal: Record<string, unknown> = {
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: [a.rect.x, a.rect.y, a.rect.x + a.rect.w, a.rect.y + a.rect.h],
    C: colorArray(a.color),
    Contents: PDFString.of(a.contents),
    P: page.ref,
  }
  if (a.open !== undefined) {
    literal['Open'] = a.open
  }
  return ctx.register(ctx.obj(literal as Parameters<typeof ctx.obj>[0]))
}

function freeTextRef(page: PDFPage, a: FreeTextAnnot): PDFRef {
  const ctx = page.doc.context
  // /DA default appearance string: "<r> <g> <b> rg /Helv <size> Tf"
  const da = `${a.color.r} ${a.color.g} ${a.color.b} rg /Helv ${a.fontSize} Tf`
  const literal: Record<string, unknown> = {
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('FreeText'),
    Rect: [a.rect.x, a.rect.y, a.rect.x + a.rect.w, a.rect.y + a.rect.h],
    Contents: PDFString.of(a.contents),
    DA: PDFString.of(da),
    // 0 = left-align per PDF spec §12.7.3.3
    Q: 0,
    P: page.ref,
  }
  return ctx.register(ctx.obj(literal as Parameters<typeof ctx.obj>[0]))
}

function inkRef(page: PDFPage, a: InkAnnot): PDFRef {
  const ctx = page.doc.context
  const allX = a.paths.flatMap((p) => p.filter((_, i) => i % 2 === 0))
  const allY = a.paths.flatMap((p) => p.filter((_, i) => i % 2 === 1))
  const rect = [Math.min(...allX), Math.min(...allY), Math.max(...allX), Math.max(...allY)]

  // Build nested PDFArrays for /InkList manually — ctx.obj() flattens nested
  // arrays to flat PDFArrays rather than array-of-arrays. We must build the
  // inner arrays explicitly and push them into the outer array.
  const inkListArr = ctx.obj([]) // empty PDFArray
  for (const path of a.paths) {
    inkListArr.push(ctx.obj(path))
  }

  const dict = ctx.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Ink'),
    Rect: rect,
    C: colorArray(a.color),
    BS: { W: a.borderWidth },
    P: page.ref,
  })
  dict.set(PDFName.of('InkList'), inkListArr)

  return ctx.register(dict)
}

/**
 * Appends annotation dicts to each page's /Annots array.
 * Stamp annots are skipped (deferred to Phase 4b — requires embedded image ref).
 * Returns new PDF bytes.
 */
export async function writeAnnots(bytes: Uint8Array, annots: Annot[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const pages = doc.getPages()

  for (const a of annots) {
    if (a.type === 'stamp') continue // Phase 4b

    const page = pages[a.page]
    if (!page) {
      throw new Error(`annot references page ${a.page} but doc has ${pages.length} page(s)`)
    }

    let ref: PDFRef
    switch (a.type) {
      case 'highlight':
      case 'underline':
      case 'strikeout':
        ref = markupRef(page, a)
        break
      case 'note':
        ref = noteRef(page, a)
        break
      case 'text':
        ref = freeTextRef(page, a)
        break
      case 'ink':
        ref = inkRef(page, a)
        break
    }

    page.node.addAnnot(ref)
  }

  return doc.save()
}
