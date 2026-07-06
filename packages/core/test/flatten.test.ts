import { describe, it, expect } from 'vitest'
import { inflateSync } from 'zlib'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef, PDFDict } from 'pdf-lib'
import { writeAnnots } from '../src/annots/write.js'
import { writeStampAnnots } from '../src/annots/stamp.js'
import { flattenAnnots } from '../src/ops/flatten.js'
import { renderPages } from '../src/extract/render.js'
import type { Annot } from '../src/annots/model.js'

// Minimal 1×1 white PNG (67 bytes) — used for stamp tests.
const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length + type
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // bit depth=8, colorType=2 (RGB), CRC
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk length + type
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // compressed pixel data
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // data + CRC
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk length + type
  0x44, 0xae, 0x42, 0x60, 0x82,                   // IEND CRC
])

/**
 * Decode all content streams on the first page of a saved PDF and return their
 * concatenated operator text.  Works on PDFs written by pdf-lib (content
 * streams are FlateDecode-compressed; after doc.save() they come back as
 * PDFRawStream with the raw deflate bytes).
 */
async function pageContentText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const page = doc.getPages()[0]
  const contents = page.node.Contents()
  if (!contents) return ''

  const streams: PDFRawStream[] = []

  if (contents instanceof PDFArray) {
    // Contents is an array of indirect refs to content streams.
    for (let i = 0; i < contents.size(); i++) {
      const ref = contents.get(i)
      if (ref instanceof PDFRef) {
        const obj = doc.context.lookup(ref)
        if (obj instanceof PDFRawStream) streams.push(obj)
      }
    }
  } else if (contents instanceof PDFRawStream) {
    streams.push(contents)
  }

  const parts: string[] = []
  for (const s of streams) {
    const raw = s.getContents()
    try {
      parts.push(new TextDecoder().decode(inflateSync(raw)))
    } catch {
      // Stream was not compressed (rare for pdf-lib output); use as-is.
      parts.push(new TextDecoder().decode(raw))
    }
  }
  return parts.join('\n')
}

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  return doc.save()
}

