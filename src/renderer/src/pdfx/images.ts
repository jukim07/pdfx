import { PDFDocument } from 'pdf-lib'
import { MAX_IMAGE_PIXELS, isJpeg, isPng, pngSize } from '@pdfx/core'

export { isImageBytes, isImageFile, stripImageExtension } from '@pdfx/core'

function toBlob(data: Uint8Array): Blob {
  return new Blob([new Uint8Array(data)])
}

const MAX_RASTER_DIM = 8192 // px on the longest edge when re-encoding through a canvas

async function rasterToPng(bitmap: ImageBitmap): Promise<Uint8Array> {
  const scale = Math.min(1, MAX_RASTER_DIM / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG encoding failed')
  return new Uint8Array(await blob.arrayBuffer())
}

export async function imageToPdf(
  data: Uint8Array,
  pageSize?: { width: number; height: number }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  let image
  if (isPng(data)) {
    const dim = pngSize(data)
    if (dim && dim.width * dim.height > MAX_IMAGE_PIXELS) {
      throw new Error('Image is too large to import')
    }
    image = await doc.embedPng(data)
  } else if (isJpeg(data)) {
    const oriented = await createImageBitmap(toBlob(data))
    const raw = await createImageBitmap(toBlob(data), { imageOrientation: 'none' })
    const rotated = oriented.width !== raw.width
    raw.close()
    image = rotated ? await doc.embedPng(await rasterToPng(oriented)) : await doc.embedJpg(data)
    oriented.close()
  } else {
    const bitmap = await createImageBitmap(toBlob(data))
    image = await doc.embedPng(await rasterToPng(bitmap))
    bitmap.close()
  }

  const pageWidth = pageSize?.width ?? image.width
  const pageHeight = pageSize?.height ?? image.height
  const scale = Math.min(pageWidth / image.width, pageHeight / image.height)
  const width = image.width * scale
  const height = image.height * scale

  const page = doc.addPage([pageWidth, pageHeight])
  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height
  })
  return doc.save()
}
