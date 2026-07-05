import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createWorker } from 'tesseract.js'

export interface OcrEngine {
  recognize(png: Uint8Array): Promise<string>
  terminate(): Promise<void>
}

// Resolve the same traineddata files the Electron app bundles (see
// scripts/copy-ocr-assets.mjs): @tesseract.js-data/<lang>/4.0.0_best_int/.
// Returns undefined when the language package is not installed, in which
// case tesseract.js falls back to its default remote langPath + local cache.
function localLangPath(lang: string): string | undefined {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require.resolve(`@tesseract.js-data/${lang}/package.json`)
    return join(dirname(pkg), '4.0.0_best_int')
  } catch {
    return undefined
  }
}

export async function createOcrEngine(lang = 'eng'): Promise<OcrEngine> {
  const langPath = localLangPath(lang)
  const worker = await createWorker(lang, undefined, {
    ...(langPath ? { langPath, gzip: true, cacheMethod: 'none' } : {}),
    logger: () => {}
  })
  return {
    async recognize(png: Uint8Array): Promise<string> {
      const { data } = await worker.recognize(Buffer.from(png))
      return data.text ?? ''
    },
    async terminate(): Promise<void> {
      await worker.terminate()
    }
  }
}
