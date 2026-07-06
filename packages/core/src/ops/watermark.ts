import { PDFDocument, PDFArray, PDFName, PDFHexString, degrees, rgb } from 'pdf-lib'

export interface WatermarkOpts {
  text: string
  opacity?: number           // 0–1, default 0.3
  angle?: number             // degrees, default 45
  fontSize?: number          // pt, default 48
  color?: [number, number, number]  // RGB 0–1, default [0.5, 0.5, 0.5]
  variant?: 'stream' | 'annot'     // default 'stream'
}

export interface Candidate {
  id: string
  kind: 'xobject' | 'text'
  pageCoverage: number
  preview: { page: number; bbox: [number, number, number, number] }[]
  description: string
}

export interface LegibleOpts {
  font?: 'opendyslexic'
  sizeDelta?: number
  color?: [number, number, number]
}

export async function addWatermark(bytes: Uint8Array, opts: WatermarkOpts): Promise<Uint8Array> {
  const {
    text,
    opacity = 0.3,
    angle = 45,
    fontSize = 48,
    color = [0.5, 0.5, 0.5],
    variant = 'stream',
  } = opts

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pageCount = doc.getPageCount()

  if (variant === 'annot') {
    return addWatermarkAnnot(doc, text, opacity, angle, fontSize, color)
  }

  // stream variant: draw centered rotated text on each page's content stream
  for (let i = 0; i < pageCount; i++) {
    const page = doc.getPage(i)
    const { width, height } = page.getSize()
    const cx = width / 2
    const cy = height / 2

    page.drawText(text, {
      x: cx,
      y: cy,
      size: fontSize,
      rotate: degrees(angle),
      opacity,
      color: rgb(color[0], color[1], color[2])
    })
  }

  return doc.save()
}

// --annot variant: emits a /Watermark annotation subtype dict via pdf-lib low-level API.
// The annotation is added to each page's /Annots array.
// NOTE: pdf-lib does not have a first-class Watermark annotation builder; we construct
// the dict manually via PDFContext. The /AP (appearance) stream is a minimal content
// stream that draws the same rotated text.
async function addWatermarkAnnot(
  doc: PDFDocument,
  text: string,
  opacity: number,
  angle: number,
  fontSize: number,
  color: [number, number, number]
): Promise<Uint8Array> {
  // NOTE: pdf-lib's PDFContext.obj() and PDFPage.node.set() are internal APIs not
  // exposed in the public .d.ts. Verify these APIs exist before executing this branch.
  // If unavailable, fall back to the stream variant.

  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const { width, height } = page.getSize()
    const context = doc.context

    // Minimal appearance stream: draw text at center, rotated
    const rad = (angle * Math.PI) / 180
    const cosA = Math.cos(rad)
    const sinA = Math.sin(rad)
    const [r, g, b] = color
    const cx = width / 2
    const cy = height / 2
    const streamContent = [
      'q',
      `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`,
      `/F1 ${fontSize} Tf`,
      `${cosA.toFixed(4)} ${sinA.toFixed(4)} ${(-sinA).toFixed(4)} ${cosA.toFixed(4)} ${cx.toFixed(2)} ${cy.toFixed(2)} cm`,
      'BT',
      `0 0 Td`,
      `(${text}) Tj`,
      'ET',
      'Q',
    ].join('\n')

    const apStream = context.stream(streamContent, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [-width / 2, -height / 2, width / 2, height / 2]
    })
    const apRef = context.register(apStream)
    const apDict = context.obj({ N: apRef })

    const annotDict = context.obj({
      Type: 'Annot',
      Subtype: 'Watermark',          // PDF 1.6+ /Watermark subtype
      Rect: [0, 0, width, height],
      Contents: PDFHexString.fromText(text),
      CA: opacity,
      AP: apDict,
    })
    const annotRef = context.register(annotDict)

    // Append to page /Annots array
    const annots = page.node.get(PDFName.of('Annots')) as PDFArray | undefined
    if (annots instanceof PDFArray) {
      annots.push(annotRef)
    } else {
      page.node.set(PDFName.of('Annots'), context.obj([annotRef]))
    }
  }

  return doc.save()
}

// Stubs for later tasks — prevent import errors during incremental build
export async function findWatermarkCandidates(_bytes: Uint8Array): Promise<Candidate[]> {
  throw new Error('not yet implemented')
}

export async function stripWatermark(_bytes: Uint8Array, _candidateId: string): Promise<Uint8Array> {
  throw new Error('not yet implemented')
}

export async function rebuildLegible(_bytes: Uint8Array, _opts?: LegibleOpts): Promise<Uint8Array> {
  throw new Error('not yet implemented')
}
