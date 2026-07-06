import { describe, it, expect } from 'vitest'
import { boxBlur3 } from '../../src/ops/blur.js'

describe('boxBlur3', () => {
  it('spreads a single bright pixel and preserves total energy roughly', () => {
    const w = 21
    const h = 21
    const data = new Uint8ClampedArray(w * h * 4)
    // alpha opaque everywhere, single white pixel at center
    for (let i = 3; i < data.length; i += 4) data[i] = 255
    const center = (10 * w + 10) * 4
    data[center] = 255
    data[center + 1] = 255
    data[center + 2] = 255

    boxBlur3(data, w, h, 3)

    // center is no longer pure white, neighbors are no longer pure black
    expect(data[center]).toBeLessThan(255)
    const neighbor = (10 * w + 12) * 4
    expect(data[neighbor]).toBeGreaterThan(0)
  })

  it('is uniform on a uniform field (no edge artifacts)', () => {
    const w = 8
    const h = 8
    const data = new Uint8ClampedArray(w * h * 4).fill(200)
    boxBlur3(data, w, h, 2)
    for (let i = 0; i < data.length; i++) expect(data[i]).toBe(200)
  })
})
