#!/usr/bin/env node
// Generates a synthetic 1500-page PDF for perf/memory testing.
// Usage: node scripts/gen-fixture-1500.mjs
// Output: test-fixtures/synthetic-1500.pdf

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'test-fixtures')
const OUT_PATH = join(OUT_DIR, 'synthetic-1500.pdf')
const PAGE_COUNT = 1500

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (let i = 0; i < PAGE_COUNT; i++) {
    const page = doc.addPage([612, 792])
    page.drawText(`Page ${i + 1} of ${PAGE_COUNT} — synthetic fixture for perf testing`, {
      x: 50, y: 720, size: 12, font, color: rgb(0, 0, 0)
    })
    page.drawText(`Unique token: fixture-page-${i + 1}-${Math.random().toString(36).slice(2)}`, {
      x: 50, y: 700, size: 10, font, color: rgb(0.3, 0.3, 0.3)
    })
  }

  const bytes = await doc.save()
  writeFileSync(OUT_PATH, bytes)
  console.log(`Written: ${OUT_PATH} (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, ${PAGE_COUNT} pages)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
