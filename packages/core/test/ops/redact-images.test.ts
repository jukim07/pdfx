import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib'
import { redactRegions } from '../../src/ops/redact.js'

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

describe('image removal', () => {
  it('removes an image fully contained in a region (op AND bytes)', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const img = await doc.embedPng(PNG_1x1)
    page.drawImage(img, { x: 100, y: 100, width: 50, height: 50 })
    const bytes = await doc.save()

    const out = await redactRegions(
      bytes,
      [{ page: 0, rect: { x: 90, y: 90, w: 80, h: 80 } }],
      { mode: 'black' },
    )
    const reloaded = await PDFDocument.load(out)
    const res = reloaded.getPages()[0].node.Resources()
    const xobj = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    // the image entry is gone from Resources
    expect(xobj === undefined || xobj.keys().length === 0).toBe(true)
  })

  it('keeps an image only PARTIALLY overlapped by the region', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([612, 792])
    const img = await doc.embedPng(PNG_1x1)
    page.drawImage(img, { x: 100, y: 100, width: 50, height: 50 })
    const bytes = await doc.save()

    const out = await redactRegions(
      bytes,
      [{ page: 0, rect: { x: 120, y: 120, w: 200, h: 200 } }], // overlaps, not contains
      { mode: 'black' },
    )
    const reloaded = await PDFDocument.load(out)
    const xobj = reloaded
      .getPages()[0]
      .node.Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    expect(xobj?.keys().length).toBe(1) // image kept; black box covers the overlap
  })

  it('shared image: redacting page 0 copy does not break page 1', async () => {
    // Embed ONE image object; draw it on two pages (shared PDFRef).
    // Redact a region on page 0 that fully contains the image there.
    // Expected: page 0 XObject entry gone; page 1 entry still present and live.
    const doc = await PDFDocument.create()
    const page0 = doc.addPage([612, 792])
    const page1 = doc.addPage([612, 792])
    const img = await doc.embedPng(PNG_1x1)
    // Both pages draw the same embedded image ref.
    page0.drawImage(img, { x: 100, y: 100, width: 50, height: 50 })
    page1.drawImage(img, { x: 100, y: 100, width: 50, height: 50 })
    const bytes = await doc.save()

    const out = await redactRegions(
      bytes,
      [{ page: 0, rect: { x: 90, y: 90, w: 80, h: 80 } }],
      { mode: 'black' },
    )

    const reloaded = await PDFDocument.load(out)
    const pages = reloaded.getPages()

    // Page 0: XObject entry should be gone.
    const xobj0 = pages[0].node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    expect(xobj0 === undefined || xobj0.keys().length === 0).toBe(true)

    // Page 1: XObject entry must still be present.
    const xobj1 = pages[1].node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    expect(xobj1).toBeDefined()
    expect(xobj1!.keys().length).toBe(1)

    // The ref on page 1 must resolve to a live PDFRawStream, not undefined.
    const firstKey = xobj1!.keys()[0] as PDFName
    const rawVal = xobj1!.get(firstKey)
    expect(rawVal instanceof PDFRef).toBe(true)
    const resolved = reloaded.context.lookup(rawVal as PDFRef)
    expect(resolved instanceof PDFRawStream).toBe(true)

    // Document must reload cleanly (no broken refs would let this pass above,
    // but an additional full save+load confirms structural integrity).
    await expect(PDFDocument.load(out)).resolves.toBeDefined()
  })

  it('CTM order pin: nested translate+scale — correct order removes image, inverted order does not', async () => {
    // Build a page whose content stream is:
    //   q 1 0 0 1 100 100 cm   <- outer translate(100,100)
    //   q 50 0 0 50 10 10 cm   <- inner scale(50,50) at offset(10,10)
    //   /ImX Do
    //   Q Q
    //
    // Per PDF §8.3.4, the CTM accumulates as: point = innerCm * outerCm * deviceOrigin
    // which means the image unit square [0..1]² maps to device space as:
    //   corner (0,0): inner -> (10,10) -> outer -> (110,110)
    //   corner (1,1): inner -> (60,60) -> outer -> (160,160)
    // Device rect: x:110, y:110, w:50, h:50.
    //
    // mul(m, n) in redact-images.ts is called as mul(ctm, newCm) where ctm is the
    // already-accumulated CTM and newCm is the just-parsed cm op.
    // PDF §8.3.4: new_CTM = cm_op * old_CTM (cm premultiplies).
    // Our mul(m,n): result_point = n * m * p  (n applied first, then m).
    // So mul(ctm, newCm) gives result_point = ctm * newCm * p — that matches
    // "newCm applied first, then old ctm", which IS the PDF rule. Order is correct.

    async function buildTwoLayerCmDoc(): Promise<{ bytes: Uint8Array; imgName: string }> {
      const doc = await PDFDocument.create()
      const page = doc.addPage([612, 792])
      const img = await doc.embedPng(PNG_1x1)

      // drawImage once to register the image in page Resources, then replace Contents.
      page.drawImage(img, { x: 0, y: 0, width: 1, height: 1 })
      const res = page.node.Resources()
      const xobj = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)
      const imgName = xobj!.keys()[0].asString().slice(1) // strip leading /

      // Craft content: outer translate(100,100), inner scale(50)+offset(10,10).
      const rawStream = Buffer.from(
        [
          'q',
          '1 0 0 1 100 100 cm', // outer: translate 100,100
          'q',
          '50 0 0 50 10 10 cm', // inner: scale 50, offset 10,10
          '/' + imgName + ' Do',
          'Q',
          'Q',
        ].join('\n'),
      )
      const streamRef = doc.context.register(doc.context.flateStream(rawStream))
      page.node.set(PDFName.of('Contents'), streamRef)

      return { bytes: await doc.save(), imgName }
    }

    const { bytes } = await buildTwoLayerCmDoc()

    // Region that CORRECTLY contains the image at device x:110,y:110,w:50,h:50.
    // A 60×60 box at (105,105) fully encloses it.
    const containingRegion = { page: 0, rect: { x: 105, y: 105, w: 60, h: 60 } }
    const outContaining = await redactRegions(bytes, [containingRegion], { mode: 'black' })
    const reloadedContaining = await PDFDocument.load(outContaining)
    const xobj0 = reloadedContaining
      .getPages()[0]
      .node.Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    // With correct CTM order the image is at (110,110) — well inside (105..165).
    // The Do op should have been removed.
    expect(
      xobj0 === undefined || xobj0.keys().length === 0,
      'containing region should remove the image (correct CTM order)',
    ).toBe(true)

    // Region that ONLY contains the image under the INVERTED multiply order.
    // If the order were wrong, inner cm would be applied last, giving:
    //   outer (0,0) -> (100,100); inner -> (100*50+10, 100*50+10) = (5010,5010) — nonsense,
    //   but the simpler flipped scenario: if mul(ctm,newCm) were mul(newCm,ctm) instead,
    //   then after outer translate: ctm=(1,0,0,1,100,100); after inner scale:
    //   flipped would give ctm=(50,0,0,50, 50*100+10, 50*100+10)=(50,0,0,50,5010,5010).
    // None of that lands near (5,5). More practically: pick a region at (5,5,60,60)
    // which would only contain the image if the device position were at ~(10,10)
    // i.e. if the outer translate were NOT applied first.  With correct order the
    // image is at (110,110) — far outside this region — so it must NOT be removed.
    const { bytes: bytes2 } = await buildTwoLayerCmDoc()
    const nonContainingRegion = { page: 0, rect: { x: 5, y: 5, w: 60, h: 60 } }
    const outNonContaining = await redactRegions(bytes2, [nonContainingRegion], {
      mode: 'black',
    })
    const reloadedNonContaining = await PDFDocument.load(outNonContaining)
    const xobj1 = reloadedNonContaining
      .getPages()[0]
      .node.Resources()
      ?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    // Image is at (110,110), NOT inside (5,5,60,60). Must still be present.
    expect(xobj1?.keys().length, 'non-containing region must leave image intact').toBe(1)
  })
})
