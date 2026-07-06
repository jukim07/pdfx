import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRef,
  PDFRawStream,
  PDFNumber,
  PDFArray,
  PDFOperator,
  PDFOperatorNames,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  setStrokingRgbColor,
  setLineWidth,
  moveTo,
  lineTo,
  stroke,
  concatTransformationMatrix,
} from 'pdf-lib'
import { BlendMode } from 'pdf-lib'
import { readAnnots } from '../annots/read.js'
import type { Annot, Quad } from '../annots/model.js'

/** Axis-aligned bounding box of a set of quad corners. */
function quadBox(quads: Quad[]): { x: number; y: number; w: number; h: number } {
  const xs = quads.flatMap((q) => [q.x1, q.x2, q.x3, q.x4])
  const ys = quads.flatMap((q) => [q.y1, q.y2, q.y3, q.y4])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY }
}

/**
 * Bake all annotation appearances into each page's content stream, then remove
 * the /Annots array so viewers treat them as non-interactive static graphics.
 *
 * Subtype mapping:
 *   highlight  → filled rect, Multiply blend (mimics transparent yellow/colour wash)
 *   underline  → horizontal line at quad bottom edge
 *   strikeout  → horizontal line at quad vertical midpoint
 *   note       → small filled square at rect origin (icon flattened as coloured marker)
 *   text (FreeText) → drawText at rect origin with annot fontSize
 *   ink        → raw PDF moveTo/lineTo/stroke per path segment (no SVG y-flip)
 *   stamp      → /AP /N Form XObject copied into page resources, invoked with
 *                the PDF §12.5.5 appearance-to-rect CTM (BBox→rect, /Matrix-aware)
 */
