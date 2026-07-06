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

// Candidate signature for the text arm: `text|<content>|<rounded Tm>`.
// We discriminate by the text matrix (Tm op / OPS.setTextMatrix) rather than
// the graphics CTM (cm ops / OPS.transform). pdf-lib positions text via
// setTextMatrix, not transform; the CTM for every text hit is identity.
// Two "DRAFT" strings at different positions have different Tm values and thus
// different signatures — body text at x:50,y:700 will not collide with a
// watermark at x:306,y:396.
// The `text|` prefix lets stripWatermark dispatch by kind; xobject arm uses `xobj|`.
function sigHash(text: string, tm: Matrix6): string {
  return `text|${text}|${roundMatrix(tm)}`
}

interface TextHit {
  text: string
  ctm: Matrix6   // graphics CTM (cm ops inside q…Q)
  tm: Matrix6    // text matrix from Tm op — the actual per-text-object position
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
    // Text matrix: set by OPS.setTextMatrix (Tm op). pdf-lib emits Tm to
    // position each text object; this is NOT the same as OPS.transform (cm).
    let currentTm: Matrix6 = identityMatrix()

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
      } else if (fn === OPS.setTextMatrix) {
        // args[0] is an object with numeric keys 0–5 (a,b,c,d,e,f of the Tm matrix).
        // Verified by probing a pdf-lib fixture: drawText with rotate/x/y emits
        // setTextMatrix, not transform; this op carries the actual text position.
        const m = args[0] as Record<number, number>
        currentTm = [m[0], m[1], m[2], m[3], m[4], m[5]] as Matrix6
      } else if (fn === OPS.showText || fn === OPS.showSpacedText) {
        // args[0] is an array of glyph/string items; extract raw text
        const glyphs = args[0] as Array<{ unicode?: string } | number>
        const text = glyphs
          .filter((g): g is { unicode: string } => typeof g === 'object' && g !== null && 'unicode' in g)
          .map((g) => g.unicode)
          .join('')
        if (text.trim().length === 0) continue
        const ctm = top()
        // Use currentTm (text matrix) for position; ctm (graphics CTM) is kept for context.
        hits.push({ text: text.trim(), ctm, tm: currentTm, x: currentTm[4], y: currentTm[5], page: pageNum - 1 })
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
    const sig = sigHash(hit.text, hit.tm)
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

// ---------- Shared raw-content-stream helpers (also used by Task 3) ----------

export function resolveContentStreams(doc: PDFDocument, page: PDFPage): PDFRawStream[] {
  const contentsRef = page.node.get(PDFName.of('Contents'))
  const streams: PDFRawStream[] = []
  const visit = (ref: unknown): void => {
    const resolved = doc.context.lookup(ref as Parameters<typeof doc.context.lookup>[0])
    if (resolved instanceof PDFRawStream) {
      streams.push(resolved)
    } else if (resolved instanceof PDFArray) {
      for (let j = 0; j < resolved.size(); j++) visit(resolved.get(j))
    }
  }
  if (contentsRef) visit(contentsRef)
  return streams
}

export function decodeStreamText(stream: PDFRawStream): { text: string; compressed: boolean } {
  const filter = stream.dict.get(PDFName.of('Filter'))
  if (filter && filter.toString().includes('FlateDecode')) {
    return { text: inflateSync(Buffer.from(stream.contents)).toString('latin1'), compressed: true }
  }
  return { text: Buffer.from(stream.contents).toString('latin1'), compressed: false }
}

export function encodeStreamText(
  stream: PDFRawStream,
  text: string,
  compressed: boolean,
  doc: PDFDocument
): void {
  const newBytes = compressed ? deflateSync(Buffer.from(text, 'latin1')) : Buffer.from(text, 'latin1')
  // <!-- unverified-api -->: PDFRawStream.contents is a Uint8Array property in pdf-lib
  // internals but the setter is not public. If this assignment fails at runtime,
  // create a fresh PDFRawStream and doc.context.assign(streamRef, newStream) instead.
  ;(stream as unknown as { contents: Uint8Array }).contents = new Uint8Array(newBytes)
  stream.dict.set(PDFName.of('Length'), doc.context.obj(newBytes.length))
}

// ---------- Minimal XObject-paint scanner (intentional, not a fallback) ----------
// content-stream.ts IS present (Phase 4c) but its API (tokenizeContent/stripOps) targets
// text-show operators for surgery. This scanner tracks q/Q/cm/Do for XObject paint detection,
// which is a different operation. Keep both; do not merge or replace.

export interface XObjectPaint {
  name: string                    // resource name without the leading slash, e.g. 'X0'
  ctm: Matrix6                    // CTM in effect at the Do op
  nameStart: number               // char offset of the /Name token in the ORIGINAL stream text
  doEnd: number                   // char offset just past the Do token
  blockStart: number              // offset of the innermost enclosing 'q' (== nameStart if none)
  blockEndAfterQ: number | null   // offset just past the matching 'Q'; null if not inside q…Q
}

export function scanXObjectPaints(streamText: string): XObjectPaint[] {
  // Blank out string literals and hex strings PRESERVING LENGTH so token
  // offsets map back to the original stream text (needed by Task 3 removal).
  const cleaned = streamText
    .replace(/\((?:\\.|[^\\)])*\)/g, (s) => ' '.repeat(s.length))
    .replace(/<[0-9A-Fa-f\s]*>/g, (s) => ' '.repeat(s.length))

  interface Frame { matrix: Matrix6; qStart: number; paintIdx: number[] }
  const frames: Frame[] = [{ matrix: identityMatrix(), qStart: -1, paintIdx: [] }]
  const operands: { tok: string; start: number }[] = []
  const paints: XObjectPaint[] = []

  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cleaned)) !== null) {
    const tok = m[0]
    const top = frames[frames.length - 1]
    if (tok === 'q') {
      frames.push({ matrix: [...top.matrix] as Matrix6, qStart: m.index, paintIdx: [] })
      operands.length = 0
    } else if (tok === 'Q') {
      if (frames.length > 1) {
        const closed = frames.pop()!
        for (const idx of closed.paintIdx) {
          paints[idx].blockStart = closed.qStart
          paints[idx].blockEndAfterQ = m.index + 1
        }
      }
      operands.length = 0
    } else if (tok === 'cm') {
      const nums = operands.slice(-6).map((o) => Number(o.tok))
      if (nums.length === 6 && nums.every(Number.isFinite)) {
        top.matrix = multiplyMatrix(top.matrix, nums as Matrix6)
      }
      operands.length = 0
    } else if (tok === 'Do') {
      const nameOperand = operands[operands.length - 1]
      if (nameOperand && nameOperand.tok.startsWith('/')) {
        const idx = paints.length
        paints.push({
          name: nameOperand.tok.slice(1),
          ctm: [...top.matrix] as Matrix6,
          nameStart: nameOperand.start,
          doEnd: m.index + tok.length,
          blockStart: nameOperand.start,   // provisional; overwritten on Q pop
          blockEndAfterQ: null
        })
        if (frames.length > 1) top.paintIdx.push(idx)
      }
      operands.length = 0
    } else if (tok.startsWith('/') || /^[-+.\d]/.test(tok)) {
      operands.push({ tok, start: m.index })
    } else {
      // any other operator clears pending operands
      operands.length = 0
    }
  }
  return paints
}

