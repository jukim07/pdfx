import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PdfxManifestDocumentSource } from '@pdfx/core'

// Mock pdfjs-dist before any imports that pull it in transitively.
// loadSource wraps getDocument; we stub the whole module so the test
// exercises only the provenance-threading logic in importIntoDocs.
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn(async () => ({
        getViewport: () => ({ width: 612, height: 792 })
      })),
      getAttachments: vi.fn(async () => null)
    })
  }))
}))

// Import after mocks are set up
const { importIntoDocs } = await import('./source')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importIntoDocs provenance', () => {
  it('threads source into the returned DocEntry when provided', async () => {
    const bytes = new Uint8Array([1, 2, 3]) // content irrelevant — pdfjs is mocked
    const src: PdfxManifestDocumentSource = {
      filename: 'test.pdf',
      sha256: 'deadbeef',
      importedAt: '2026-07-05T12:00:00.000Z'
    }
    const docs = await importIntoDocs('test.pdf', bytes, src)
    expect(docs).toHaveLength(1)
    expect(docs[0].source).toEqual(src)
  })

  it('source is undefined when provenance not provided', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const docs = await importIntoDocs('plain.pdf', bytes)
    expect(docs).toHaveLength(1)
    expect(docs[0].source).toBeUndefined()
  })
})
