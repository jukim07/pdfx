import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFHexString
} from 'pdf-lib'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { MANIFEST_NAME } from '../format.js'

export interface AssetsManifest {
  /** file paths are relative to the outDir passed to extractAssets */
  images: { refId: string; page: number; file: string }[]
  attachments: { filename: string; mimeType: string | null; file: string }[]
  fonts: { name: string; subtype: string | null }[]
}

/**
 * Extract embedded images, file attachments, and font names from a PDF,
 * writing files under outDir (images/image-<n>.png, attachments/<filename>)
 * and returning the manifest.
 *
 * Images: walks each page's operator list for paintImageXObject opcodes,
 * deduplicated by XObject ref, raw RGB converted to PNG via rgbToPng.
 * Attachments: pdf.js getAttachments(); the pdfx manifest entry is skipped.
 *   MIME types are read via pdf-lib from the /Subtype of the embedded stream
 *   since pdfjs's getAttachments() does not expose them.
 * Fonts: best-effort name enumeration only; no font bytes.
 */
export async function extractAssets(bytes: Uint8Array, outDir: string): Promise<AssetsManifest> {
  const pdf = await getDocument({ data: bytes.slice() }).promise
  await mkdir(join(outDir, 'images'), { recursive: true })
  await mkdir(join(outDir, 'attachments'), { recursive: true })

  // Build MIME map from pdf-lib (pdfjs does not expose /Subtype on attachments).
  const mimeByFilename = await readAttachmentMimeTypes(bytes)

  const images: AssetsManifest['images'] = []
  const seenRefs = new Set<string>()
  const fonts: AssetsManifest['fonts'] = []
  const seenFonts = new Set<string>()

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const opList = await page.getOperatorList()

    for (let i = 0; i < opList.fnArray.length; i++) {
      if (opList.fnArray[i] !== OPS.paintImageXObject) continue
      const refId = opList.argsArray[i][0] as string
      if (seenRefs.has(refId)) continue
      seenRefs.add(refId)

      let pngBytes: Uint8Array | null = null
      try {
        // Use callback form: page.objs.get(refId, cb) fires cb once the XObject
        // is resolved, which may happen asynchronously relative to getOperatorList().
        const imgData = await new Promise<{ data?: Uint8Array; width?: number; height?: number } | null>(
          (resolve) => {
            try {
              page.objs.get(refId, resolve)
            } catch {
              resolve(null)
            }
          }
        )
        if (imgData?.data && imgData.width && imgData.height) {
          pngBytes = rgbToPng(imgData.data, imgData.width, imgData.height)
        }
      } catch {
        // Object not resolved or inaccessible — skip this image
      }
      if (!pngBytes) continue

      const file = join('images', `image-${images.length}.png`)
      await writeFile(join(outDir, file), pngBytes)
      images.push({ refId, page: pageNum - 1, file })
    }

    // Best-effort font enumeration from resolved common objects
    try {
      for (const [key] of page.commonObjs) {
        if ((key.startsWith('g_') || key.startsWith('f_') || key.startsWith('F')) && !seenFonts.has(key)) {
          seenFonts.add(key)
          fonts.push({ name: key, subtype: null })
        }
      }
    } catch {
      // Best-effort; ignore
    }
  }

  const rawAttachments = (await pdf.getAttachments()) as Record<
    string,
    { filename?: string; content: Uint8Array }
  > | null

  const attachments: AssetsManifest['attachments'] = []
  if (rawAttachments) {
    for (const [key, att] of Object.entries(rawAttachments)) {
      const filename = att.filename ?? key
      if (filename === MANIFEST_NAME) continue // skip pdfx manifest
      const safe = filename.replace(/[\\/:*?"<>|]/g, '-')
      const file = join('attachments', safe)
      await writeFile(join(outDir, file), att.content)
      attachments.push({
        filename,
        mimeType: mimeByFilename.get(filename) ?? null,
        file
      })
    }
  }

  return { images, attachments, fonts }
}

/**
 * Read attachment MIME types from the PDF via pdf-lib's low-level object model.
 * Returns a map of { filename → mimeType } for all embedded files that carry
 * a /Subtype on their stream dict. Keys match the filename as pdfjs reports it.
 *
 * The /Subtype value is a PDFName with URL-encoded slashes (e.g. /text#2Fplain).
 * We decode that and strip the leading / to get a proper MIME string.
 */
async function readAttachmentMimeTypes(bytes: Uint8Array): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let loaded: PDFDocument
  try {
    loaded = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch {
    return map
  }
  try {
    const names = loaded.catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
    const ef = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict)
    const arr = ef?.lookupMaybe(PDFName.of('Names'), PDFArray)
    if (!arr) return map

    for (let i = 0; i + 1 < arr.size(); i += 2) {
      const nameObj = arr.lookup(i)
      let filename: string | null = null
      if (nameObj instanceof PDFString || nameObj instanceof PDFHexString) {
        filename = nameObj.decodeText()
      }
      if (!filename) continue

      try {
        const spec = arr.lookup(i + 1, PDFDict)
        const efDict = spec.lookupMaybe(PDFName.of('EF'), PDFDict)
        if (!efDict) continue
        const fRef = efDict.get(PDFName.of('F'))
        if (!(fRef instanceof PDFRef)) continue
        const fStream = loaded.context.lookup(fRef)
        if (!(fStream instanceof PDFRawStream)) continue
        const subtypeObj = fStream.dict.get(PDFName.of('Subtype'))
        if (!subtypeObj) continue
        // PDFName.encodedName is the raw /xxx string (with leading /)
        const rawName: string = (subtypeObj as PDFName).encodedName ?? ''
        // Strip leading / and URL-decode # sequences
        const mime = rawName.replace(/^\//, '').replace(/#([0-9A-Fa-f]{2})/g, (_, h) =>
          String.fromCharCode(parseInt(h, 16))
        )
        if (mime) map.set(filename, mime)
      } catch {
        // Individual entry malformed — skip it
      }
    }
  } catch {
    // Ignore; return empty map
  }
  return map
}

