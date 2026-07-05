import { describe, expect, it } from 'vitest'
import { findConverter, registerConverter, type Converter } from '../src/index.js'

describe('converter registry', () => {
  it('returns null when nothing is registered', () => {
    expect(findConverter('file.xyz', new Uint8Array())).toBeNull()
  })

  it('returns the first registered converter whose match passes', () => {
    const first: Converter = {
      match: (name) => name.endsWith('.foo'),
      toPdf: async () => new Uint8Array([1]),
      rename: (name) => name.replace(/\.foo$/, '')
    }
    const second: Converter = {
      match: (name) => name.endsWith('.foo') || name.endsWith('.bar'),
      toPdf: async () => new Uint8Array([2]),
      rename: (name) => name
    }
    registerConverter(first)
    registerConverter(second)
    expect(findConverter('a.foo', new Uint8Array())).toBe(first)
    expect(findConverter('a.bar', new Uint8Array())).toBe(second)
    expect(findConverter('a.baz', new Uint8Array())).toBeNull()
  })
})
