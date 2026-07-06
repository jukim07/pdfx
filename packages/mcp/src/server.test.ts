import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createServer } from './server.js'

let tmpDir: string
let fixturePdf: string

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pdfx-mcp-test-'))
  // Create a minimal 2-page PDF using pdf-lib (no external files needed)
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.addPage()
  const bytes = await doc.save()
  fixturePdf = join(tmpDir, 'fixture.pdf')
  writeFileSync(fixturePdf, bytes)
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
