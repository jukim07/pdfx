import { describe, it, expect } from 'vitest'
import { groupRedactDraftsBySource } from './groupRedactDrafts'
import type { DraftRedactRegion } from './useAnnotTool'
import type { PdfSource } from '../types'

function fakeSource(id: string): PdfSource {
  // PdfSource requires a pdf proxy; cast via unknown to avoid importing pdfjs-dist in unit tests.
  return { id, bytes: new Uint8Array(0), pdf: {} } as unknown as PdfSource
}

function fakeRegion(page: number) {
  return { page, rect: { x: 0, y: 0, w: 10, h: 10 } }
}

describe('groupRedactDraftsBySource', () => {
  it('single source: all drafts land in one group, order preserved', () => {
    const src = fakeSource('s1')
    const drafts: DraftRedactRegion[] = [
      { region: fakeRegion(0), sourceId: 's1' },
      { region: fakeRegion(1), sourceId: 's1' }
    ]
    const groups = groupRedactDraftsBySource(drafts, new Map([['s1', src]]))
    expect(groups.size).toBe(1)
    const g = groups.get('s1')!
    expect(g.regions).toHaveLength(2)
    expect(g.regions[0].page).toBe(0)
    expect(g.regions[1].page).toBe(1)
  })

  it('two sources with the SAME pageIndex each attribute to the correct source', () => {
    // This is the merged-doc collision case: sourceA and sourceB both have a page at
    // pageIndex 0. The old code used doc.pages.find(p => p.pageIndex === region.page)
    // which would always resolve to whichever source appeared first in the array.
    // groupRedactDraftsBySource uses sourceId captured at draw time, so both resolve correctly.
    const srcA = fakeSource('srcA')
    const srcB = fakeSource('srcB')
    const drafts: DraftRedactRegion[] = [
      { region: fakeRegion(0), sourceId: 'srcA' },
      { region: fakeRegion(0), sourceId: 'srcB' }, // same pageIndex 0, different source
      { region: fakeRegion(1), sourceId: 'srcA' }
    ]
    const groups = groupRedactDraftsBySource(
      drafts,
      new Map([
        ['srcA', srcA],
        ['srcB', srcB]
      ])
    )
    expect(groups.size).toBe(2)

    const gA = groups.get('srcA')!
    expect(gA.source).toBe(srcA)
    expect(gA.regions).toHaveLength(2)
    expect(gA.regions[0].page).toBe(0)
    expect(gA.regions[1].page).toBe(1)

    const gB = groups.get('srcB')!
    expect(gB.source).toBe(srcB)
    expect(gB.regions).toHaveLength(1)
    expect(gB.regions[0].page).toBe(0)
  })

  it('draft with unknown sourceId is silently skipped', () => {
    const src = fakeSource('known')
    const drafts: DraftRedactRegion[] = [
      { region: fakeRegion(0), sourceId: 'unknown-source' },
      { region: fakeRegion(1), sourceId: 'known' }
    ]
    const groups = groupRedactDraftsBySource(drafts, new Map([['known', src]]))
    expect(groups.size).toBe(1)
    expect(groups.get('known')!.regions).toHaveLength(1)
  })

  it('returns empty map for empty drafts', () => {
    const groups = groupRedactDraftsBySource([], new Map())
    expect(groups.size).toBe(0)
  })
})
