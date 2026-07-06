import type { PdfxManifestDocumentSource } from '@pdfx/core'
import type { IncomingFile } from './types'

/**
 * Build a PdfxManifestDocumentSource from an IncomingFile when both sha256 and
 * importedAt are present. Returns undefined if provenance data is missing.
 *
 * Centralised here so dropFilesAsNewDocs and useImport share the same guard.
 */
export function buildProvenance(
  file: IncomingFile,
  converted: boolean
): PdfxManifestDocumentSource | undefined {
  if (!file.sha256 || !file.importedAt) return undefined
  return {
    filename: file.name,
    sha256: file.sha256,
    importedAt: file.importedAt,
    converted
  }
}
