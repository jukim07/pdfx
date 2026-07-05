import { isImageBytes, isImageFile, registerConverter, stripImageExtension } from '@pdfx/core'
import { imageToPdf } from './images'
import { buildMarkupPdf, isMarkupFile, stripMarkupExtension } from './markup'

let registered = false

// Same order as the previous static array in convert.ts: the image converter
// wins over markup when both could match. Idempotent so React StrictMode
// double-invocation or HMR cannot register duplicates.
export function registerRendererConverters(): void {
  if (registered) return
  registered = true
  registerConverter({
    match: (name, data) => isImageFile(name) || isImageBytes(data),
    toPdf: (_name, data, fit) => imageToPdf(data, fit),
    rename: stripImageExtension,
  })
  registerConverter({
    match: (name) => isMarkupFile(name),
    toPdf: (name, data, fit, path) => buildMarkupPdf(name, data, fit, path),
    rename: stripMarkupExtension,
  })
}
