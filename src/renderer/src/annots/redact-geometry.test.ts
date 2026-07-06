import { describe, it, expect } from 'vitest'
import { pctRectToPdf } from './geometry'

describe('pctRectToPdf (redact region mapping)', () => {
  it('maps a centred 50% square on a 200x100 page', () => {
    const r = pctRectToPdf({ leftPct: 0.25, topPct: 0.25, wPct: 0.5, hPct: 0.5 }, 200, 100)
    expect(r.x).toBeCloseTo(50)
    expect(r.y).toBeCloseTo(25) // PDF y-up: topPct=0.25, hPct=0.5 → y = 100 - 25 - 50 = 25
    expect(r.w).toBeCloseTo(100)
    expect(r.h).toBeCloseTo(50)
  })

  it('maps a full-page region', () => {
    const r = pctRectToPdf({ leftPct: 0, topPct: 0, wPct: 1, hPct: 1 }, 595, 842)
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.w).toBe(595)
    expect(r.h).toBe(842)
  })

  it('maps a top-right corner region', () => {
    const r = pctRectToPdf({ leftPct: 0.5, topPct: 0, wPct: 0.5, hPct: 0.25 }, 200, 100)
    expect(r.x).toBeCloseTo(100)
    expect(r.y).toBeCloseTo(75) // y = 100 - 0 - 25 = 75
    expect(r.w).toBeCloseTo(100)
    expect(r.h).toBeCloseTo(25)
  })
})