export async function flattenAnnots(bytes: Uint8Array): Promise<Uint8Array> {
  const pageAnnots = await readAnnots(bytes)
  const doc = await PDFDocument.load(bytes)
  // Embed Helvetica once; only needed when FreeText annots are present, but
  // embedding unconditionally is cheap and avoids conditional async work.
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()

  for (const { page: pageIndex, annots } of pageAnnots) {
    const page = pages[pageIndex]
    if (!page) continue

    for (const a of annots as Annot[]) {
      switch (a.type) {
        case 'highlight': {
          for (const q of a.quads) {
            const box = quadBox([q])
            page.drawRectangle({
              x: box.x,
              y: box.y,
              width: box.w,
              height: box.h,
              color: rgb(a.color.r, a.color.g, a.color.b),
              // Multiply blend makes highlight look like a physical highlighter
              // on top of existing text without completely obscuring it.
              blendMode: BlendMode.Multiply,
              opacity: a.opacity ?? 0.4,
              borderWidth: 0,
            })
          }
          break
        }

        case 'underline': {
          for (const q of a.quads) {
            const box = quadBox([q])
            // Underline drawn at the bottom edge of the quad bounding box.
            page.drawLine({
              start: { x: box.x, y: box.y },
              end: { x: box.x + box.w, y: box.y },
              thickness: 1,
              color: rgb(a.color.r, a.color.g, a.color.b),
              opacity: a.opacity ?? 1,
            })
          }
          break
        }

        case 'strikeout': {
          for (const q of a.quads) {
            const box = quadBox([q])
            // Strikeout at the vertical midpoint of the quad bounding box.
            const midY = box.y + box.h / 2
            page.drawLine({
              start: { x: box.x, y: midY },
              end: { x: box.x + box.w, y: midY },
              thickness: 1,
              color: rgb(a.color.r, a.color.g, a.color.b),
              opacity: a.opacity ?? 1,
            })
          }
          break
        }

        case 'note': {
          // Note (sticky-note) icon: draw a small filled square as a coloured marker.
          // The icon size matches the standard 20×20 pt annotation icon.
          page.drawRectangle({
            x: a.rect.x,
            y: a.rect.y,
            width: a.rect.w,
            height: a.rect.h,
            color: rgb(a.color.r, a.color.g, a.color.b),
            opacity: 0.9,
            borderWidth: 0,
          })
          break
        }

        case 'text': {
          // FreeText: draw text content inside the annotation rect.
          // drawText origin is the baseline; position at rect top minus fontSize.
          page.drawText(a.contents, {
            x: a.rect.x + 2, // small inset to stay inside rect border
            y: a.rect.y + a.rect.h - a.fontSize,
            size: a.fontSize,
            font,
            color: rgb(a.color.r, a.color.g, a.color.b),
          })
          break
        }

        case 'ink': {
          for (const path of a.paths) {
            if (path.length < 2) continue
            // Emit raw PDF path operators in user-space (origin bottom-left).
            // drawSvgPath applies an internal y-flip CTM ("1 0 0 -1 0 0 cm")
            // because SVG origin is top-left; that would mirror ink coordinates
            // around Y=0.  pushOperators bypasses the high-level API entirely.
            page.pushOperators(
              pushGraphicsState(),
              setStrokingRgbColor(a.color.r, a.color.g, a.color.b),
              setLineWidth(a.borderWidth),
              moveTo(path[0], path[1]),
              ...path.slice(2).reduce<ReturnType<typeof lineTo>[]>((acc, _, i, arr) => {
                if (i % 2 === 0) acc.push(lineTo(arr[i], arr[i + 1]))
                return acc
              }, []),
              stroke(),
              popGraphicsState(),
            )
          }
          break
        }

        case 'stamp': {
          // A stamp's only visual is its /AP /N Form XObject — nothing is ever
          // drawn into page content by stamp.ts; the appearance stream IS the
          // visual.  Copy that stream into the page's /Resources /XObject under
          // a fresh name, then emit  q <sx> 0 0 <sy> <tx> <ty> cm /<name> Do Q.
          //
          // CTM derivation (PDF §12.5.5 appearance-to-rect mapping):
          //   1. Read BBox [bx0,by0,bx1,by1] and optional /Matrix (default I).
          //   2. Transform BBox corners through /Matrix; take axis-aligned bounds
          //      [tx0,ty0,tx1,ty1].
          //   3. sx = rect.w/(tx1-tx0),  sy = rect.h/(ty1-ty0).
          //   4. CTM = translate(rect.x - tx0·sx, rect.y - ty0·sy) ∘ scale(sx,sy).
          // For our stamps: BBox=[0,0,w,h], no /Matrix → sx=sy=1, CTM=translate(x,y).
          const pageNode = page.node
          const annotsArr = pageNode.Annots()
          if (annotsArr) {
            for (let i = 0; i < annotsArr.size(); i++) {
              const annotDict = annotsArr.lookupMaybe(i, PDFDict)
              if (!annotDict) continue
              const subtype = annotDict.lookupMaybe(PDFName.of('Subtype'), PDFName)
              if (subtype?.asString() !== '/Stamp') continue

              // Get /AP /N — the normal appearance Form XObject ref.
              const apDict = annotDict.lookupMaybe(PDFName.of('AP'), PDFDict)
              if (!apDict) break
              const apNRef = apDict.get(PDFName.of('N'))
              if (!(apNRef instanceof PDFRef)) break

              // Ensure page has a /Resources /XObject dict to register into.
              const resources =
                pageNode.Resources() ??
                (() => {
                  const r = doc.context.obj({})
                  pageNode.set(PDFName.of('Resources'), r)
                  return pageNode.Resources()!
                })()

              let xobjDict = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
              if (!xobjDict) {
                xobjDict = doc.context.obj({}) as PDFDict
                resources.set(PDFName.of('XObject'), xobjDict)
              }

              // Pick a name that won't clash with existing XObjects on this page.
              // Form XObjects are streams, not PDFDicts — use a type-agnostic
              // key-existence check instead of lookupMaybe(..., PDFDict).
              let nameIdx = 0
              let xName: string
              do {
                xName = `PdfxStamp${nameIdx++}`
              } while (xobjDict.has(PDFName.of(xName)))

              xobjDict.set(PDFName.of(xName), apNRef)

              // Emit placement operators via PDF §12.5.5 appearance-to-rect CTM.
              // Read BBox and optional /Matrix from the form XObject stream dict.
              const formStream = doc.context.lookup(apNRef)
              const formDict =
                formStream instanceof PDFRawStream
                  ? formStream.dict
                  : formStream instanceof PDFDict
                    ? formStream
                    : null

              const bboxArr = formDict?.lookupMaybe(PDFName.of('BBox'), PDFArray)
              const bx0 = (bboxArr?.get(0) as PDFNumber | undefined)?.asNumber() ?? 0
              const by0 = (bboxArr?.get(1) as PDFNumber | undefined)?.asNumber() ?? 0
              const bx1 = (bboxArr?.get(2) as PDFNumber | undefined)?.asNumber() ?? 1
              const by1 = (bboxArr?.get(3) as PDFNumber | undefined)?.asNumber() ?? 1

              // Apply /Matrix (6-element row-major) to BBox corners, take AABB.
              const mArr = formDict?.lookupMaybe(PDFName.of('Matrix'), PDFArray)
              const ma = (mArr?.get(0) as PDFNumber | undefined)?.asNumber() ?? 1
              const mb = (mArr?.get(1) as PDFNumber | undefined)?.asNumber() ?? 0
              const mc = (mArr?.get(2) as PDFNumber | undefined)?.asNumber() ?? 0
              const md = (mArr?.get(3) as PDFNumber | undefined)?.asNumber() ?? 1
              const me = (mArr?.get(4) as PDFNumber | undefined)?.asNumber() ?? 0
              const mf = (mArr?.get(5) as PDFNumber | undefined)?.asNumber() ?? 0

              // Transform all four BBox corners through /Matrix.
              const corners = [
                [bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1],
              ].map(([cx, cy]) => [ma * cx + mc * cy + me, mb * cx + md * cy + mf])
              const txs = corners.map(([tx]) => tx)
              const tys = corners.map(([, ty]) => ty)
              const tx0 = Math.min(...txs)
              const ty0 = Math.min(...tys)
              const tx1 = Math.max(...txs)
              const ty1 = Math.max(...tys)

              const { x, y, w, h } = a.rect
              const extW = tx1 - tx0
              const extH = ty1 - ty0
              // Guard degenerate BBox — skip draw rather than divide by zero.
              if (extW === 0 || extH === 0) break

              const sx = w / extW
              const sy = h / extH
              const tx = x - tx0 * sx
              const ty = y - ty0 * sy

              page.pushOperators(
                pushGraphicsState(),
                concatTransformationMatrix(sx, 0, 0, sy, tx, ty),
                PDFOperator.of(PDFOperatorNames.DrawObject, [PDFName.of(xName)]),
                popGraphicsState(),
              )

              // Only one stamp dict per annot, stop scanning once matched.
              break
            }
          }
          break
        }
      }
    }

    // Remove the /Annots array from the page dict so the baked graphics are the
    // only representation; interactive annotation dicts are gone.
    page.node.delete(PDFName.of('Annots'))
  }

  return doc.save()
}
