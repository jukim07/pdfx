import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface TextSpan {
  str: string
  fontSize: number
  hasEOL: boolean
}

export interface PageText {
  page: number // 1-based page number in the source PDF
  text: string
  spans: TextSpan[]
}

export interface ExtractTextOptions {
  pages?: number[] // 1-based page numbers; defaults to all pages
}

// The pdfjs TextItem fields we consume. Declared locally instead of deep-
// importing pdfjs-dist/types/src/... which is not part of its public API.
interface RawTextItem {
  str: string
  transform: number[]
  hasEOL?: boolean
}

const isTextItem = (item: unknown): item is RawTextItem =>
  typeof (item as RawTextItem).str === 'string' && Array.isArray((item as RawTextItem).transform)

export async function extractText(
  bytes: Uint8Array,
  opts: ExtractTextOptions = {},
): Promise<PageText[]> {
  // .slice(): pdfjs transfers (detaches) the buffer it is given; callers keep theirs.
  const pdf = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise
  try {
    const pageNumbers = opts.pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1)
    const result: PageText[] = []
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > pdf.numPages) {
        throw new Error(`Page ${pageNumber} out of range (1-${pdf.numPages})`)
      }
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const spans: TextSpan[] = []
      for (const item of content.items) {
        if (!isTextItem(item)) continue
        spans.push({
          str: item.str,
          // transform[3] is the vertical scale of the text matrix, which for
          // horizontal text equals the rendered font size in PDF points.
          fontSize: Math.abs(item.transform[3]) || 0,
          hasEOL: item.hasEOL === true,
        })
      }
      const text = spans.map((s) => s.str + (s.hasEOL ? '\n' : '')).join('')
      result.push({ page: pageNumber, text, spans })
    }
    return result
  } finally {
    await pdf.destroy()
  }
}
