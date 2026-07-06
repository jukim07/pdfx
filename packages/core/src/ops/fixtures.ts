import { PDFDocument, StandardFonts } from 'pdf-lib'

export const SSN = '123-45-6789'

/** One 612x792 page. Helvetica 14pt lines at known baselines:
 *  "Employee record"   at (72, 700)
 *  "SSN: 123-45-6789"  at (72, 660)
 *  "Other text stays"  at (72, 620)
 *  pdf-lib emits one Tj per drawText -> the 1:1 op/item fast path applies. */
export async function buildSsnFixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.drawText('Employee record', { x: 72, y: 700, size: 14, font })
  page.drawText(`SSN: ${SSN}`, { x: 72, y: 660, size: 14, font })
  page.drawText('Other text stays', { x: 72, y: 620, size: 14, font })
  return doc.save()
}
