import { watch as chokidarWatch } from 'chokidar'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { extractArtifacts } from '@pdfx/core/extract'

// Accept both .pdf and .pdfx files; extractArtifacts handles both natively.
const PDF_EXT = /\.(pdf|pdfx)$/i

async function processFile(
  filePath: string,
  outRoot: string,
  onLine: (line: string) => void
): Promise<void> {
  const name = path.basename(filePath, path.extname(filePath))
  const outDir = path.join(outRoot, name)
  try {
    const bytes = new Uint8Array(await readFile(filePath))
    await mkdir(outDir, { recursive: true })
    await extractArtifacts(bytes, outDir)
    // Write .done marker next to source file
    await writeFile(filePath + '.done', '')
    onLine(JSON.stringify({ file: filePath, status: 'ok', outDir }))
  } catch (err) {
    // Write .done so we don't retry endlessly on a corrupt file
    try { await writeFile(filePath + '.done', '') } catch { /* ignore */ }
    onLine(JSON.stringify({ file: filePath, status: 'error', error: String(err) }))
  }
}

/**
 * Watch `dir` for new PDF files. Each new file is processed with extractArtifacts
 * and emits one NDJSON line via `onLine`. A `.done` marker is written next to
 * the source file on completion (success or error).
 *
 * Files present when the watcher starts are skipped (ignoreInitial). Files that
 * already have a `.done` marker are skipped. Dotfiles, `.done` files, and
 * non-PDFs are ignored.
 *
 * Returns a stop function. Await it if you need to ensure the watcher is fully
 * closed before proceeding (e.g. in tests).
 */
export async function watchExtract(
  dir: string,
  outRoot: string,
  onLine: (line: string) => void
): Promise<() => Promise<void>> {
  const processing = new Set<string>()

  const watcher = chokidarWatch(dir, {
    ignoreInitial: true,
    // Ignore dotfiles and .done marker files at the path-filter level
    ignored: (filePath: string) => {
      const base = path.basename(filePath)
      return base.startsWith('.') || base.endsWith('.done')
    },
    awaitWriteFinish: {
      stabilityThreshold: 150,
      pollInterval: 50,
    },
  })

  watcher.on('add', (filePath: string) => {
    if (!PDF_EXT.test(filePath)) return
    // Skip if already has a .done marker (pre-existing processed file)
    if (existsSync(filePath + '.done')) return
    if (processing.has(filePath)) return

    processing.add(filePath)
    void processFile(filePath, outRoot, onLine).finally(() => {
      processing.delete(filePath)
    })
  })

  // Wait for the watcher to finish its initial scan before returning.
  // This guarantees that files dropped immediately after watchExtract resolves
  // will be caught by the 'add' handler rather than treated as pre-existing.
  await new Promise<void>((resolve) => watcher.on('ready', resolve))

  return () => watcher.close()
}
