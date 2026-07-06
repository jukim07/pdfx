import {
  PDFDocument,
  PDFName,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  setStrokingRgbColor,
  setLineWidth,
  moveTo,
  lineTo,
  stroke,
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
 *   stamp      → accepted-deferred (Phase 4b); no draw, /Annots still removed
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

        case 'stamp':
          // Stamp appearance-stream draw is deferred to Phase 4b.
          // /Annots removal still happens below so the dict is cleaned up.
          break
      }
    }

    // Remove the /Annots array from the page dict so the baked graphics are the
    // only representation; interactive annotation dicts are gone.
    page.node.delete(PDFName.of('Annots'))
  }

  return doc.save()
}
