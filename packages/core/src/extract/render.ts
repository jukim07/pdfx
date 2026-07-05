import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface RenderOptions {
  dpi?: number // defaults to 150
  pages?: number[] // 1-based page numbers; defaults to all pages
}

export async function* renderPages(
  bytes: Uint8Array,
  { dpi = 150, pages }: RenderOptions = {}
): AsyncIterable<{ page: number; png: Uint8Array }> {
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise
  try {
    const pageNumbers = pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1)
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > pdf.numPages) {
        throw new Error(`Page ${pageNumber} out of range (1-${pdf.numPages})`)
      }
      const page = await pdf.getPage(pageNumber)
      // 72 PDF points per inch: scale = dpi / 72.
      const viewport = page.getViewport({ scale: dpi / 72 })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const context = canvas.getContext('2d')
      // pdfjs types RenderParameters against the DOM canvas; @napi-rs/canvas
      // implements the same 2D-context contract, so cast through unknown and
      // pass canvas: null to force the canvasContext path.
      await page.render({
        canvasContext: context as unknown as CanvasRenderingContext2D,
        canvas: null,
        viewport,
      }).promise
      yield { page: pageNumber, png: new Uint8Array(canvas.encodeSync('png')) }
    }
  } finally {
    await pdf.destroy()
  }
}