describe('flattenAnnots', () => {
  it('removes /Annots after flattening highlight', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
        color: { r: 1, g: 0.83, b: 0.29 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening underline', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'underline',
        page: 0,
        quads: [{ x1: 50, y1: 600, x2: 200, y2: 600, x3: 50, y3: 588, x4: 200, y4: 588 }],
        color: { r: 0, g: 0, b: 1 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening strikeout', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'strikeout',
        page: 0,
        quads: [{ x1: 50, y1: 600, x2: 200, y2: 600, x3: 50, y3: 588, x4: 200, y4: 588 }],
        color: { r: 1, g: 0, b: 0 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening note', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'note',
        page: 0,
        rect: { x: 20, y: 700, w: 20, h: 20 },
        color: { r: 1, g: 1, b: 0 },
        contents: 'hello',
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening freetext', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'text',
        page: 0,
        rect: { x: 50, y: 400, w: 200, h: 50 },
        contents: 'Free text annotation',
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('removes /Annots after flattening ink', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'ink',
        page: 0,
        paths: [[10, 10, 20, 20, 30, 10]],
        color: { r: 0, g: 0, b: 1 },
        borderWidth: 2,
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('content stream grows after flattening highlight', async () => {
    const blank = await blankPdf()
    const withAnnot = await writeAnnots(blank, [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
        color: { r: 1, g: 0.83, b: 0.29 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    // Flattened output must be larger than the annotation-only version
    // (content stream has grown with drawing operators)
    expect(flat.length).toBeGreaterThan(blank.length)
  })

  it('handles page with no annots — /Annots stays absent', async () => {
    const pdf = await blankPdf()
    const flat = await flattenAnnots(pdf)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('flattens multiple annots across same page', async () => {
    const annots: Annot[] = [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 700, x2: 200, y2: 700, x3: 100, y3: 688, x4: 200, y4: 688 }],
        color: { r: 1, g: 1, b: 0 },
      },
      {
        type: 'underline',
        page: 0,
        quads: [{ x1: 100, y1: 650, x2: 200, y2: 650, x3: 100, y3: 638, x4: 200, y4: 638 }],
        color: { r: 0, g: 0, b: 1 },
      },
    ]
    const withAnnot = await writeAnnots(await blankPdf(), annots)
    const flat = await flattenAnnots(withAnnot)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('stamp annot: /Annots removed after flattening', async () => {
    // writeStampAnnots adds a /Stamp annot with /AP /N appearance stream;
    // flattenAnnots must remove /Annots AND draw the appearance into content.
    const withStamp = await writeStampAnnots(await blankPdf(), [
      { page: 0, rect: { x: 100, y: 200, w: 50, h: 30 }, png: TINY_PNG },
    ])
    const flat = await flattenAnnots(withStamp)
    const doc = await PDFDocument.load(flat)
    expect(doc.getPages()[0].node.Annots()).toBeUndefined()
  })

  it('stamp flatten: /AP /N XObject copied into page /Resources and invoked via Do', async () => {
    // After flattening: no /Annots, the stamp's Form XObject must live in the
    // page's /Resources /XObject, and the content stream must contain a Do call.
    const withStamp = await writeStampAnnots(await blankPdf(), [
      { page: 0, rect: { x: 100, y: 200, w: 50, h: 30 }, png: TINY_PNG },
    ])
    const flat = await flattenAnnots(withStamp)

    const doc = await PDFDocument.load(flat)
    const page = doc.getPages()[0]

    // (a) No /Annots remaining
    expect(page.node.Annots()).toBeUndefined()

    // (b) Page /Resources /XObject has at least one entry
    const resources = page.node.Resources()
    expect(resources).toBeDefined()
    const xobjDict = resources!.lookupMaybe(PDFName.of('XObject'), PDFDict)
    expect(xobjDict).toBeDefined()
    expect(xobjDict!.keys().length).toBeGreaterThan(0)

    // (c) Content stream invokes the XObject via Do
    const text = await pageContentText(flat)
    expect(text).toContain('Do')
  })

  it('stamp flatten: content stream placement matrix encodes rect x/y/w/h', async () => {
    // stamp.ts BBox=[0,0,w,h], no /Matrix → sx=sy=1, CTM = translate(x,y).
    // Correct cm: "1 0 0 1 x y cm" → "1 0 0 1 100 200 cm"
    // (Previously wrong: "50 0 0 30 100 200 cm" double-scaled the BBox extents.)
    const withStamp = await writeStampAnnots(await blankPdf(), [
      { page: 0, rect: { x: 100, y: 200, w: 50, h: 30 }, png: TINY_PNG },
    ])
    const flat = await flattenAnnots(withStamp)
    const text = await pageContentText(flat)
    expect(text).toContain('1 0 0 1 100 200 cm')
  })

  it('returns valid PDF bytes (parseable by PDFDocument.load)', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 10, y3: 10, x4: 30, y4: 10 }],
        color: { r: 1, g: 1, b: 0 },
        opacity: 0.5,
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    // Should not throw
    await expect(PDFDocument.load(flat)).resolves.toBeDefined()
  })

  it('stamp flatten: rendered ink bbox lands inside rect, not page-filling (regression)', async () => {
    // This test catches the double-scaling bug from commit 87c6932 where
    // concatTransformationMatrix(w,0,0,h,x,y) was used instead of (1,0,0,1,x,y).
    // The wrong matrix mapped form point (w,h) → (x+w², y+h²), producing a
    // page-filling red blob instead of a 50×30 pt stamp at (100,200).
    //
    // Build a solid-red 4×4 PNG stamp placed at rect {x:100, y:200, w:50, h:30}
    // on a 612×792 page.  At 72 dpi (scale=1) render to raster and measure the
    // bounding box of red pixels.
    //
    // Page coords (PDF, bottom-left origin):
    //   stamp occupies x∈[100,150], y_pdf∈[200,230]
    // Raster coords (top-left origin, 72dpi → 1px/pt, page height=792):
    //   raster_x ∈ [100, 150]
    //   raster_y ∈ [792-230, 792-200] = [562, 592]
    // Allow ±2px tolerance for rendering sub-pixel rounding.

    // Build a 4×4 solid-red PNG.
    const stampCanvas = createCanvas(4, 4)
    const ctx = stampCanvas.getContext('2d')
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 4, 4)
    const redPng = new Uint8Array(stampCanvas.encodeSync('png'))

    const withStamp = await writeStampAnnots(await blankPdf(), [
      { page: 0, rect: { x: 100, y: 200, w: 50, h: 30 }, png: redPng },
    ])
    const flat = await flattenAnnots(withStamp)

    // Render at 72 dpi → 1 PDF point = 1 pixel; page renders to 612×792.
    let renderedPng: Uint8Array | undefined
    for await (const { png } of renderPages(flat, { dpi: 72, pages: [1] })) {
      renderedPng = png
    }
    expect(renderedPng).toBeDefined()

    // Decode the PNG and find the axis-aligned bounding box of red pixels.
    // A red pixel: r > 200 && g < 50 && b < 50.
    const img = await loadImage(renderedPng!)
    const imgCanvas = createCanvas(img.width, img.height)
    const imgCtx = imgCanvas.getContext('2d')
    imgCtx.drawImage(img, 0, 0)
    const imageData = imgCtx.getImageData(0, 0, img.width, img.height)
    const { data, width, height } = imageData

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const idx = (py * width + px) * 4
        const r = data[idx], g = data[idx + 1], b = data[idx + 2]
        if (r > 200 && g < 50 && b < 50) {
          if (px < minX) minX = px
          if (px > maxX) maxX = px
          if (py < minY) minY = py
          if (py > maxY) maxY = py
        }
      }
    }

    // Before the fix (double-scaling): red ink filled most of the page,
    // e.g. minX≈100, maxX≈611, minY≈0, maxY≈591 (empirically confirmed).
    // After the fix: red ink bbox is tightly around the stamp rect.
    const TOL = 2
    expect(minX).toBeGreaterThanOrEqual(100 - TOL)
    expect(maxX).toBeLessThanOrEqual(150 + TOL)
    expect(minY).toBeGreaterThanOrEqual(562 - TOL) // 792-230
    expect(maxY).toBeLessThanOrEqual(592 + TOL)    // 792-200
  }, 30_000) // render takes ~1s

  // ──────────────────────────────────────────────────────────────────────────
  // Draw-operator locks: each subtype below asserts the actual PDF operators
  // landed in the content stream.  A silent no-op in a flatten.ts `case`
  // branch would still pass the /Annots-removal tests above; these tests lock
  // the real drawing path.
  // ──────────────────────────────────────────────────────────────────────────

  it('underline flatten: stroke line drawn at quad bottom edge', async () => {
    // Fixture quad: x1=50,y1=600,x2=200,y2=600,x3=50,y3=588,x4=200,y4=588
    // quadBox → {x:50, y:588, w:150, h:12}
    // drawLine at bottom edge: start=(50,588) end=(200,588)
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'underline',
        page: 0,
        quads: [{ x1: 50, y1: 600, x2: 200, y2: 600, x3: 50, y3: 588, x4: 200, y4: 588 }],
        color: { r: 0, g: 0, b: 1 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const text = await pageContentText(flat)
    // pdf-lib's drawLine emits moveTo(x1,y1) → lineTo(x2,y2) → S (stroke)
    expect(text).toContain('50 588 m')
    expect(text).toContain('200 588 l')
    // Stroke operator present (uppercase S = stroke without close; lowercase s = close+stroke)
    expect(text).toMatch(/\bS\b|\bs\b/)
  })

  it('strikeout flatten: stroke line drawn at quad vertical midpoint', async () => {
    // Fixture quad same as underline fixture above.
    // quadBox → {x:50, y:588, w:150, h:12}; midY = 588 + 12/2 = 594
    // drawLine at midpoint: start=(50,594) end=(200,594)
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'strikeout',
        page: 0,
        quads: [{ x1: 50, y1: 600, x2: 200, y2: 600, x3: 50, y3: 588, x4: 200, y4: 588 }],
        color: { r: 1, g: 0, b: 0 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const text = await pageContentText(flat)
    expect(text).toContain('50 594 m')
    expect(text).toContain('200 594 l')
    expect(text).toMatch(/\bS\b|\bs\b/)
  })

  it('note flatten: filled rect operator drawn at annotation rect origin', async () => {
    // Fixture: rect {x:20, y:700, w:20, h:20}
    // pdf-lib drawRectangle emits a CTM translate to the rect origin, then draws
    // a closed path from (0,0) and fills it.  It does NOT use the `re` shorthand.
    // Observed stream: "1 0 0 1 20 700 cm" → path corners → "f"
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'note',
        page: 0,
        rect: { x: 20, y: 700, w: 20, h: 20 },
        color: { r: 1, g: 1, b: 0 },
        contents: 'hello',
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const text = await pageContentText(flat)
    // CTM translate positions the rectangle at the fixture origin
    expect(text).toContain('1 0 0 1 20 700 cm')
    // Fill operator present (f)
    expect(text).toMatch(/\bf\b/)
  })

  it('freetext flatten: text-showing operators and baseline position in stream', async () => {
    // Fixture: rect {x:50, y:400, w:200, h:50}, fontSize:12
    // drawText baseline: x=50+2=52, y=400+50-12=438
    // pdf-lib hex-encodes text strings inside angle brackets, not as raw ASCII.
    // "Free text annotation" → <46726565207465787420616E6E6F746174696F6E>
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'text',
        page: 0,
        rect: { x: 50, y: 400, w: 200, h: 50 },
        contents: 'Free text annotation',
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const text = await pageContentText(flat)
    // Text block operators present
    expect(text).toContain('BT')
    expect(text).toContain('ET')
    // pdf-lib emits Tj for drawText
    expect(text).toContain('Tj')
    // Text matrix positions baseline at x=52, y=438 (rect.x+2, rect.y+rect.h-fontSize)
    expect(text).toContain('1 0 0 1 52 438 Tm')
    // Content string is hex-encoded: "Free text annotation"
    expect(text).toContain('<46726565207465787420616E6E6F746174696F6E>')
  })

  it('highlight flatten: quadBox-derived draw position and Multiply blend in resources', async () => {
    // Fixture quad: x1=100,y1=712,x2=150,y2=712,x3=100,y3=700,x4=150,y4=700
    // quadBox → {x:100, y:700, w:50, h:12}
    // pdf-lib drawRectangle emits CTM translate to (x,y) then draws path at (0,0).
    // Observed stream: "1 0 0 1 100 700 cm" with path corners (0,h)(w,h)(w,0).
    // BlendMode.Multiply → ExtGState with /BM /Multiply added to page resources.
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'highlight',
        page: 0,
        quads: [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
        color: { r: 1, g: 0.83, b: 0.29 },
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const text = await pageContentText(flat)
    // CTM translate positions the rectangle at the quadBox origin
    expect(text).toContain('1 0 0 1 100 700 cm')
    // Path corners encode the width (50) and height (12) of the bounding box
    expect(text).toContain('50 12 l')
    // Fill present
    expect(text).toMatch(/\bf\b/)
    // Multiply blend: pdf-lib inserts a gs operator referencing an ExtGState
    // with /BM /Multiply; the gs name appears in the content stream.
    expect(text).toContain('gs')
    // The page resources must carry an ExtGState dict containing /BM /Multiply
    const doc = await PDFDocument.load(flat)
    const page = doc.getPages()[0]
    const resources = page.node.Resources()
    const extGState = resources?.lookup(PDFName.of('ExtGState'))
    expect(extGState).toBeDefined()
    const extGStateStr = extGState!.toString()
    expect(extGStateStr).toContain('Multiply')
  })

  // Geometry lock: ink paths must be emitted in PDF user-space (origin
  // bottom-left) without any coordinate-space transformation.  drawSvgPath
  // applies an internal y-flip CTM "1 0 0 -1 0 0 cm" that mirrors all
  // coordinates around Y=0, rendering ink paths off-page.  Raw pushOperators
  // must emit the path with no such flip matrix anywhere in the ink graphics
  // state block.
  it('ink flatten: content stream contains untransformed PDF user-space coordinates', async () => {
    const withAnnot = await writeAnnots(await blankPdf(), [
      {
        type: 'ink',
        page: 0,
        paths: [[100, 700, 150, 650]],
        color: { r: 0, g: 0, b: 1 },
        borderWidth: 2,
      },
    ])
    const flat = await flattenAnnots(withAnnot)
    const text = await pageContentText(flat)
    // The PDF moveTo operator is 'm', lineTo is 'l'.
    // pdf-lib serialises integers without trailing zeros so "100 700 m".
    expect(text).toContain('100 700 m')
    expect(text).toContain('150 650 l')
    // drawSvgPath introduces a y-flip concat-matrix "1 0 0 -1 0 0 cm" that
    // mirrors coordinates around Y=0, placing the path off-page.  Raw
    // pushOperators must not introduce this transformation.
    expect(text).not.toContain('1 0 0 -1 0 0 cm')
  })
})
