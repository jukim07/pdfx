/**
 * Pure-function tests for workspace autosave/restore helpers.
 *
 * Finding 3(i): parseRestorePaths — covers valid JSON, missing array field,
 *   non-string entries, null input, and malformed JSON.
 * Finding 3(ii): deriveOpenedPaths — covers the accumulate-only regression
 *   (red) and the live-docs derivation (green).
 */
import { describe, it, expect } from 'vitest'
import { parseRestorePaths } from './useWorkspace'
import { deriveOpenedPaths } from './useImport'

// ── parseRestorePaths ─────────────────────────────────────────────────────────

describe('parseRestorePaths', () => {
  it('returns the string paths from a valid payload', () => {
    const raw = JSON.stringify({ openPaths: ['/a/b.pdf', '/c/d.pdf'] })
    expect(parseRestorePaths(raw)).toEqual(['/a/b.pdf', '/c/d.pdf'])
  })

  it('returns [] for null input', () => {
    expect(parseRestorePaths(null)).toEqual([])
  })

  it('returns [] for empty string', () => {
    expect(parseRestorePaths('')).toEqual([])
  })

  it('returns [] when openPaths is not an array', () => {
    expect(parseRestorePaths(JSON.stringify({ openPaths: 'not-an-array' }))).toEqual([])
    expect(parseRestorePaths(JSON.stringify({ openPaths: null }))).toEqual([])
    expect(parseRestorePaths(JSON.stringify({}))).toEqual([])
  })

  it('drops non-string entries and keeps valid ones', () => {
    const raw = JSON.stringify({ openPaths: ['/ok.pdf', 42, null, true, '/also-ok.pdf'] })
    expect(parseRestorePaths(raw)).toEqual(['/ok.pdf', '/also-ok.pdf'])
  })

  it('returns [] for malformed JSON', () => {
    expect(parseRestorePaths('{not valid json')).toEqual([])
    expect(parseRestorePaths('undefined')).toEqual([])
  })

  it('returns [] for a valid empty array', () => {
    expect(parseRestorePaths(JSON.stringify({ openPaths: [] }))).toEqual([])
  })
})

// ── deriveOpenedPaths ─────────────────────────────────────────────────────────

describe('deriveOpenedPaths', () => {
  it('returns paths for all docs present in the live collection (green)', () => {
    const map = new Map([
      ['doc-a', '/files/a.pdf'],
      ['doc-b', '/files/b.pdf']
    ])
    const docs = [{ id: 'doc-a' }, { id: 'doc-b' }]
    expect(deriveOpenedPaths(docs, map)).toEqual(['/files/a.pdf', '/files/b.pdf'])
  })

  it('red: accumulate-only would still include removed doc path', () => {
    // Simulate what the old setState-accumulate approach would do: the path
    // list is [A, B] even after doc-b is removed from the collection.
    // This is the regression deriveOpenedPaths fixes.
    const staleAccumulated = ['/files/a.pdf', '/files/b.pdf']
    const docsAfterRemoval = [{ id: 'doc-a' }]
    const map = new Map([
      ['doc-a', '/files/a.pdf'],
      ['doc-b', '/files/b.pdf']
    ])

    // Old behaviour (accumulate-only): still returns both — WRONG
    expect(staleAccumulated).toContain('/files/b.pdf')

    // New behaviour (derive from live docs): only doc-a's path survives — CORRECT
    expect(deriveOpenedPaths(docsAfterRemoval, map)).toEqual(['/files/a.pdf'])
    expect(deriveOpenedPaths(docsAfterRemoval, map)).not.toContain('/files/b.pdf')
  })

  it('excludes in-app docs that have no backing file', () => {
    const map = new Map([['doc-a', '/files/a.pdf']])
    // doc-b was created in-app (pasted, blank page, etc.) — not in the map
    const docs = [{ id: 'doc-a' }, { id: 'doc-b' }]
    expect(deriveOpenedPaths(docs, map)).toEqual(['/files/a.pdf'])
  })

  it('deduplicates when multiple docs share a path (e.g. .pdfx partitions)', () => {
    const map = new Map([
      ['part-1', '/files/multi.pdfx'],
      ['part-2', '/files/multi.pdfx']
    ])
    const docs = [{ id: 'part-1' }, { id: 'part-2' }]
    expect(deriveOpenedPaths(docs, map)).toEqual(['/files/multi.pdfx'])
  })

  it('returns [] when docs is empty', () => {
    const map = new Map([['doc-a', '/files/a.pdf']])
    expect(deriveOpenedPaths([], map)).toEqual([])
  })
})
