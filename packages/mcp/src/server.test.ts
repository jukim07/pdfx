import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { buildPdfx } from '@pdfx/core'
import { createServer } from './server.js'
import { toolSplit, toolPull } from './tools.js'

let tmpDir: string
let fixturePdf: string
let fixturePdfx: string

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pdfx-mcp-test-'))
  // Create a minimal 2-page PDF using pdf-lib (no external files needed)
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.addPage()
  const bytes = await doc.save()
  fixturePdf = join(tmpDir, 'fixture.pdf')
  writeFileSync(fixturePdf, bytes)

  // Build a PDFX with a malicious doc name containing path traversal
  const onePage = new Uint8Array(await doc.save())
  const page = { bytes: onePage, sourceKey: 'a', pageIndex: 0 }
  const pdfxBytes = await buildPdfx(
    [
      { name: '../../../tmp/pwned', pages: [page] },
      { name: 'normal', pages: [page] },
      // Two docs with the same name to test collision deduplication
      { name: 'dup', pages: [page] },
      { name: 'dup', pages: [page] }
    ],
    'Test'
  )
  fixturePdfx = join(tmpDir, 'fixture.pdfx')
  writeFileSync(fixturePdfx, pdfxBytes)
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('pdfx MCP server', () => {
  it('pdfx_info returns manifest data for a plain PDF', async () => {
    const server = createServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    const client = new Client({ name: 'test', version: '0.0.1' }, { capabilities: {} })
    await client.connect(clientTransport)

    const result = await client.callTool({ name: 'pdfx_info', arguments: { inputPath: fixturePdf } })

    expect(result.isError).toBeFalsy()
    const content = (result.content as Array<{ type: string; text: string }>)[0]
    expect(content.type).toBe('text')
    const parsed = JSON.parse(content.text) as { ok: boolean; result: { pageCount: number } }
    expect(parsed.ok).toBe(true)
    expect(parsed.result.pageCount).toBe(2)

    await client.close()
  })
})

describe('toolSplit path traversal guard', () => {
  it('all output paths remain inside outDir even with malicious manifest names', async () => {
    const outDir = join(tmpDir, 'split-out')
    const result = await toolSplit({ inputPath: fixturePdfx, outDir })

    const resolvedOut = resolve(outDir)
    for (const { path: outPath } of result.outputs) {
      expect(resolve(outPath).startsWith(resolvedOut + sep)).toBe(true)
      expect(existsSync(outPath)).toBe(true)
    }
  })

  it('collision deduplication produces distinct files for same-named docs', async () => {
    const outDir = join(tmpDir, 'split-dup')
    const result = await toolSplit({ inputPath: fixturePdfx, outDir })

    const paths = result.outputs.map((o) => o.path)
    const unique = new Set(paths)
    expect(unique.size).toBe(paths.length)
  })

  it('returned name contains no path separators and all paths stay in outDir', async () => {
    const outDir = join(tmpDir, 'split-safe')
    const result = await toolSplit({ inputPath: fixturePdfx, outDir })

    const resolvedOut = resolve(outDir)
    for (const { name, path: outPath } of result.outputs) {
      // Name must not contain path-separator characters
      expect(name).not.toContain('/')
      expect(name).not.toContain('\\')
      // Path must remain inside outDir regardless of what name was in the manifest
      expect(resolve(outPath).startsWith(resolvedOut + sep)).toBe(true)
    }
  })
})

describe('writeOut parent directory creation', () => {
  it('toolPull succeeds when outputPath is inside a not-yet-existing subdirectory', async () => {
    const outputPath = join(tmpDir, 'deep', 'nested', 'subdir', 'output.pdf')
    const result = await toolPull({ inputPath: fixturePdf, ranges: '1', outputPath })
    expect(result.outputPath).toBe(outputPath)
    expect(result.pageCount).toBe(1)
    expect(existsSync(outputPath)).toBe(true)
  })
})
