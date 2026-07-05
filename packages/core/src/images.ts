const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i

export function isImageFile(name: string): boolean {
  return IMAGE_EXT.test(name)
}

export function stripImageExtension(name: string): string {
  return name.replace(IMAGE_EXT, '')
}

export function isPng(data: Uint8Array): boolean {
  return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47
}

export function isJpeg(data: Uint8Array): boolean {
  return data[0] === 0xff && data[1] === 0xd8
}

export function isImageBytes(data: Uint8Array): boolean {
  return isPng(data) || isJpeg(data)
}

// Guard against image decompression bombs: a small, highly-compressed file can
// decode to enormous pixel dimensions and exhaust renderer memory.
export const MAX_IMAGE_PIXELS = 100 * 1024 * 1024 // 100 MP cap on a directly-embedded image

// PNG IHDR stores width/height as big-endian uint32 at byte offsets 16 and 20.
export function pngSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 24 || !isPng(data)) return null
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}
