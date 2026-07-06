import { describe, it, expect } from 'vitest'
import { tokenizeContent, stripOps, SHOW_OPS } from '../../src/ops/content-stream.js'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const dec = (b: Uint8Array): string => new TextDecoder('latin1').decode(b)

describe('tokenizeContent', () => {
  it('groups operands with their operator and records byte ranges', () => {
    const src = enc('BT /F1 12 Tf 72 700 Td (Hello) Tj ET')
    const ops = tokenizeContent(src)
    expect(ops.map((o) => o.operator)).toEqual(['BT', 'Tf', 'Td', 'Tj', 'ET'])
    const tj = ops[3]
    expect(tj.operands).toHaveLength(1)
    expect(tj.operands[0].kind).toBe('str')
    expect(dec(src.slice(tj.start, tj.end))).toBe('(Hello) Tj')
  })

  it('handles TJ arrays, escapes, and nested parens', () => {
    const src = enc('BT [(a\\)b) -120 ((nested (deep)))] TJ ET')
    const ops = tokenizeContent(src)
    expect(ops.map((o) => o.operator)).toEqual(['BT', 'TJ', 'ET'])
    expect(ops[1].operands.map((t) => t.kind)).toEqual([
      'arr-open', 'str', 'num', 'str', 'arr-close'
    ])
  })

  it('handles hex strings, names with delimiters after, and comments', () => {
    const src = enc('% comment\n/GS0 gs <48656C6C6F> Tj')
    const ops = tokenizeContent(src)
    expect(ops.map((o) => o.operator)).toEqual(['gs', 'Tj'])
    expect(ops[1].operands[0].kind).toBe('hexstr')
  })

  it('skips inline image binary data (BI..ID..EI)', () => {
    const src = enc('q BI /W 2 /H 2 /BPC 8 /CS /G ID \x00\xff\x01\xfe EI Q (t) Tj')
    const ops = tokenizeContent(src)
    const names = ops.map((o) => o.operator)
    expect(names).toContain('INLINE_IMAGE')
    expect(names[names.length - 1]).toBe('Tj')
  })
})

describe('stripOps', () => {
  it('removes ops by byte-splice and supports replacement text', () => {
    const src = enc('BT 72 700 Td (secret) Tj 0 -14 Td (keep) Tj ET')
    const ops = tokenizeContent(src)
    const shows = ops.filter((o) => SHOW_OPS.has(o.operator))
    expect(shows).toHaveLength(2)
    const out = dec(stripOps(src, new Set([shows[0]])))
    expect(out).not.toContain('secret')
    expect(out).toContain('(keep) Tj')
  })

  it("replaces ' with T* to preserve line advance", () => {
    const src = enc("BT (a) ' (b) Tj ET")
    const ops = tokenizeContent(src)
    const quote = ops.find((o) => o.operator === "'")!
    const out = dec(stripOps(src, new Set([quote]), () => 'T*'))
    expect(out).not.toContain('(a)')
    expect(out).toContain('T*')
  })
})
