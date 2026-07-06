/**
 * Parse a human-readable page-range spec into a deduplicated array of
 * 0-based page indices, in spec order.
 *
 * Spec syntax (1-based page numbers):
 *   "3"      → page 3
 *   "3-5"    → pages 3, 4, 5
 *   "12-"    → page 12 through the last page
 *   "3-5,9"  → pages 3,4,5,9
 *
 * Out-of-bounds pages are silently clamped/dropped.
 * Throws on malformed tokens (non-integer, empty spec, reversed range).
 * A reversed range (start > end) is a spec error, not an out-of-bounds page.
 */
export function parsePageRanges(spec: string, pageCount: number): number[] {
  if (!spec.trim()) throw new Error('parsePageRanges: spec must not be empty')

  const seen = new Set<number>()
  const result: number[] = []
  const push = (p: number): void => {
    const idx = p - 1 // convert to 0-based
    if (idx >= 0 && idx < pageCount && !seen.has(idx)) {
      seen.add(idx)
      result.push(idx)
    }
  }

  for (const token of spec.split(',')) {
    const t = token.trim()
    if (!t) throw new Error(`parsePageRanges: empty token in spec "${spec}"`)

    if (t.includes('-')) {
      const dashIdx = t.indexOf('-')
      const start = parseIntStrict(t.slice(0, dashIdx), spec)
      const endStr = t.slice(dashIdx + 1)
      const end = endStr === '' ? pageCount : parseIntStrict(endStr, spec)
      if (start > end) throw new Error(`parsePageRanges: reversed range "${t}" (start > end) in spec "${spec}"`)
      for (let p = start; p <= Math.min(end, pageCount); p++) push(p)
    } else {
      push(parseIntStrict(t, spec))
    }
  }

  return result
}

function parseIntStrict(s: string, spec: string): number {
  const n = Number(s)
  if (s.trim() === '' || !Number.isInteger(n)) {
    throw new Error(`parsePageRanges: "${s}" is not an integer in spec "${spec}"`)
  }
  return n
}
