import { describe, it, expect } from 'vitest'
import { regionsFromQuads, StreamSurgeryError } from './redact-model.js'

describe('redact model', () => {
  it('builds padded regions from quads', () => {
    const regions = regionsFromQuads(
      2,
      [{ x1: 100, y1: 712, x2: 150, y2: 712, x3: 100, y3: 700, x4: 150, y4: 700 }],
      2
    )
    expect(regions).toHaveLength(1)
    expect(regions[0].page).toBe(2)
    expect(regions[0].rect).toEqual({ x: 98, y: 698, w: 54, h: 16 })
  })

  it('StreamSurgeryError carries the page', () => {
    const e = new StreamSurgeryError(3, 'op/item count mismatch')
    expect(e.page).toBe(3)
    expect(e.message).toContain('rasterize')
  })
})