// ---------- XObject arm ----------

interface XObjectHit {
  name: string
  ref: string          // PDFRef tag, e.g. "12 0 R"
  ctm: Matrix6
  page: number
}

async function collectXObjectHits(
  bytes: Uint8Array
): Promise<{ hits: XObjectHit[]; numPages: number }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const hits: XObjectHit[] = []
  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const { XObject } = page.node.normalizedEntries()
    for (const stream of resolveContentStreams(doc, page)) {
      const { text } = decodeStreamText(stream)
      for (const paint of scanXObjectPaints(text)) {
        const raw = XObject.get(PDFName.of(paint.name))
        // Image XObjects also pass through here — a full-page repeated image
        // stamp is a legitimate watermark candidate too.
        const refTag = raw instanceof PDFRef ? raw.toString() : `name:${paint.name}`
        hits.push({ name: paint.name, ref: refTag, ctm: paint.ctm, page: i })
      }
    }
  }
  return { hits, numPages: doc.getPageCount() }
}

async function findXObjectCandidates(bytes: Uint8Array): Promise<Candidate[]> {
  const { hits, numPages } = await collectXObjectHits(bytes)
  if (numPages === 0 || hits.length === 0) return []

  const groups = new Map<string, XObjectHit[]>()
  for (const hit of hits) {
    const sig = `xobj|${hit.ref}|${roundMatrix(hit.ctm)}`
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
      // Approximate bbox: CTM translation as the anchor corner. The exact
      // extent would need the XObject's /BBox transformed by the CTM.
      const x = hit.ctm[4]
      const y = hit.ctm[5]
      return { page: pageIdx, bbox: [x, y, x + 100, y + 100] as [number, number, number, number] }
    })

    candidates.push({
      id: sig,
      kind: 'xobject',
      pageCoverage: coverage,
      preview,
      description: `XObject ${groupHits[0].ref} (/${groupHits[0].name}) on ${uniquePages.size}/${numPages} pages`
    })
  }
  return candidates
}

