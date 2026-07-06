import { describe, it, expect } from 'vitest'
import { parsePageRanges } from '../src/ops/page-ranges.js'

describe('parsePageRanges', () => {
  it('parses single page (1-indexed → 0-indexed)', () => {
    expect(parsePageRanges('2', 10)).toEqual([1])
  })

  it('parses explicit range 3-5', () => {
    expect(parsePageRanges('3-5', 10)).toEqual([2, 3, 4])
  })

  it('parses comma-separated 3-5,9,12-', () => {
    // pageCount=15; "12-" means pages 12..15 (0-indexed: 11..14)
    expect(parsePageRanges('3-5,9,12-', 15)).toEqual([2, 3, 4, 8, 11, 12, 13, 14])
  })

  it('open-ended suffix 2- with pageCount=4', () => {
    expect(parsePageRanges('2-', 4)).toEqual([1, 2, 3])
  })

  it('clamps out-of-bounds: page 99 in 5-page doc', () => {
    expect(parsePageRanges('99', 5)).toEqual([])
  })

  it('clamps range: 3-99 in 5-page doc', () => {
    expect(parsePageRanges('3-99', 5)).toEqual([2, 3, 4])
  })

  it('deduplicates and preserves order', () => {
    expect(parsePageRanges('1-3,2-4', 5)).toEqual([0, 1, 2, 3])
  })

  it('throws on non-integer token', () => {
    expect(() => parsePageRanges('a-b', 5)).toThrow()
  })

  it('throws on empty spec', () => {
    expect(() => parsePageRanges('', 5)).toThrow()
  })

  it('page 1 in 1-page doc', () => {
    expect(parsePageRanges('1', 1)).toEqual([0])
  })
})
