import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { addWatermark, findWatermarkCandidates, stripWatermark } from '@pdfx/core'
import type { CliIo } from './cli.js'
import { EXIT_OK, EXIT_ERROR, EXIT_USAGE } from './cli.js'

export async function runWatermark(rest: string[], io: CliIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        text: { type: 'string' },
        opacity: { type: 'string' },
        angle: { type: 'string' },
        'font-size': { type: 'string' },
        annot: { type: 'boolean' },
        out: { type: 'string', short: 'o' }
      }
    })
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return EXIT_USAGE
  }

  const file = parsed.positionals[0]
  if (!file || parsed.positionals.length > 1) {
    io.err('Usage: pdfx watermark <input.pdf> --text <text> [--opacity 0.3] [--angle 45] [--font-size 48] [--annot] [-o <out.pdf>]')
    return EXIT_USAGE
  }

  if (!parsed.values.text) {
    io.err('pdfx watermark: --text <text> is required')
    return EXIT_USAGE
  }

  try {
    const bytes = new Uint8Array(await readFile(file))
    const result = await addWatermark(bytes, {
      text: parsed.values.text as string,
      opacity: parsed.values.opacity !== undefined ? parseFloat(parsed.values.opacity as string) : undefined,
      angle: parsed.values.angle !== undefined ? parseFloat(parsed.values.angle as string) : undefined,
      fontSize: parsed.values['font-size'] !== undefined ? parseFloat(parsed.values['font-size'] as string) : undefined,
      variant: parsed.values.annot ? 'annot' : 'stream'
    })
    const outPath = (parsed.values.out as string | undefined) ?? file.replace(/\.pdf$/i, '.watermarked.pdf')
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, result)
    io.out(`watermark: wrote ${outPath}`)
    return EXIT_OK
  } catch (error) {
    io.err(`pdfx watermark: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
}

export async function runWatermarkRm(rest: string[], io: CliIo): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        list: { type: 'boolean' },
        json: { type: 'boolean' },
        strip: { type: 'string' },
        out: { type: 'string', short: 'o' }
      }
    })
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    return EXIT_USAGE
  }

  const file = parsed.positionals[0]
  if (!file || parsed.positionals.length > 1) {
    io.err('Usage: pdfx watermark-rm <input.pdf> (--list [--json] | --strip <id> [-o <out.pdf>])')
    return EXIT_USAGE
  }

  try {
    const bytes = new Uint8Array(await readFile(file))

    if (parsed.values.list) {
      const candidates = await findWatermarkCandidates(bytes)
      if (parsed.values.json) {
        // Always emit valid JSON in --json mode; empty array when no candidates found.
        io.out(JSON.stringify(candidates, null, 2))
      } else if (candidates.length === 0) {
        io.out('No watermark candidates detected.')
      } else {
        for (const c of candidates) {
          io.out(`[${c.id}] ${c.description} (coverage: ${(c.pageCoverage * 100).toFixed(0)}%)`)
        }
      }
      return EXIT_OK
    }

    if (parsed.values.strip !== undefined) {
      const outPath = (parsed.values.out as string | undefined) ?? file.replace(/\.pdf$/i, '.stripped.pdf')
      const result = await stripWatermark(bytes, parsed.values.strip as string)
      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, result)
      io.out(`watermark-rm: wrote ${outPath}`)
      return EXIT_OK
    }

    io.err('pdfx watermark-rm: requires --list or --strip <id>')
    return EXIT_USAGE
  } catch (error) {
    io.err(`pdfx watermark-rm: ${error instanceof Error ? error.message : String(error)}`)
    return EXIT_ERROR
  }
}
