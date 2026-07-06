import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractText } from '../../src/extract/text.js'
import { buildSsnFixture, SSN } from '../../src/ops/fixtures.js'
import { redactRegions, redactText } from '../../src/ops/redact.js'

async function fullText(bytes: Uint8Array): Promise<string> {
  const pages = await extractText(bytes, {})
  // PageText shape from Phase ①; page.text is the concatenated string.
  return pages.map((p) => p.text).join('\n')
}

const hasPdftotext = spawnSync('which', ['pdftotext']).status === 0
if (!hasPdftotext) {
  console.warn(
    'WARNING: pdftotext not found — poppler leak-test arm SKIPPED. Install: brew install poppler'
  )
}

function pdftotextOf(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'pdfx-leak-'))
  const p = join(dir, 'r.pdf')
  writeFileSync(p, bytes)
  const res = spawnSync('pdftotext', [p, '-'], { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(`pdftotext failed: ${res.stderr}`)
  return res.stdout
}

describe('redaction leak post-condition (governing test — do not weaken)', () => {
  it('redactText removes the SSN from pdf.js-extracted text, keeps other text', async () => {
    const src = await buildSsnFixture()
    expect(await fullText(src)).toContain(SSN) // fixture sanity
    const out = await redactText(src, SSN, { mode: 'black' })
    const text = await fullText(out)
    expect(text).not.toContain(SSN)
    expect(text).not.toContain('123-45') // no partial survivor
    expect(text).toContain('Employee record')
    expect(text).toContain('Other text stays')
  })

  it('redactRegions with an explicit box removes the covered line', async () => {
    const src = await buildSsnFixture()
    // Box over the SSN line: baseline 660, 14pt Helvetica -> cover y 655..680 generously
    const out = await redactRegions(
      src,
      [{ page: 0, rect: { x: 60, y: 652, w: 250, h: 28 } }],
      { mode: 'black' }
    )
    const text = await fullText(out)
    expect(text).not.toContain(SSN)
    expect(text).toContain('Employee record')
  })

  it('blur mode ALSO removes the text (blur is cosmetic only)', async () => {
    const src = await buildSsnFixture()
    const out = await redactRegions(
      src,
      [{ page: 0, rect: { x: 60, y: 652, w: 250, h: 28 } }],
      { mode: 'blur' }
    )
    expect(await fullText(out)).not.toContain(SSN)
  })

  it.skipIf(!hasPdftotext)('pdftotext agrees: SSN absent after redactText', async () => {
    const out = await redactText(await buildSsnFixture(), SSN, { mode: 'black' })
    const text = pdftotextOf(out)
    expect(text).not.toContain(SSN)
    expect(text).toContain('Employee record')
  })
})
