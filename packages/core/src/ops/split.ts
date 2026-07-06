import { PDFDocument } from 'pdf-lib'
import { parseManifest, partitionPages } from '../format.js'

/**
 * Split a .pdfx into its member documents by manifest partition; member
 * names come from the manifest. A plain PDF (no manifest) yields a single
 * member named "Untitled". Range extraction is pullPages' job, not this op's.
 */
export async function splitPdfx(bytes: Uint8Array): Promise<{ name: string; pdf: Uint8Array }[]> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const manifest = await parseManifest(bytes)
  const parts = partitionPages(manifest, src.getPageCount(), 'Untitled')
  const members: { name: string; pdf: Uint8Array }[] = []
  for (const part of parts) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, part.indices)
    for (const p of copied) out.addPage(p)
    members.push({ name: part.name, pdf: await out.save() })
  }
  return members
}
