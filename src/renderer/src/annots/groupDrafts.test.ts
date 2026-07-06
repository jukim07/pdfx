import { describe, it, expect } from 'vitest'
import { groupDraftsBySource } from './groupDrafts'
import type { DraftAnnot } from './useAnnotTool'
import type { PdfSource } from '../types'

function fakeSource(id: string): PdfSource {
  // PdfSource requires a pdf proxy; cast to unknown to avoid importing pdfjs-dist in unit test.
  return { id, bytes: new Uint8Array(0), pdf: {} } as unknown as PdfSource
}

describe('groupDraftsBySource', () => {
  it('single source: all drafts land in one group, order preserved', () => {
    const src = fakeSource('s1')
    const drafts: DraftAnnot[] = [
      { annot: { type: 'note', page: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, color: { r: 0, g: 0, b: 0 }, contents: 'a' }, sourceId: 's1' },
      { annot: { type: 'note', page: 1, rect: { x: 0, y: 0, w: 1, h: 1 }, color: { r: 0, g: 0, b: 0 }, contents: 'b' }, sourceId: 's1' },
    ]
    const groups = groupDraftsBySource(drafts, new Map([['s1', src]]))
    expect(groups.size).toBe(1)
    const g = groups.get('s1')!
    expect(g.annots).toHaveLength(2)
    expect((g.annots[0] as { contents: string }).contents).toBe('a')
    expect((g.annots[1] as { contents: string }).contents).toBe('b')
  })

  it('two sources: drafts split into two groups, each group preserves order', () => {
    const srcA = fakeSource('srcA')
    const srcB = fakeSource('srcB')
    const drafts: DraftAnnot[] = [
      { annot: { type: 'note', page: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, color: { r: 0, g: 0, b: 0 }, contents: 'A1' }, sourceId: 'srcA' },
      { annot: { type: 'note', page: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, color: { r: 0, g: 0, b: 0 }, contents: 'B1' }, sourceId: 'srcB' },
      { annot: { type: 'note', page: 1, rect: { x: 0, y: 0, w: 1, h: 1 }, color: { r: 0, g: 0, b: 0 }, contents: 'A2' }, sourceId: 'srcA' },
    ]
    const groups = groupDraftsBySource(drafts, new Map([['srcA', srcA], ['srcB', srcB]]))
    expect(groups.size).toBe(2)

    const gA = groups.get('srcA')!
    expect(gA.annots).toHaveLength(2)
    expect((gA.annots[0] as { contents: string }).contents).toBe('A1')
    expect((gA.annots[1] as { contents: string }).contents).toBe('A2')

    const gB = groups.get('srcB')!
    expect(gB.annots).toHaveLength(1)
    expect((gB.annots[0] as { contents: string }).contents).toBe('B1')
  })

  it('draft for unknown source is silently skipped', () => {
    const src = fakeSource('known')
    const drafts: DraftAnnot[] = [
      { annot: { type: 'note', page: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, color: { r: 0, g: 0, b: 0 }, contents: 'ok' }, sourceId: 'known' },
      { annot: { type: 'note', page: 0, rect: { x: 0, y: 0, w: 1, h: 1 }, color: { r: 0, g: 0, b: 0 }, contents: 'orphan' }, sourceId: 'unknown' },
    ]
    const groups = groupDraftsBySource(drafts, new Map([['known', src]]))
    expect(groups.size).toBe(1)
    expect(groups.get('known')!.annots).toHaveLength(1)
  })

  it('empty drafts produces empty map', () => {
    const groups = groupDraftsBySource([], new Map())
    expect(groups.size).toBe(0)
  })
})