export async function findWatermarkCandidates(bytes: Uint8Array): Promise<Candidate[]> {
  const [textArm, xobjArm] = await Promise.all([
    findTextCandidates(bytes),
    findXObjectCandidates(bytes)
  ])
  return [...textArm, ...xobjArm]
}

export async function stripWatermark(bytes: Uint8Array, candidateId: string): Promise<Uint8Array> {
  // Dispatch on the signature prefix set by the detection arms:
  // Task 2 text arm → `text|…`, Task 2b xobject arm → `xobj|…`.
  if (candidateId.startsWith('xobj|')) return stripXObjectWatermark(bytes, candidateId)
  return stripTextWatermark(bytes, candidateId)
}

// ---------- text arm removal ----------

// Convert a unicode string to its PDF hex-string literal form (upper-case hex
// pairs of the latin1/CP1252 byte values — which is what pdf-lib's drawText
// emits for standard fonts).  Example: 'DRAFT' → '4452414654'.
function textToHex(text: string): string {
  return Array.from(text)
    .map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))
    .join('')
}

// Re-collect text hits from the input bytes, then for each page that has matching
// hits, remove those operator sequences from the raw content stream bytes.
async function stripTextWatermark(bytes: Uint8Array, candidateId: string): Promise<Uint8Array> {
  // Step 1: identify per-page regions matching candidateId via pdfjs getOperatorList
  const { hits } = await collectTextHits(bytes)
  const matchingHits = hits.filter((h) => sigHash(h.text, h.tm) === candidateId)
  if (matchingHits.length === 0) return bytes

  // Step 2: load with pdf-lib for raw stream manipulation
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const pageHits = matchingHits.filter((h) => h.page === i)
    if (pageHits.length === 0) continue

    for (const stream of resolveContentStreams(doc, page)) {
      const decoded = decodeStreamText(stream)
      let streamText = decoded.text

      // Remove per-hit, anchored by the concrete Tm matrix.
      // Each hit carries the Tm sextuple from OPS.setTextMatrix; we build a
      // pattern that matches exactly that Tm line + hex/paren show op.
      // Body text with the same string but a different Tm position is NOT removed.
      //
      // q…Q fallback patterns (text-only, no Tm anchor) have been intentionally
      // removed: they could silently destroy body text equal to the watermark
      // string. An unsafe fallback is worse than none; the re-detection gate
      // reports any leftover watermark instances.
      for (const hit of pageHits) {
        const hexText = textToHex(hit.text)

        // Escape each Tm value to a regex-safe float literal.
        // We use the pdfjs-decoded value directly (not roundMatrix-rounded) so
        // the match is as precise as the stream itself.
        const escapeTmVal = (v: number): string => {
          // Escape the decimal point; the stream value may have many digits but
          // we match it as a verbatim prefix up to the full precision pdfjs gave us.
          return String(v).replace(/\./g, '\\.').replace(/-/, '-?')
        }
        // Strategy: anchor on the translated values (e5, e6 — x,y position) which
        // are always integers or simple decimals and unique between watermark and body.
        // For maximum safety we match all 6 values with lenient float tokens but
        // anchor the whole Tm line (6 numbers + Tm keyword) so only that specific
        // text-object is targeted.
        const tmNum = `[-\\d.e]+`
        const tmPat = `${tmNum}\\s+${tmNum}\\s+${tmNum}\\s+${tmNum}\\s+${escapeTmVal(hit.tm[4])}\\s+${escapeTmVal(hit.tm[5])}\\s+Tm`

        // pdf-lib emits: `<a b c d e f Tm>\n<HEXTEXT> Tj\nT*`
        const hexTjPattern = new RegExp(
          `${tmPat}[ \\t]*\\n<${hexText}>[ \\t]*Tj[ \\t]*\\n?`,
          'gi'
        )
        streamText = streamText.replace(hexTjPattern, '')

        // Parenthesis form: `(text) Tj` — anchored to same Tm
        const escaped = hit.text.replace(/[\\()]/g, '\\$&')
        const parenTjPattern = new RegExp(
          `${tmPat}[ \\t]*\\n\\(${escaped}\\)[ \\t]*Tj[ \\t]*\\n?`,
          'g'
        )
        streamText = streamText.replace(parenTjPattern, '')
      }

      if (streamText !== decoded.text) {
        encodeStreamText(stream, streamText, decoded.compressed, doc)
      }
    }
  }

  return doc.save()
}