/**
 * Encode raw RGB pixel data (3 bytes/pixel, no alpha) as a minimal PNG using
 * pure TypeScript. Uses a simple uncompressed zlib stream (deflate level 0).
 * Sufficient for lossless roundtrip; not size-optimised.
 *
 * pdfjs resolves image XObjects to { data: Uint8Array (RGB), width, height }.
 * The kind field indicates the color space; kind=2 is RGB.
 */
function rgbToPng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  // PNG signature
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

  function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type)
    const len = data.length
    const buf = new Uint8Array(12 + len)
    const view = new DataView(buf.buffer)
    view.setUint32(0, len)
    buf.set(typeBytes, 4)
    buf.set(data, 8)
    const crc = crc32(new Uint8Array([...typeBytes, ...data]))
    view.setUint32(8 + len, crc)
    return buf
  }

  // IHDR: 8-bit depth, RGB color type (2)
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  // compression/filter/interlace = 0

  // Build raw scanline data: [filter=0, r, g, b, ...] × height rows
  const rowSize = width * 3 + 1
  const raw = new Uint8Array(height * rowSize)
  for (let row = 0; row < height; row++) {
    raw[row * rowSize] = 0 // filter byte = None
    raw.set(rgb.subarray(row * width * 3, (row + 1) * width * 3), row * rowSize + 1)
  }

  // Compute adler32 over the raw scanline data
  let adler1 = 1
  let adler2 = 0
  for (const b of raw) {
    adler1 = (adler1 + b) % 65521
    adler2 = (adler2 + adler1) % 65521
  }

  // IDAT: zlib header + deflate stored blocks + adler32
  const rawSize = raw.length
  const blockMax = 65535
  const numBlocks = Math.ceil(rawSize / blockMax) || 1
  const zlibSize = 2 + numBlocks * 5 + rawSize + 4
  const idat = new Uint8Array(zlibSize)
  const idatView = new DataView(idat.buffer)
  idat[0] = 0x78
  idat[1] = 0x01 // zlib header (deflate, level 1)
  let pos = 2
  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockMax
    const blockLen = Math.min(rawSize - start, blockMax)
    const isFinal = b === numBlocks - 1
    idat[pos++] = isFinal ? 0x01 : 0x00
    idatView.setUint16(pos, blockLen, true)
    pos += 2
    idatView.setUint16(pos, (~blockLen) & 0xffff, true)
    pos += 2
    idat.set(raw.subarray(start, start + blockLen), pos)
    pos += blockLen
  }
  idatView.setUint32(pos, (adler2 << 16) | adler1)

  const iend = new Uint8Array(0)
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', iend)]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of data) {
    crc ^= b
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
