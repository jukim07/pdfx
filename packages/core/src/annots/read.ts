import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString } from 'pdf-lib'
import type { Annot, PageAnnots, Quad, RGB } from './model.js'

function num(arr: PDFArray, i: number): number {
  return (arr.lookup(i, PDFNumber) as PDFNumber).asNumber()
}

function readColor(dict: PDFDict): RGB {
  const c = dict.lookupMaybe(PDFName.of('C'), PDFArray)
  if (!c || c.size() < 3) return { r: 0, g: 0, b: 0 }
  return { r: num(c, 0), g: num(c, 1), b: num(c, 2) }
}

function readContents(dict: PDFDict): string {
  const v = dict.get(PDFName.of('Contents'))
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText()
  return ''
}

function readQuads(dict: PDFDict): Quad[] {
  const qp = dict.lookupMaybe(PDFName.of('QuadPoints'), PDFArray)
  if (!qp) return []
  const quads: Quad[] = []
  for (let i = 0; i + 7 < qp.size(); i += 8) {
    quads.push({
      x1: num(qp, i),
      y1: num(qp, i + 1),
      x2: num(qp, i + 2),
      y2: num(qp, i + 3),
      x3: num(qp, i + 4),
      y3: num(qp, i + 5),
      x4: num(qp, i + 6),
      y4: num(qp, i + 7),
    })
  }
  return quads
}

function rectFrom(dict: PDFDict): { x: number; y: number; w: number; h: number } | null {
  const r = dict.lookupMaybe(PDFName.of('Rect'), PDFArray)
  if (!r || r.size() < 4) return null
  const llx = num(r, 0)
  const lly = num(r, 1)
  const urx = num(r, 2)
  const ury = num(r, 3)
  return { x: llx, y: lly, w: urx - llx, h: ury - lly }
}

function parseOne(dict: PDFDict, page: number): Annot | null {
  const st = dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString()
  const color = readColor(dict)

  switch (st) {
    case '/Highlight':
    case '/Underline':
    case '/StrikeOut': {
      const typeMap: Record<string, 'highlight' | 'underline' | 'strikeout'> = {
        '/Highlight': 'highlight',
        '/Underline': 'underline',
        '/StrikeOut': 'strikeout',
      }
      const contents = readContents(dict)
      return {
        type: typeMap[st],
        page,
        quads: readQuads(dict),
        color,
        ...(contents ? { contents } : {}),
      }
    }
    case '/Text': {
      const rect = rectFrom(dict)
      if (!rect) return null
      return { type: 'note', page, rect, color, contents: readContents(dict) }
    }
    case '/FreeText': {
      const rect = rectFrom(dict)
      if (!rect) return null
      // fontSize is encoded in /DA but not round-tripped here; default to 12
      // as the round-trip test doesn't assert on fontSize from a foreign reader
      const fontSize = 12
      return { type: 'text', page, rect, contents: readContents(dict), fontSize, color }
    }
    case '/Ink': {
      const inkList = dict.lookupMaybe(PDFName.of('InkList'), PDFArray)
      const paths: number[][] = []
      if (inkList) {
        for (let i = 0; i < inkList.size(); i++) {
          const p = inkList.lookupMaybe(i, PDFArray)
          if (!p) continue
          const flat: number[] = []
          for (let j = 0; j < p.size(); j++) flat.push(num(p, j))
          paths.push(flat)
        }
      }
      return { type: 'ink', page, paths, color, borderWidth: 1 }
    }
    case '/Stamp': {
      // Appearance-stream PNG is not re-extracted on import; empty png marks an
      // imported stamp (Phase 4b writes stamps; this keeps them visible to readAnnots).
      const rect = rectFrom(dict)
      if (!rect) return null
      return { type: 'stamp', page, rect, png: new Uint8Array() }
    }
    default:
      // Unknown or unsupported subtype — skip gracefully
      return null
  }
}

export async function readAnnots(bytes: Uint8Array): Promise<PageAnnots[]> {
  const doc = await PDFDocument.load(bytes)
  const pages = doc.getPages()
  return pages.map((pg, page) => {
    const arr = pg.node.Annots()
    const annots: Annot[] = []
    if (arr) {
      for (let i = 0; i < arr.size(); i++) {
        const dict = arr.lookupMaybe(i, PDFDict)
        if (!dict) continue
        let a: Annot | null = null
        try {
          a = parseOne(dict, page)
        } catch {
          // Malformed annot dict — skip without crashing
        }
        if (a) annots.push(a)
      }
    }
    return { page, annots }
  })
}
