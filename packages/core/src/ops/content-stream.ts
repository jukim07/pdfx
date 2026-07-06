// Purpose-built PDF content-stream tokenizer. Produces operators with BYTE RANGES
// so rewriting is a splice of untouched bytes — we never re-serialize ops we didn't edit.
// Covers the operator syntax subset that appears in content streams (PDF 32000-1 §7.8.2):
// numbers, names, literal/hex strings, arrays, dicts, keywords, comments, inline images.

export interface Tok {
  kind:
    | 'num'
    | 'name'
    | 'str'
    | 'hexstr'
    | 'arr-open'
    | 'arr-close'
    | 'dict-open'
    | 'dict-close'
    | 'kw'
  start: number
  end: number
  /** latin-1 decode of the token bytes (names/nums used by Task 5's CTM tracker). */
  text: string
}

export interface ContentOp {
  operator: string
  operands: Tok[]
  /** byte range covering "operand1 ... operandN operator" */
  start: number
  end: number
}

export const SHOW_OPS: ReadonlySet<string> = new Set(['Tj', 'TJ', "'", '"'])

const isWs = (c: number): boolean =>
  c === 0x00 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20
const isDelim = (c: number): boolean =>
  c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b ||
  c === 0x5d || c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25
const isRegular = (c: number): boolean => !isWs(c) && !isDelim(c)
const isNumStart = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e

function latin1(src: Uint8Array, start: number, end: number): string {
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(src[i])
  return s
}

export function tokenizeContent(src: Uint8Array): ContentOp[] {
  const n = src.length
  const ops: ContentOp[] = []
  let operands: Tok[] = []
  let i = 0

  const pushTok = (kind: Tok['kind'], start: number, end: number): void => {
    operands.push({ kind, start, end, text: latin1(src, start, end) })
  }

  while (i < n) {
    const c = src[i]
    if (isWs(c)) {
      i++
      continue
    }
    if (c === 0x25 /* % comment */) {
      while (i < n && src[i] !== 0x0a && src[i] !== 0x0d) i++
      continue
    }
    const start = i
    if (c === 0x28 /* ( literal string */) {
      let depth = 1
      i++
      while (i < n && depth > 0) {
        const ch = src[i]
        if (ch === 0x5c /* backslash escape */) i += 2
        else {
          if (ch === 0x28) depth++
          else if (ch === 0x29) depth--
          i++
        }
      }
      pushTok('str', start, i)
      continue
    }
    if (c === 0x3c /* < */) {
      if (src[i + 1] === 0x3c) {
        i += 2
        pushTok('dict-open', start, i)
      } else {
        i++
        while (i < n && src[i] !== 0x3e) i++
        i++ // consume >
        pushTok('hexstr', start, i)
      }
      continue
    }
    if (c === 0x3e /* > */ && src[i + 1] === 0x3e) {
      i += 2
      pushTok('dict-close', start, i)
      continue
    }
    if (c === 0x5b /* [ */) {
      i++
      pushTok('arr-open', start, i)
      continue
    }
    if (c === 0x5d /* ] */) {
      i++
      pushTok('arr-close', start, i)
      continue
    }
    if (c === 0x2f /* / name */) {
      i++
      while (i < n && isRegular(src[i])) i++
      pushTok('name', start, i)
      continue
    }
    if (isNumStart(c)) {
      i++
      while (i < n && ((src[i] >= 0x30 && src[i] <= 0x39) || src[i] === 0x2e)) i++
      pushTok('num', start, i)
      continue
    }
    // keyword: operator, true/false/null, or BI (inline image).
    // `'` and `"` are single-char operators that are "regular" chars (not in the
    // delimiter set), so the regular-char loop covers them as single-char keywords.
    let j = i
    while (j < n && isRegular(src[j])) j++
    if (j === i) j = i + 1 // safety: never stall on an unexpected byte
    const word = latin1(src, i, j)
    i = j
    if (word === 'true' || word === 'false' || word === 'null') {
      pushTok('kw', start, i)
      continue
    }
    if (word === 'BI') {
      // Inline image: skip dict tokens until the ID operator (0x49 0x44 followed by
      // whitespace), then binary data until a whitespace-delimited EI.
      while (i + 1 < n) {
        if (src[i] === 0x49 && src[i + 1] === 0x44 && (i + 2 >= n || isWs(src[i + 2]))) {
          i += 3 // past 'ID' + the single whitespace byte before binary data
          break
        }
        i++
      }
      while (i < n) {
        if (
          src[i] === 0x45 && src[i + 1] === 0x49 &&
          isWs(src[i - 1]) && (i + 2 >= n || isWs(src[i + 2]))
        ) {
          i += 2
          break
        }
        i++
      }
      ops.push({ operator: 'INLINE_IMAGE', operands, start, end: i })
      operands = []
      continue
    }
    const opStart = operands.length > 0 ? operands[0].start : start
    ops.push({ operator: word, operands, start: opStart, end: i })
    operands = []
  }
  return ops
}

/** Splice out the byte ranges of `remove`d ops; `replaceWith` substitutes text
 *  (used to turn `'` into T* so the line-advance side effect survives). */
export function stripOps(
  src: Uint8Array,
  remove: ReadonlySet<ContentOp>,
  replaceWith?: (op: ContentOp) => string
): Uint8Array {
  const sorted = [...remove].sort((a, b) => a.start - b.start)
  const parts: Uint8Array[] = []
  let cursor = 0
  for (const op of sorted) {
    parts.push(src.slice(cursor, op.start))
    if (replaceWith) {
      const rep = replaceWith(op)
      if (rep.length > 0) parts.push(new TextEncoder().encode(rep + '\n'))
    }
    cursor = op.end
  }
  parts.push(src.slice(cursor))
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
