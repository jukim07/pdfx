import type { PageText, TextSpan } from './text.js'

interface Line {
  text: string
  fontSize: number
}

const HEADING_RATIO = 1.15
const HEADING_MAX_CHARS = 90
const MAX_HEADING_DEPTH = 3

const cluster = (fontSize: number): number => Math.round(fontSize * 2) / 2

function toLines(spans: TextSpan[]): Line[] {
  const lines: Line[] = []
  let current: TextSpan[] = []
  const flush = (): void => {
    if (current.length === 0) return
    const text = current
      .map((s) => s.str)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length > 0) {
      const sized = current.filter((s) => s.str.trim().length > 0)
      const fontSize = sized.length > 0 ? Math.max(...sized.map((s) => s.fontSize)) : 0
      lines.push({ text, fontSize })
    }
    current = []
  }
  for (const span of spans) {
    current.push(span)
    if (span.hasEOL) flush()
  }
  flush()
  return lines
}

function bodySize(lines: Line[]): number {
  const weight = new Map<number, number>()
  for (const line of lines) {
    const key = cluster(line.fontSize)
    weight.set(key, (weight.get(key) ?? 0) + line.text.length)
  }
  let best = 0
  let bestWeight = -1
  for (const [size, w] of weight) {
    if (w > bestWeight) {
      best = size
      bestWeight = w
    }
  }
  return best
}

export function toMarkdown(pages: PageText[]): string {
  const lines = pages.flatMap((p) => toLines(p.spans))
  const body = bodySize(lines)
  const headingSizes = [
    ...new Set(
      lines
        .filter((l) => l.fontSize > body * HEADING_RATIO && l.text.length <= HEADING_MAX_CHARS)
        .map((l) => cluster(l.fontSize))
    )
  ].sort((a, b) => b - a)

  const out: string[] = []
  for (const line of lines) {
    const level = headingSizes.indexOf(cluster(line.fontSize))
    if (level >= 0 && line.text.length <= HEADING_MAX_CHARS) {
      out.push(`${'#'.repeat(Math.min(level + 1, MAX_HEADING_DEPTH))} ${line.text}`)
    } else {
      out.push(line.text)
    }
  }
  return out.join('\n\n') + '\n'
}
