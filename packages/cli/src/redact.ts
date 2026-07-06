import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import {
  redactRegions,
  redactText,
  parsePageRanges,
  StreamSurgeryError
} from '@pdfx/core'
import type { RedactRegion, RedactMode } from '@pdfx/core'
import { PDFDocument } from 'pdf-lib'
import type { CliIo } from './cli.js'
import { EXIT_OK, EXIT_ERROR, EXIT_USAGE } from './cli.js'

function parseBox(spec: string): RedactRegion {
  const m = /^(\d+):([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/.exec(spec)
  if (!m) throw new Error(`--box must be "page:x,y,w,h" (1-based page); got "${spec}"`)
  const page1 = parseInt(m[1], 10)
  if (page1 < 1) throw new Error(`--box page must be >= 1 (1-based); got ${page1}`)
  return {
    page: page1 - 1, // 1-based CLI → 0-based model
    rect: { x: parseFloat(m[2]), y: parseFloat(m[3]), w: parseFloat(m[4]), h: parseFloat(m[5]) }
  }
}

export async function runRedact(rest: string[], io: CliIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        find: { type: 'string' },
        regex: { type: 'string' },
        pages: { type: 'string', short: 'p' },
        box: { type: 'string', multiple: true },
        mode: { type: 'string' },
        rasterize: { type: 'boolean' },
        out: { type: 'string', short: 'o' }
      }
    })
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return EXIT_USAGE
  }

  const file = parsed.positionals[0]
  if (!file || parsed.positionals.length > 1) {
    io.err('Usage: pdfx redact <input.pdf> [--find <text>|--regex <re>] [--box <page:x,y,w,h>]... [--mode black|blur|rasterize] [-p <ranges>] [-o <out.pdf>]')
    io.err('  --rasterize  (robust fallback for complex documents; use when stream surgery fails)')
    return EXIT_USAGE
  }

  const flags = parsed.values
  const hasFind = flags.find !== undefined
  const hasRegex = flags.regex !== undefined
  const hasBox = Array.isArray(flags.box) && flags.box.length > 0

  if (!hasFind && !hasRegex && !hasBox) {
    io.err('pdfx redact: requires --find <text>, --regex <re>, or --box <page:x,y,w,h>')
    return EXIT_USAGE
  }

  // --mode validation; --rasterize overrides to 'rasterize'
  const modeRaw = flags.rasterize ? 'rasterize' : (flags.mode ?? 'black')
  if (modeRaw !== 'black' && modeRaw !== 'blur' && modeRaw !== 'rasterize') {
    io.err(`pdfx redact: --mode must be black, blur, or rasterize; got "${flags.mode}"`)
    return EXIT_USAGE
  }
  const mode: RedactMode = modeRaw

  // Parse --box specs
  let boxes: RedactRegion[] = []
  if (hasBox) {
    try {
      boxes = (flags.box as string[]).map(parseBox)
    } catch (error) {
      io.err(`pdfx redact: ${error instanceof Error ? error.message : String(error)}`)
      return EXIT_USAGE
    }
  }

  // --pages only applies to --find/--regex; reject upfront so the user doesn't get silently wrong behavior
  if (flags.pages !== undefined && !hasFind && !hasRegex) {
    io.err('pdfx redact: --pages only applies to --find/--regex')
    return EXIT_USAGE
  }

  // Parse --pages (1-based user input; parsePageRanges returns 0-based)
  let pages: number[] | undefined
  if (flags.pages !== undefined) {
    try {
      const bytes = new Uint8Array(await readFile(file))
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      pages = parsePageRanges(flags.pages, doc.getPageCount())
    } catch (error) {
      io.err(`pdfx redact: ${error instanceof Error ? error.message : String(error)}`)
      return EXIT_ERROR
    }
  }

  try {
    let bytes: Uint8Array = new Uint8Array(await readFile(file))

    // Apply box regions first, then text patterns
    if (hasBox) {
      bytes = await redactRegions(bytes, boxes, { mode })
    }
    if (hasFind) {
      bytes = await redactText(bytes, flags.find as string, { mode, pages })
    }
    if (hasRegex) {
      let re: RegExp
      try {
        re = new RegExp(flags.regex as string, 'g')
      } catch {
        io.err(`pdfx redact: invalid regex "${flags.regex}"`)
        return EXIT_USAGE
      }
      bytes = await redactText(bytes, re, { mode, pages })
    }

    const outPath = flags.out ?? file.replace(/\.pdf$/i, '.redacted.pdf')
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, bytes)
    io.out(`redact: wrote ${outPath}`)
    return EXIT_OK
  } catch (error) {
    if (error instanceof StreamSurgeryError) {
      // StreamSurgeryError already contains the reason. Print actionable guidance.
      io.err(
        `pdfx redact: ${error.message}\n` +
        `  Complex layouts commonly trigger this. Re-run with --mode rasterize (or --rasterize) for robust redaction.`
      )
      return EXIT_ERROR
    }
    io.err(`pdfx redact: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
}
