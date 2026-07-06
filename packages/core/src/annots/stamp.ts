import { PDFDocument, PDFName } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import type { StampAnnot } from './model.js'

/** Build a /Stamp annot whose /AP /N is a Form XObject that draws the embedded PNG,
 *  then append its ref to the page's /Annots (same plumbing as annots/write.ts). */
async function stampRef(doc: PDFDocument, page: PDFPage, s: StampAnnot) {
  const ctx = doc.context
  const image = await doc.embedPng(s.png)
  const { x, y, w, h } = s.rect

  // Form XObject content: place the image scaled to the annot rect.
  // BBox is the annot's own coordinate space (0..w, 0..h). The cm matrix maps
  // the unit-image space to the rect size; Do paints the XObject named /Img.
  const content = `q ${w} 0 0 ${h} 0 0 cm /Img Do Q`
  const xobject = ctx.flateStream(content, {
    Type: 'XObject',
    Subtype: 'Form',
    FormType: 1,
    BBox: [0, 0, w, h],
    Resources: { XObject: { Img: image.ref } },
  })
  const apRef = ctx.register(xobject)

  const dict = ctx.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Stamp'),
    Rect: [x, y, x + w, y + h],
    AP: { N: apRef },
    P: page.ref,
  })
  return ctx.register(dict)
}

export async function writeStampAnnots(
  bytes: Uint8Array,
  stamps: StampAnnot[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const pages = doc.getPages()
  for (const s of stamps) {
    const page = pages[s.page]
    if (!page) throw new Error(`stamp references page ${s.page} but doc has ${pages.length} pages`)
    const ref = await stampRef(doc, page, s)
    page.node.addAnnot(ref)
  }
  return doc.save()
}
