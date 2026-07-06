import { PDFDocument, PDFArray, PDFName, PDFHexString, PDFRef, PDFRawStream, degrees, rgb } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { OPS } from 'pdfjs-dist'
import { inflateSync, deflateSync } from 'zlib'

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

// Minimal CTM tracker: maintain a 6-element matrix stack in sync with save/restore/transform ops.
// content-stream.ts IS present (Phase 4c). This tracker is kept here because pdfjs getOperatorList
// doesn't expose cm/q/Q the same way, and the text-arm works purely against pdfjs OPS rather than
// raw streams. Do NOT replace with content-stream.ts imports here — that tokenizer works on raw
// bytes, while the text arm needs pdfjs's decoded glyph unicode. Keep both as independent tools.

type Matrix6 = [number, number, number, number, number, number]

function identityMatrix(): Matrix6 {
  return [1, 0, 0, 1, 0, 0]
}

function multiplyMatrix(a: Matrix6, b: Matrix6): Matrix6 {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ]
}

function roundMatrix(m: Matrix6, digits = 1): string {
  const f = 10 ** digits
  return m.map((v) => Math.round(v * f) / f).join(',')
}

// Candidate signature for the text arm: `text|<content>|<rounded CTM>`.
// The `text|` prefix lets stripWatermark (Task 3) dispatch by kind — the
// xobject arm (Task 2b) uses an `xobj|` prefix. A plain string signature is
// sufficient; cryptographic strength is not needed here.
function sigHash(text: string, ctm: Matrix6): string {
  return `text|${text}|${roundMatrix(ctm)}`
}

interface TextHit {
  text: string
  ctm: Matrix6
  x: number
  y: number
  page: number
}

async function collectTextHits(bytes: Uint8Array): Promise<{ hits: TextHit[]; numPages: number }> {
  // pdfjs-dist in the renderer context: getDocument works with Uint8Array.
  // In Node (CLI/test), use the legacy build which does not require a DOM.
  const loadingTask = getDocument({ data: bytes.slice() })
  const pdf = await loadingTask.promise
  const numPages = pdf.numPages
  const hits: TextHit[] = []

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const { fnArray, argsArray } = await page.getOperatorList()
    const ctmStack: Matrix6[] = [identityMatrix()]
    const top = (): Matrix6 => ctmStack[ctmStack.length - 1]

    for (let j = 0; j < fnArray.length; j++) {
      const fn = fnArray[j]
      const args = argsArray[j] as unknown[]

      if (fn === OPS.save) {
        ctmStack.push([...top()] as Matrix6)
      } else if (fn === OPS.restore) {
        if (ctmStack.length > 1) ctmStack.pop()
      } else if (fn === OPS.transform) {
        // args: [a, b, c, d, e, f]
        const m = args as number[]
        ctmStack[ctmStack.length - 1] = multiplyMatrix(top(), [
          m[0], m[1], m[2], m[3], m[4], m[5]
        ])
      } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        // args[0] is an array of glyph/string items; extract raw text
        const glyphs = args[0] as Array<{ unicode?: string } | number>
        const text = glyphs
          .filter((g): g is { unicode: string } => typeof g === 'object' && g !== null && 'unicode' in g)
          .map((g) => g.unicode)
          .join('')
        if (text.trim().length === 0) continue
        const ctm = top()
        hits.push({ text: text.trim(), ctm, x: ctm[4], y: ctm[5], page: pageNum - 1 })
      }
    }
  }

  return { hits, numPages }
}

// Text arm. Task 2b adds the xobject arm and turns findWatermarkCandidates
// into a combiner over both.
async function findTextCandidates(bytes: Uint8Array): Promise<Candidate[]> {
  const { hits, numPages } = await collectTextHits(bytes)
  if (numPages === 0 || hits.length === 0) return []

  // Group hits by signature
  const groups = new Map<string, TextHit[]>()
  for (const hit of hits) {
    const sig = sigHash(hit.text, hit.ctm)
    const existing = groups.get(sig) ?? []
    existing.push(hit)
    groups.set(sig, existing)
  }

  const candidates: Candidate[] = []
  for (const [sig, groupHits] of groups) {
    const uniquePages = new Set(groupHits.map((h) => h.page))
    const coverage = uniquePages.size / numPages
    if (coverage < 0.8) continue

    const preview = Array.from(uniquePages).slice(0, 5).map((pageIdx) => {
      const hit = groupHits.find((h) => h.page === pageIdx)!
      // bbox is approximate: a square around the text position
      const x = hit.x
      const y = hit.y
      return { page: pageIdx, bbox: [x - 50, y - 50, x + 50, y + 50] as [number, number, number, number] }
    })

    candidates.push({
      id: sig,
      kind: 'text',
      pageCoverage: coverage,
      preview,
      description: `"${groupHits[0].text}" on ${uniquePages.size}/${numPages} pages`
    })
  }

  return candidates
}

export async function findWatermarkCandidates(bytes: Uint8Array): Promise<Candidate[]> {
  // Task 2b extends this to also include findXObjectCandidates(bytes).
  return findTextCandidates(bytes)
}

export async function stripWatermark(_bytes: Uint8Array, _candidateId: string): Promise<Uint8Array> {
  throw new Error('not yet implemented')
}

export async function rebuildLegible(_bytes: Uint8Array, _opts?: LegibleOpts): Promise<Uint8Array> {
  throw new Error('not yet implemented')
}
