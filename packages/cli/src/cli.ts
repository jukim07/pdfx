import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { PDFDocument } from 'pdf-lib'
import { parseManifest, stripExtension, type PdfxManifest } from '@pdfx/core'
import { extractArtifacts, type ExtractArtifactsOptions } from '@pdfx/core/extract'

export const EXIT_OK = 0
export const EXIT_ERROR = 1
export const EXIT_USAGE = 2

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

const USAGE = `Usage:
  pdfx info <file.pdf|file.pdfx> [--json]
  pdfx extract <file.pdf|file.pdfx> -o <outDir> [--format md,png] [--dpi 150] [--pages 1-3,5] [--lang eng] [--no-ocr] [--json]

Exit codes: 0 success, 1 operational error, 2 usage error.`

export function parsePagesFlag(spec: string): number[] {
  const pages = new Set<number>()
  for (const part of spec.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim())
    if (!m) throw new Error(`Invalid --pages value "${part.trim()}"`)
    const start = Number(m[1])
    const end = m[2] ? Number(m[2]) : start
    if (start < 1 || end < start) throw new Error(`Invalid --pages range "${part.trim()}"`)
    for (let p = start; p <= end; p++) pages.add(p)
  }
  return [...pages].sort((a, b) => a - b)
}

async function loadInput(file: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(file))
}

async function runInfo(rest: string[], io: CliIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' }
      }
    })
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    io.err(USAGE)
    return EXIT_USAGE
  }
  const file = parsed.positionals[0]
  if (!file || parsed.positionals.length > 1) {
    io.err(USAGE)
    return EXIT_USAGE
  }
  try {
    const bytes = await loadInput(file)
    const pdf = await PDFDocument.load(bytes)
    const manifest: PdfxManifest | null = await parseManifest(bytes)
    const docs = manifest
      ? manifest.documents.map((d) => ({ name: d.name, pages: d.pages }))
      : [{ name: stripExtension(basename(file)), pages: pdf.getPageCount() }]
    const info = {
      file,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      pageCount: pdf.getPageCount(),
      title: manifest?.title ?? null,
      docs
    }
    if (parsed.values.json) {
      io.out(JSON.stringify(info, null, 2))
    } else {
      io.out(`${info.file}: ${info.pageCount} page(s), ${info.docs.length} document(s)`)
      if (info.title) io.out(`title: ${info.title}`)
      for (const doc of info.docs) io.out(`  - ${doc.name} (${doc.pages} page(s))`)
      io.out(`sha256: ${info.sha256}`)
    }
    return EXIT_OK
  } catch (error) {
    io.err(`pdfx info: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
}

async function runExtract(rest: string[], io: CliIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        format: { type: 'string' },
        dpi: { type: 'string' },
        pages: { type: 'string' },
        lang: { type: 'string' },
        'no-ocr': { type: 'boolean' },
        json: { type: 'boolean' }
      }
    })
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    io.err(USAGE)
    return EXIT_USAGE
  }
  const file = parsed.positionals[0]
  const outDir = parsed.values.out
  if (!file || parsed.positionals.length > 1 || !outDir) {
    io.err(USAGE)
    return EXIT_USAGE
  }
  const opts: ExtractArtifactsOptions = {}
  if (parsed.values.format !== undefined) {
    const formats = parsed.values.format.split(',').map((f) => f.trim())
    if (formats.length === 0 || !formats.every((f) => f === 'md' || f === 'png')) {
      io.err(`Invalid --format "${parsed.values.format}"; expected a comma list of md,png`)
      return EXIT_USAGE
    }
    opts.formats = formats as ('md' | 'png')[]
  }
  if (parsed.values.dpi !== undefined) {
    const dpi = Number(parsed.values.dpi)
    if (!Number.isFinite(dpi) || dpi <= 0) {
      io.err(`Invalid --dpi "${parsed.values.dpi}"`)
      return EXIT_USAGE
    }
    opts.dpi = dpi
  }
  if (parsed.values.pages !== undefined) {
    try {
      opts.pages = parsePagesFlag(parsed.values.pages)
    } catch (error) {
      io.err(error instanceof Error ? error.message : String(error))
      return EXIT_USAGE
    }
  }
  if (parsed.values.lang !== undefined) opts.ocrLang = parsed.values.lang
  if (parsed.values['no-ocr']) opts.ocr = false
  try {
    const bytes = await loadInput(file)
    const manifest = await extractArtifacts(bytes, outDir, opts)
    if (parsed.values.json) {
      io.out(JSON.stringify(manifest, null, 2))
    } else {
      io.out(
        `Extracted ${manifest.pages.length} page(s) across ${manifest.docs.length} document(s) to ${outDir}`
      )
      for (const doc of manifest.docs) {
        io.out(`  - ${doc.name}${doc.markdown ? ` → ${doc.markdown}` : ''}`)
      }
    }
    return EXIT_OK
  } catch (error) {
    io.err(`pdfx extract: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
}

export async function runCli(
  argv: string[],
  io: CliIo = { out: console.log, err: console.error }
): Promise<number> {
  const [verb, ...rest] = argv
  if (!verb || verb === '--help' || verb === '-h' || verb === 'help') {
    io.out(USAGE)
    return verb ? EXIT_OK : EXIT_USAGE
  }
  if (verb === 'info') return runInfo(rest, io)
  if (verb === 'extract') return runExtract(rest, io)
  io.err(`Unknown command "${verb}"`)
  io.err(USAGE)
  return EXIT_USAGE
}
