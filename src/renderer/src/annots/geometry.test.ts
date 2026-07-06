import { describe, it, expect } from 'vitest'
import { pctRectToPdf } from './geometry'

describe('pctRectToPdf', () => {
  it('converts top-left percentage rect to PDF user space (symmetric 5% case)', () => {
    // page 612 x 792 pt; rect occupying left 5-10% × top 5-10%
    const r = pctRectToPdf({ leftPct: 0.05, topPct: 0.05, wPct: 0.05, hPct: 0.05 }, 612, 792)
    expect(r.x).toBeCloseTo(0.05 * 612)        // 30.6
    expect(r.w).toBeCloseTo(0.05 * 612)        // 30.6
    expect(r.h).toBeCloseTo(0.05 * 792)        // 39.6
    // y: pageH - topFromTop - h  = 792 - (0.05*792) - (0.05*792) = 792 - 39.6 - 39.6 = 712.8
    // PDF origin is bottom-left, y-up; top of the on-screen box maps to bottom of PDF rect.
    expect(r.y).toBeCloseTo(712.8)
    expect(r.h).toBeCloseTo(39.6)
  })

  it('converts top-left percentage rect to PDF user space (brief spec case: topPct 0.1, hPct 0.05)', () => {
    // Brief-specified case: topPct: 0.1, hPct: 0.05, pageH: 792
    // y = 792 - (0.1 * 792) - (0.05 * 792) = 792 - 79.2 - 39.6 = 673.2
    const r = pctRectToPdf({ leftPct: 0.05, topPct: 0.1, wPct: 0.05, hPct: 0.05 }, 612, 792)
    expect(r.x).toBeCloseTo(0.05 * 612)        // 30.6
    expect(r.w).toBeCloseTo(0.05 * 612)        // 30.6
    expect(r.h).toBeCloseTo(0.05 * 792)        // 39.6
    expect(r.y).toBeCloseTo(673.2)
  })
})
