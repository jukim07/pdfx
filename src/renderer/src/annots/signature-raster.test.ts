import { describe, it, expect } from 'vitest'
import { rasterizeSignature } from './signature-raster'

describe('rasterizeSignature', () => {
  it('produces non-empty PNG bytes with a PNG signature header', async () => {
    const png = await rasterizeSignature(
      [{ points: [10, 10, 50, 40, 90, 10] }],
      120,
      60
    )
    expect(png.length).toBeGreaterThan(50)
    // PNG magic: 89 50 4E 47
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    expect(png[2]).toBe(0x4e)
    expect(png[3]).toBe(0x47)
  })
})