// ---------- xobject arm removal ----------

// Splice matching `/Name Do` paints (with their innermost enclosing q…Q block)
// out of the stream text. Cuts are merged and applied back-to-front so offsets
// from scanXObjectPaints stay valid.
function removeXObjectPaintBlocks(
  streamText: string,
  namesForRef: Set<string>,
  ctmKey: string
): string {
  const paints = scanXObjectPaints(streamText)
  const cuts: { start: number; end: number }[] = []
  for (const p of paints) {
    if (!namesForRef.has(p.name)) continue
    if (roundMatrix(p.ctm) !== ctmKey) continue
    if (p.blockEndAfterQ != null) {
      cuts.push({ start: p.blockStart, end: p.blockEndAfterQ })
    } else {
      // Not inside a q…Q pair: remove just `/Name … Do`
      cuts.push({ start: p.nameStart, end: p.doEnd })
    }
  }
  if (cuts.length === 0) return streamText

  cuts.sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const c of cuts) {
    if (c.start < cursor) continue   // nested/overlapping cut — already removed
    out += streamText.slice(cursor, c.start)
    cursor = c.end
  }
  out += streamText.slice(cursor)
  return out
}

async function stripXObjectWatermark(bytes: Uint8Array, candidateId: string): Promise<Uint8Array> {
  // candidateId = `xobj|<ref tag>|<rounded CTM>`; ref tags ("12 0 R") contain
  // no '|' so a two-split is safe.
  const firstSep = candidateId.indexOf('|')
  const secondSep = candidateId.indexOf('|', firstSep + 1)
  const refTag = candidateId.slice(firstSep + 1, secondSep)
  const ctmKey = candidateId.slice(secondSep + 1)

  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const { XObject } = page.node.normalizedEntries()

    // Which resource name(s) on THIS page point at the candidate ref
    const namesForRef = new Set<string>()
    for (const [key, value] of XObject.entries()) {
      const name = key.asString().slice(1)   // PDFName.asString() includes the leading '/'
      const tag = value instanceof PDFRef ? value.toString() : `name:${name}`
      if (tag === refTag) namesForRef.add(name)
    }
    if (namesForRef.size === 0) continue

    let anyPaintLeft = false
    for (const stream of resolveContentStreams(doc, page)) {
      const decoded = decodeStreamText(stream)
      const rewritten = removeXObjectPaintBlocks(decoded.text, namesForRef, ctmKey)
      if (rewritten !== decoded.text) {
        encodeStreamText(stream, rewritten, decoded.compressed, doc)
      }
      // Check whether any paint of these names survives (e.g. same XObject
      // painted elsewhere on the page with a DIFFERENT CTM — keep those)
      if (scanXObjectPaints(rewritten).some((p) => namesForRef.has(p.name))) {
        anyPaintLeft = true
      }
    }

    // Remove the XObject resource entry once nothing on the page paints it.
    // The unreferenced XObject object may remain in the file after save;
    // pdf-lib does not garbage-collect orphans — acceptable (nothing renders).
    if (!anyPaintLeft) {
      for (const name of namesForRef) {
        XObject.delete(PDFName.of(name))
      }
    }
  }

  return doc.save()
}

export async function rebuildLegible(_bytes: Uint8Array, _opts?: LegibleOpts): Promise<Uint8Array> {
  throw new Error('not yet implemented')
}
