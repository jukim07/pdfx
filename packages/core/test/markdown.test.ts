import { describe, expect, it } from 'vitest'
import { toMarkdown } from '../src/extract/markdown.js'
import type { PageText, TextSpan } from '../src/extract/text.js'

const span = (str: string, fontSize: number, hasEOL = true): TextSpan => ({
  str,
  fontSize,
  hasEOL
})

describe('toMarkdown', () => {
  it('promotes font-size clusters to heading levels', () => {
    const pages: PageText[] = [
      {
        page: 1,
        text: '',
        spans: [
          span('Document Title', 24),
          span('Section One', 16),
          span('Body paragraph line one.', 11, false),
          span(' Continues on same line.', 11),
          span('Section Two', 16),
          span('More body text.', 11)
        ]
      }
    ]
    expect(toMarkdown(pages)).toBe(
      [
        '# Document Title',
        '## Section One',
        'Body paragraph line one. Continues on same line.',
        '## Section Two',
        'More body text.'
      ].join('\n\n') + '\n'
    )
  })

  it('emits plain paragraphs when sizes are uniform (e.g. OCR text)', () => {
    const pages: PageText[] = [{ page: 1, text: '', spans: [span('alpha', 0), span('beta', 0)] }]
    expect(toMarkdown(pages)).toBe('alpha\n\nbeta\n')
  })

  it('returns a bare newline for empty input', () => {
    expect(toMarkdown([])).toBe('\n')
  })
})
