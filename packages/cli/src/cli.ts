import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { PDFDocument } from 'pdf-lib'
import {
  cropPages, deletePages, mergeInputs, pullPages, resetCrop, rotatePages, splitPdfx,
  parseManifest, stripExtension, type MergeInput, type PdfxManifest
} from '@pdfx/core'
import { extractArtifacts, extractAssets, type ExtractArtifactsOptions } from '@pdfx/core/extract'

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
  pdfx split <file.pdfx> -o <outDir> [-f] [--json]
  pdfx merge <input[#sel]>... -o <out.pdf|out.pdfx> [--kind pdf|pdfx] [-f] [--json]
  pdfx pull <file> --pages <ranges> -o <out.pdf> [-f] [--json]
  pdfx delete <file> --pages <ranges> -o <out.pdf> [-f] [--json]
  pdfx rotate <file> --angle <deg> [--pages <ranges>] -o <out.pdf> [-f] [--json]
  pdfx crop <file> --box x,y,w,h [--pages <ranges>] [--reset] -o <out.pdf> [-f] [--json]
  pdfx assets <file> -o <outDir> [--json]

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

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

/** Returns an error line if outPath exists and force is false; null when safe to write. */
async function guardOutput(outPath: string, force: boolean): Promise<string | null> {
  if (!force && (await fileExists(outPath))) {
    return `Refusing to overwrite ${outPath} (pass -f to force)`
  }
  return null
}

export interface MergeArgSpec {
  path: string
  ranges?: string
  name?: string
}

/**
 * Parse a merge input argument: "file.pdf#3-5" → range selector,
 * "file.pdfx#Contract" → member-name selector, plain path otherwise.
 * A selector that looks like a range spec (digits/dashes/commas) is a range;
 * anything else after # is a member-document name.
 */
export function parseMergeArg(arg: string): MergeArgSpec {
  const hash = arg.lastIndexOf('#')
  if (hash <= 0 || hash === arg.length - 1) return { path: arg }
  const path = arg.slice(0, hash)
  const sel = arg.slice(hash + 1)
  if (/^\d+(-\d*)?(,\d+(-\d*)?)*$/.test(sel)) return { path, ranges: sel }
  return { path, name: sel }
}

interface SurgeryFlags {
  out?: string
  pages?: string
  angle?: string
  box?: string
  reset?: boolean
  force?: boolean
  json?: boolean
}

async function runSurgery(
  verb: 'pull' | 'delete' | 'rotate' | 'crop',
  rest: string[],
  io: CliIo
): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        pages: { type: 'string' },
        angle: { type: 'string' },
        box: { type: 'string' },
        reset: { type: 'boolean' },
        force: { type: 'boolean', short: 'f' },
        json: { type: 'boolean' }
      }
    })
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    io.err(USAGE)
    return EXIT_USAGE
  }
  const flags = parsed.values as SurgeryFlags
  const file = parsed.positionals[0]
  if (!file || parsed.positionals.length > 1 || !flags.out) {
    io.err(USAGE)
    return EXIT_USAGE
  }
  if ((verb === 'pull' || verb === 'delete') && !flags.pages) {
    io.err(`pdfx ${verb}: --pages <ranges> is required`)
    return EXIT_USAGE
  }
  let angle = 0
  if (verb === 'rotate') {
    angle = Number(flags.angle)
    if (!Number.isInteger(angle) || angle % 90 !== 0) {
      io.err(`pdfx rotate: --angle must be a multiple of 90, got "${flags.angle}"`)
      return EXIT_USAGE
    }
  }
  let box = { x: 0, y: 0, width: 0, height: 0 }
  if (verb === 'crop' && !flags.reset) {
    const parts = (flags.box ?? '').split(',').map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      io.err('pdfx crop: --box must be four numbers "x,y,width,height" (or pass --reset)')
      return EXIT_USAGE
    }
    box = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] }
  }
  try {
    const guard = await guardOutput(flags.out, flags.force ?? false)
    if (guard) { io.err(guard); return EXIT_ERROR }
    const bytes = await loadInput(file)
    let result: Uint8Array
    if (verb === 'pull') result = await pullPages(bytes, flags.pages as string)
    else if (verb === 'delete') result = await deletePages(bytes, flags.pages as string)
    else if (verb === 'rotate') result = await rotatePages(bytes, angle, flags.pages)
    else if (flags.reset) result = await resetCrop(bytes, flags.pages)
    else result = await cropPages(bytes, box, flags.pages)
    await mkdir(dirname(flags.out), { recursive: true })
    await writeFile(flags.out, result)
    if (flags.json) io.out(JSON.stringify({ verb, input: file, output: flags.out }))
    else io.out(`${verb}: wrote ${flags.out}`)
    return EXIT_OK
  } catch (error) {
    io.err(`pdfx ${verb}: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
}

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g

async function runSplit(rest: string[], io: CliIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        force: { type: 'boolean', short: 'f' },
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
  if (!file || parsed.positionals.length > 1 || !outDir) { io.err(USAGE); return EXIT_USAGE }
  try {
    const bytes = await loadInput(file)
    const members = await splitPdfx(bytes)
    await mkdir(outDir, { recursive: true })
    const outputs: string[] = []
    const used = new Set<string>()
    for (const member of members) {
      // Plain PDFs split to one member named "Untitled" in core; use the
      // file's basename instead so CLI users see the filename (deviation 7).
      const base = member.name === 'Untitled' ? stripExtension(basename(file)) : member.name
      const safe = base.replace(ILLEGAL_FILENAME_CHARS, '-').trim() || 'Untitled'
      let filename = `${safe}.pdf`
      for (let n = 2; used.has(filename); n++) filename = `${safe} (${n}).pdf`
      used.add(filename)
      const outPath = join(outDir, filename)
      const guard = await guardOutput(outPath, parsed.values.force ?? false)
      if (guard) { io.err(guard); return EXIT_ERROR }
      await writeFile(outPath, member.pdf)
      outputs.push(outPath)
    }
    if (parsed.values.json) io.out(JSON.stringify({ verb: 'split', input: file, outputs }))
    else for (const o of outputs) io.out(`split: wrote ${o}`)
    return EXIT_OK
  } catch (error) {
    io.err(`pdfx split: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
}

async function runMerge(rest: string[], io: CliIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        kind: { type: 'string' },
        force: { type: 'boolean', short: 'f' },
        json: { type: 'boolean' }
      }
    })
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    io.err(USAGE)
    return EXIT_USAGE
  }
  const out = parsed.values.out
  if (parsed.positionals.length === 0 || !out) { io.err(USAGE); return EXIT_USAGE }
  const kindFlag = parsed.values.kind
  if (kindFlag !== undefined && kindFlag !== 'pdf' && kindFlag !== 'pdfx') {
    io.err(`pdfx merge: --kind must be pdf or pdfx, got "${kindFlag}"`)
    return EXIT_USAGE
  }
  const kind: 'pdf' | 'pdfx' = kindFlag ?? (out.endsWith('.pdfx') ? 'pdfx' : 'pdf')
  try {
    const guard = await guardOutput(out, parsed.values.force ?? false)
    if (guard) { io.err(guard); return EXIT_ERROR }
    const inputs: MergeInput[] = []
    for (const arg of parsed.positionals) {
      const spec = parseMergeArg(arg)
      const bytes = await loadInput(spec.path)
      if (spec.name !== undefined) {
        // #name selector: pick the member document out of a .pdfx
        const members = await splitPdfx(bytes)
        const member = members.find((m) => m.name === spec.name)
        if (!member) {
          throw new Error(`no member document named "${spec.name}" in ${spec.path} ` +
            `(has: ${members.map((m) => m.name).join(', ')})`)
        }
        inputs.push({ bytes: member.pdf, name: member.name })
      } else {
        inputs.push({
          bytes,
          ranges: spec.ranges,
          name: stripExtension(basename(spec.path))
        })
      }
    }
    const merged = await mergeInputs(inputs, kind)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, merged)
    if (parsed.values.json) io.out(JSON.stringify({ verb: 'merge', kind, inputCount: inputs.length, output: out }))
    else io.out(`merge: wrote ${out} (${kind}, ${inputs.length} input(s))`)
    return EXIT_OK
  } catch (error) {
    io.err(`pdfx merge: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
}

async function runAssets(rest: string[], io: CliIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
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
  if (!file || parsed.positionals.length > 1 || !outDir) { io.err(USAGE); return EXIT_USAGE }
  try {
    const bytes = await loadInput(file)
    const manifest = await extractAssets(bytes, outDir)
    await writeFile(join(outDir, 'assets.json'), JSON.stringify(manifest, null, 2))
    if (parsed.values.json) {
      io.out(JSON.stringify({
        verb: 'assets', outDir,
        images: manifest.images.length,
        attachments: manifest.attachments.length,
        fonts: manifest.fonts.length
      }))
    } else {
      io.out(`assets: ${manifest.images.length} image(s), ${manifest.attachments.length} attachment(s), ` +
        `${manifest.fonts.length} font name(s) → ${outDir}`)
    }
    return EXIT_OK
  } catch (error) {
    io.err(`pdfx assets: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
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
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
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
  if (verb === 'split') return runSplit(rest, io)
  if (verb === 'merge') return runMerge(rest, io)
  if (verb === 'pull' || verb === 'delete' || verb === 'rotate' || verb === 'crop') {
    return runSurgery(verb, rest, io)
  }
  if (verb === 'assets') return runAssets(rest, io)
  io.err(`Unknown command "${verb}"`)
  io.err(USAGE)
  return EXIT_USAGE
}
