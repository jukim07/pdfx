import { describe, it, expect } from 'vitest'
import { isWithinSnapThreshold } from './create-zoom-behavior'

describe('isWithinSnapThreshold', () => {
  it('returns true when currentK equals fitK (0% deviation)', () => {
    expect(isWithinSnapThreshold(1.0, 1.0)).toBe(true)
  })

  it('returns true when currentK is 7.9% above fitK (just inside threshold)', () => {
    expect(isWithinSnapThreshold(1.079, 1.0)).toBe(true)
  })

  it('returns true when currentK is 7.9% below fitK (just inside threshold)', () => {
    expect(isWithinSnapThreshold(0.921, 1.0)).toBe(true)
  })

  it('returns true when deviation is within threshold (4%)', () => {
    expect(isWithinSnapThreshold(1.04, 1.0)).toBe(true)
  })

  it('returns false when currentK is just over 8% above fitK', () => {
    // 8.01% deviation
    expect(isWithinSnapThreshold(1.0801, 1.0)).toBe(false)
  })

  it('returns false when currentK is just over 8% below fitK', () => {
    expect(isWithinSnapThreshold(0.9199, 1.0)).toBe(false)
  })

  it('returns false when deviation is large (20%)', () => {
    expect(isWithinSnapThreshold(1.2, 1.0)).toBe(false)
  })

  it('works correctly with a non-unit fitK (0.5)', () => {
    // 7% of 0.5 = 0.035; 0.535 is within threshold
    expect(isWithinSnapThreshold(0.535, 0.5)).toBe(true)
    // 9% of 0.5 = 0.045; 0.545 exceeds threshold
    expect(isWithinSnapThreshold(0.545, 0.5)).toBe(false)
  })

  it('works correctly with a large fitK (2.0)', () => {
    // 7% of 2.0 = 0.14; 2.14 is within threshold
    expect(isWithinSnapThreshold(2.14, 2.0)).toBe(true)
    // 9% of 2.0 = 0.18; 2.18 exceeds threshold
    expect(isWithinSnapThreshold(2.18, 2.0)).toBe(false)
  })
})
